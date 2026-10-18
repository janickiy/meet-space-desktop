// Exercise the exact extracted runtime, including ssh2's mandatory WASM/JS
// crypto fallback, without loading dependencies from the development checkout.
const assert = require("node:assert/strict");
const path = require("node:path");
const { generateKeyPairSync } = require("node:crypto");
const { createRequire } = require("node:module");
const root = process.argv[2];
assert.ok(root && path.isAbsolute(root));
const packaged = createRequire(path.join(root, "package.json"));
const { Server } = packaged("ssh2");
const { Ssh2Transport, INSTALLER_COMMAND } = packaged("./dist/ssh/transport.js");
const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
const server = new Server({ hostKeys: [key] });
const clients = new Set();
let authentications = 0, commands = 0;
server.on("connection", client => {
  clients.add(client);
  client.on("error", () => {});
  client.on("close", () => clients.delete(client));
  client.on("authentication", request => {
    authentications++;
    if (request.method === "password" && request.username === "fixture" && request.password === "local-fixture") request.accept();
    else request.reject();
  });
  client.on("ready", () => client.on("session", accept => accept().on("exec", (acceptExec, reject, info) => {
    if (info.command !== INSTALLER_COMMAND) return reject();
    commands++;
    const stream = acceptExec();
    stream.resume();
    stream.on("end", () => { stream.write('{"protocol":"MSI1","ok":true,"result":{}}'); stream.exit(0); stream.end(); });
  })));
});
(async () => {
  const transport = new Ssh2Transport({ connectMs: 4000, commandMs: 4000 });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const endpoint = { host: "127.0.0.1", port: server.address().port, user: "fixture" };
    const signal = new AbortController().signal;
    const pin = await transport.inspect(endpoint, signal);
    assert.equal(authentications, 0);
    const reply = await transport.installer(endpoint, { kind: "password", password: Buffer.from("local-fixture") }, pin, Buffer.from("fixture\n"), signal);
    assert.equal(JSON.parse(reply).ok, true);
    assert.equal(commands, 1);
    console.log("Packaged SSH discovery, pin, authentication and command stream passed.");
  } finally {
    transport.dispose();
    for (const client of clients) client.end();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(() => { console.error("Packaged SSH runtime verification failed"); process.exitCode = 1; });
