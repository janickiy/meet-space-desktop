// Reproducible lifecycle checks: isolated bundle, real Chromium/Pion, fake devices.
// No production dist, renderer, package or source module is changed by this runner.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { backendSourceInputs, buildPionFixture, verifyPionFixture, sha256 } = require("./fixtures/pion-source-inputs.cjs");
async function run(binary, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: "inherit", ...options });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Stage07 fixture process timeout"));
    }, 480000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(
            new Error(`Stage07 fixture process failed: ${code ?? signal}`),
          );
    });
  });
}
(async () => {
  const repository = path.resolve(__dirname, "../..");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "meetspace-stage07-media-"),
  );
  const evidence = path.resolve(
    process.argv[2] ||
      path.join(repository, "desktop/artifacts/stage07-media-current"),
  );
  try {
    await fs.mkdir(evidence, { recursive: true });
    await fs.rm(path.join(evidence, "result.json"), { force: true });
    const backendInputs = await backendSourceInputs(repository);
    const backendEvidence = path.join(evidence, "backend-source-inputs.json");
    try {
      const existing = JSON.parse(await fs.readFile(backendEvidence, "utf8"));
      if (existing.sourceTreeSha256 !== backendInputs.sourceTreeSha256) throw Error("Pion source evidence mismatch");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.writeFile(backendEvidence, JSON.stringify(backendInputs, null, 2) + "\n", { flag: "wx" });
    }
    const sourceFiles = [];
    for (const file of [
      "frontend/src/media.ts",
      "frontend/src/useMedia.ts",
      "frontend/src/personalRealtime.ts",
      "frontend/src/realtime.ts",
      "frontend/src/platform/transport.ts",
      "frontend/src/components/ChatPanel.tsx",
      "frontend/package-lock.json",
      "desktop/package-lock.json",
    ]) {
      const bytes = await fs.readFile(path.join(repository, file));
      sourceFiles.push({
        file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    await fs.writeFile(
      path.join(evidence, "source-files.json"),
      JSON.stringify(sourceFiles, null, 2),
    );
    const suppliedFixture = process.argv.slice(3).find(arg => arg.startsWith("--fixture="))?.slice(10);
    const executable = suppliedFixture || path.join(
      directory,
      process.platform === "win32" ? "pion-fixture.exe" : "pion-fixture",
    );
    if (suppliedFixture) await verifyPionFixture(suppliedFixture, backendInputs);
    else await buildPionFixture(repository, executable);
    await fs.writeFile(path.join(evidence, "fixture.json"), JSON.stringify({
      platform: process.platform, arch: process.arch, binarySha256: sha256(await fs.readFile(executable)),
      backendSourceTreeSha256: backendInputs.sourceTreeSha256, prebuilt: !!suppliedFixture,
    }, null, 2) + "\n");
    const frontendRequire = createRequire(
      path.join(repository, "frontend/package.json"),
    );
    const { build } = await import(
      pathToFileURL(frontendRequire.resolve("vite")).href
    );
    const rendererRoot = path.join(directory, "renderer");
    await fs.mkdir(rendererRoot);
    await build({
      configFile: false,
      root: path.join(repository, "frontend"),
      logLevel: "warn",
      define: {
        __DESKTOP_BUILD__: "true",
        "process.env.NODE_ENV": '"production"',
      },
      build: {
        outDir: rendererRoot,
        emptyOutDir: false,
        minify: false,
        target: "es2022",
        rolldownOptions: {
          onwarn(warning, warn) {
            if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
          },
        },
        lib: {
          entry: path.join(
            repository,
            "frontend/scripts/stage07-lifecycle-renderer.tsx",
          ),
          name: "Stage07",
          formats: ["iife"],
          fileName: () => "lifecycle.js",
        },
      },
    });
    await fs.writeFile(
      path.join(rendererRoot, "index.html"),
      '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace Stage07 fixture</title></head><body><div id="root"></div></body></html>',
    );
    await build({
      configFile: false,
      root: path.join(repository, "frontend"),
      logLevel: "warn",
      define: {
        __DESKTOP_BUILD__: "false",
        "process.env.NODE_ENV": '"production"',
      },
      build: {
        outDir: rendererRoot,
        emptyOutDir: false,
        minify: false,
        target: "es2022",
        rolldownOptions: {
          onwarn(warning, warn) {
            if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
          },
        },
        lib: {
          entry: path.join(
            repository,
            "frontend/scripts/stage07-web-realtime.tsx",
          ),
          name: "Stage07Web",
          formats: ["iife"],
          fileName: () => "web-lifecycle.js",
        },
      },
    });
    const userDataDir = path.join(directory, "profile");
    await fs.mkdir(userDataDir);
    const configPath = path.join(directory, "config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        executable,
        rendererRoot,
        userDataDir,
        evidence,
        regressionOnly: process.argv.includes("--regression-only"),
      }),
    );
    const env = { ...process.env };
    delete env.MEETSPACE_DESKTOP_DEV;
    delete env.MEETSPACE_DEV_CSP_NONCE;
    await run(
      require("electron"),
      [path.join(__dirname, "stage07-media-electron.cjs"), configPath],
      { env },
    );
    if ((await backendSourceInputs(repository)).sourceTreeSha256 !== backendInputs.sourceTreeSha256) {
      await fs.rm(path.join(evidence, "result.json"), { force: true });
      throw Error("Pion source changed during media lifecycle validation");
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
