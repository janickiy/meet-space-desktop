const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createCertificates, createFixture, PASSWORD } = require("./fixtures/https-fixture.cjs");

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-electron-integration-"));
  let certificates, alpha, beta, preserveProfile = false;
  try {
    certificates = await createCertificates();
    alpha = await createFixture({ name: "alpha", certificates, notifyOnConnect: true });
    beta = await createFixture({ name: "beta", certificates, notifyOnConnect: true });
    const userDataDir = path.join(directory, "profile"), rendererRoot = path.join(directory, "renderer");
    await fs.mkdir(userDataDir); await fs.mkdir(rendererRoot);
    await fs.writeFile(path.join(rendererRoot, "index.html"), "<!doctype html><html><head><meta charset=\"UTF-8\"></head><body><div id=\"root\">MeetSpace isolated IPC test fixture</div></body></html>");
    const caPath = path.join(directory, "ca.pem"), configPath = path.join(directory, "config.json");
    await fs.writeFile(caPath, certificates.ca);
    const server = (fixture) => ({ origin: fixture.origin, email: fixture.users[0].email, userId: fixture.users[0].id });
    const config = { userDataDir, rendererRoot, caPath, alpha: server(alpha), beta: server(beta) };
    const run = async (phase) => {
      await fs.writeFile(configPath, JSON.stringify({ ...config, phase }));
      await new Promise((resolve, reject) => {
        const environment = { ...process.env };
        delete environment.MEETSPACE_DESKTOP_DEV;
        delete environment.MEETSPACE_DEV_CSP_NONCE;
        delete environment.ELECTRON_RUN_AS_NODE;
        const child = spawn(require("electron"), [path.join(__dirname, "integration-electron.cjs"), configPath], { stdio: "inherit", env: environment });
        let expired = false, hardKill, reapDeadline, childError;
        const clearTimers = () => { clearTimeout(timeout); clearTimeout(hardKill); clearTimeout(reapDeadline); };
        const timeout = setTimeout(() => {
          expired = true;
          child.kill("SIGTERM");
          hardKill = setTimeout(() => child.kill("SIGKILL"), 5000);
          reapDeadline = setTimeout(() => {
            preserveProfile = true;
            clearTimers();
            child.unref();
            reject(new Error(`Electron ${phase} phase exceeded 30 seconds and did not exit; private temporary profile preserved`));
          }, 10000);
        }, 30000);
        child.on("error", (error) => {
          // A failed signal does not mean the running process has exited.
          if (child.pid) { childError = error; return; }
          clearTimers();
          reject(error);
        });
        child.once("exit", (code, signal) => {
          clearTimers();
          if (expired) reject(new Error(`Electron ${phase} phase exceeded 30 seconds; child exited ${code ?? signal}`));
          else if (childError) reject(childError);
          else code === 0 ? resolve() : reject(new Error(`Electron ${phase} phase failed (${code ?? signal})`));
        });
      });
    };
    await run("first");
    const alphaSecrets = [...alpha.tokens.keys(), ...alpha.sessions.keys(), PASSWORD];
    const encrypted = await fs.readFile(path.join(userDataDir, "sessions.encrypted"));
    for (const secret of alphaSecrets) assert.equal(encrypted.includes(Buffer.from(secret)), false, "real OS vault contains no plaintext credentials");
    assert.equal(alpha.requests.filter((entry) => entry.path === "/api/v1/auth/login").length, 1);
    await run("restart");
    assert.equal(alpha.requests.filter((entry) => entry.path === "/api/v1/auth/login").length, 1, "actual application restart restored Alpha without a password");
    assert.equal(alpha.sessions.size, 0, "logout revoked Alpha's persistent session");
    for (const entry of beta.requests) for (const secret of alphaSecrets)
      assert.equal(JSON.stringify(entry.headers).includes(secret), false, "Alpha credentials never reached Beta");
    console.log(JSON.stringify({ result: "PASS", checks: ["actual Electron process restart", "real safeStorage", "isolated typed IPC", "native HTTPS with trusted fixture CA", "account WSS and SSE bridge", "server credential isolation", "logout revocation"], windowsRuntimeTested: process.platform === "win32" }));
  } finally {
    if (alpha) await alpha.close();
    if (beta) await beta.close();
    if (certificates) await certificates.close();
    if (!preserveProfile) await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error("Integration failed:", error.message); process.exitCode = 1; });
