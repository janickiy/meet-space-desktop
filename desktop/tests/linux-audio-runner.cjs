// Real Linux PipeWire/Pulse PCM, with private sockets/config/state and no
// physical hardware monitors. The logged-in desktop's defaults are untouched.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run(command, args, env = process.env) {
  return (await exec(command, args, { env, timeout: 15000, maxBuffer: 1024 * 1024 })).stdout.trim();
}
async function snapshot(env) {
  const names = async kind => JSON.parse(await run("pactl", ["-f", "json", "list", kind], env)).map(value => value.name).sort();
  return { sink: await run("pactl", ["get-default-sink"], env), source: await run("pactl", ["get-default-source"], env),
    sinks: await names("sinks"), sources: await names("sources") };
}
async function until(predicate, name, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { if (await predicate()) return; await wait(100); }
  throw new Error(name);
}

(async () => {
  assert.equal(process.platform, "linux", "This fixture requires native Linux audio binaries");
  assert.notEqual(process.getuid(), 0, "Run the GUI/media test as its unprivileged desktop user");
  const root = path.resolve(__dirname, "../..");
  const output = path.resolve(process.argv[2] || path.join(root, "desktop/artifacts/linux-audio"));
  await fs.mkdir(output, { recursive: true });
  const resultPath = path.join(output, `linux-audio-${process.arch}.json`);
  await fs.rm(resultPath, { force: true });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-linux-audio-"));
  const children = [], modules = [];
  let pcmTimer, producer, environment, before, failure;
  const report = { result: "FAIL", platform: process.platform, arch: process.arch,
    isolatedOsAudioStack: true, physicalHardwareTested: false, bluetoothTested: false,
    subjectiveAudioQualityTested: false, desktopRoutingPolicyTested: false,
    productionSecurityRelaxed: false, checks: {} };
  const start = async (name, command, args, env) => {
    const log = await fs.open(path.join(output, `${name}.log`), "w");
    const child = spawn(command, args, { env, stdio: ["ignore", log.fd, log.fd] });
    child.once("error", () => {});
    children.push(child);
    await log.close();
    return child;
  };
  try {
    report.sourceFiles = [];
    for (const file of ["frontend/src/mediaDevices.ts", "frontend/src/remotePlayback.ts", "desktop/src/media-permissions.ts", "desktop/tests/linux-audio-runner.cjs", "desktop/tests/linux-audio-electron.cjs"])
      report.sourceFiles.push({ file, sha256: createHash("sha256").update(await fs.readFile(path.join(root, file))).digest("hex") });
    before = await snapshot(process.env);
    report.desktopDefaultsBeforeSha256 = createHash("sha256").update(JSON.stringify(before)).digest("hex");
    report.versions = {};
    for (const binary of ["pipewire", "pipewire-pulse", "wireplumber", "pactl"])
      report.versions[binary] = (await run(binary, ["--version"])).split("\n").slice(0, 3).join("; ");
    assert.match(report.versions.wireplumber, /0\.4\./, "Hardware-free fixture configuration targets WirePlumber 0.4");
    const runtime = path.join(directory, "runtime"), pulse = path.join(directory, "pulse");
    const configHome = path.join(directory, "config"), stateHome = path.join(directory, "state");
    const mainConfig = path.join(configHome, "wireplumber/main.lua.d");
    const bluetoothConfig = path.join(configHome, "wireplumber/bluetooth.lua.d");
    for (const folder of [runtime, pulse, mainConfig, bluetoothConfig, stateHome]) await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(mainConfig, "85-meetspace-no-hardware.lua"),
      'alsa_monitor.enabled = false\nv4l2_monitor.enabled = false\nlibcamera_monitor.enabled = false\ndevice_defaults.properties["use-persistent-storage"] = false\nstream_defaults.properties["restore-props"] = false\n');
    await fs.writeFile(path.join(bluetoothConfig, "85-meetspace-no-hardware.lua"), 'bluez_monitor.enabled = false\nbluez_midi_monitor.enabled = false\n');
    environment = { ...process.env, PIPEWIRE_RUNTIME_DIR: runtime, PIPEWIRE_REMOTE: "pipewire-0", PIPEWIRE_CORE: "pipewire-0",
      PULSE_RUNTIME_PATH: pulse, PULSE_SERVER: `unix:${pulse}/native`, XDG_CONFIG_HOME: configHome, XDG_STATE_HOME: stateHome };
    delete environment.PIPEWIRE_CONFIG_DIR;
    delete environment.PIPEWIRE_CONFIG_PREFIX;
    delete environment.PIPEWIRE_CONFIG_NAME;
    await start("pipewire", "pipewire", ["-c", "/usr/share/pipewire/pipewire.conf"], environment);
    await until(async () => fs.stat(path.join(runtime, "pipewire-0")).then(value => value.isSocket(), () => false), "private_pipewire_socket_timeout");
    await start("wireplumber", "wireplumber", [], environment);
    await start("pipewire-pulse", "pipewire-pulse", ["-c", "/usr/share/pipewire/pipewire-pulse.conf"], environment);
    await until(async () => run("pactl", ["get-default-sink"], environment).then(() => true, () => false), "private_pulse_socket_timeout");
    const prefix = `meetspace_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const names = { inputSink: `${prefix}_input`, source: `${prefix}_source`, b: `${prefix}_output_b`, c: `${prefix}_output_c` };
    const load = async (name, args) => {
      const id = await run("pactl", ["load-module", name, ...args], environment);
      assert.match(id, /^\d+$/);
      modules.push(id);
      return id;
    };
    await load("module-null-sink", [`sink_name=${names.inputSink}`, "rate=48000", "channels=2", `sink_properties=device.description=${names.inputSink}`]);
    await load("module-remap-source", [`master=${names.inputSink}.monitor`, `source_name=${names.source}`, "channels=2", "remix=no", `source_properties=device.description=${names.source}`]);
    await load("module-null-sink", [`sink_name=${names.b}`, "rate=48000", "channels=2", `sink_properties=device.description=${names.b}`]);
    const removedModule = await load("module-null-sink", [`sink_name=${names.c}`, "rate=48000", "channels=2", `sink_properties=device.description=${names.c}`]);
    // Defaults are set only inside this temporary, hardware-free server.
    await run("pactl", ["set-default-sink", names.b], environment);
    await run("pactl", ["set-default-source", names.source], environment);
    for (const name of [names.inputSink, names.b, names.c]) {
      await run("pactl", ["set-sink-mute", name, "0"], environment);
      await run("pactl", ["set-sink-volume", name, "100%"], environment);
    }
    const inputs = JSON.parse(await run("pactl", ["-f", "json", "list", "sources"], environment));
    assert.ok(inputs.every(source => source.name.startsWith(prefix)), "Private server exposes only own virtual sources");
    report.checks.onlyOwnVirtualSources = true;
    report.checks.desktopDefaultsPreservedDuring = JSON.stringify(await snapshot(process.env)) === JSON.stringify(before);
    assert.equal(report.checks.desktopDefaultsPreservedDuring, true);
    producer = spawn("pacat", ["--playback", `--device=${names.inputSink}`, "--raw", "--format=float32le", "--channels=2", "--rate=48000", "--latency-msec=40"],
      { env: environment, stdio: ["pipe", "ignore", "pipe"] });
    producer.stderr.on("data", () => {});
    producer.stdin.on("error", () => {});
    children.push(producer);
    let samples = 0;
    pcmTimer = setInterval(() => {
      const buffer = Buffer.alloc(960 * 2 * 4);
      for (let frame = 0; frame < 960; frame++) {
        const value = 0.2 * Math.sin(2 * Math.PI * 440 * samples++ / 48000);
        buffer.writeFloatLE(value, frame * 8); buffer.writeFloatLE(value, frame * 8 + 4);
      }
      if (!producer.stdin.destroyed && producer.stdin.writableLength < 384000) producer.stdin.write(buffer);
    }, 20);
    const renderer = path.join(directory, "renderer"), profile = path.join(directory, "profile");
    await fs.mkdir(renderer); await fs.mkdir(profile);
    const frontendRequire = createRequire(path.join(root, "frontend/package.json"));
    const { build } = await import(pathToFileURL(frontendRequire.resolve("vite")).href);
    const entry = path.join(directory, "audio-entry.ts");
    await fs.writeFile(entry, `export * from ${JSON.stringify(path.join(root, "frontend/src/mediaDevices.ts"))};\nexport * from ${JSON.stringify(path.join(root, "frontend/src/remotePlayback.ts"))};\n`);
    await build({ configFile: false, root: path.join(root, "frontend"), logLevel: "warn",
      build: { outDir: renderer, emptyOutDir: false, minify: false, lib: { entry,
        name: "MeetSpaceAudioDevices", formats: ["iife"], fileName: () => "audio-devices.js" } } });
    await fs.writeFile(path.join(renderer, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace isolated OS audio fixture</title><script src="/audio-devices.js"></script></head><body>Only temporary virtual audio nodes.</body></html>');
    const electronReport = path.join(output, "electron-audio.json"), configuration = path.join(directory, "config.json");
    await fs.writeFile(configuration, JSON.stringify({ renderer, profile, resultPath: electronReport, names, removedModule }));
    const electronEnv = { ...environment, PULSE_SOURCE: names.source };
    for (const key of ["MEETSPACE_DESKTOP_DEV", "MEETSPACE_DEV_CSP_NONCE", "ELECTRON_RUN_AS_NODE"]) delete electronEnv[key];
    const electron = await start("electron-audio", require("electron"), [path.join(__dirname, "linux-audio-electron.cjs"), configuration], electronEnv);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { electron.kill(); reject(new Error("linux_audio_electron_timeout")); }, 100000);
      electron.once("error", error => { clearTimeout(timer); reject(error); });
      electron.once("exit", (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`linux_audio_electron_failed:${code ?? signal}`)); });
    });
    report.electron = JSON.parse(await fs.readFile(electronReport, "utf8"));
    assert.equal(report.electron.result, "PASS");
    report.result = "PASS";
  } catch (error) {
    failure = error;
    report.failure = error.message;
  } finally {
    if (pcmTimer) clearInterval(pcmTimer);
    if (producer) producer.stdin.end();
    report.checks.privateModulesUnloaded = false;
    if (environment) {
      try {
        // The selected output may already have been unplugged by the test.
        const active = new Set(JSON.parse(await run("pactl", ["-f", "json", "list", "modules"], environment)).map(module => String(module.index)));
        for (const id of modules.slice().reverse())
          if (active.has(id)) await run("pactl", ["unload-module", id], environment);
        const remaining = JSON.parse(await run("pactl", ["-f", "json", "list", "modules"], environment));
        report.checks.privateModulesUnloaded = !remaining.some(module => modules.includes(String(module.index)));
      } catch { /* The private server may already have exited; it is joined below. */ }
    }
    for (const child of children.slice().reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      child.kill("SIGTERM");
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), wait(2000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await Promise.race([new Promise(resolve => child.once("exit", resolve)), wait(2000)]);
      }
    }
    // Every module lived in the terminated private server, never the desktop.
    report.checks.privateProcessesStopped = children.every(child => child.exitCode !== null || child.signalCode !== null);
    if (!report.checks.privateProcessesStopped || (report.result === "PASS" && !report.checks.privateModulesUnloaded)) {
      report.result = "FAIL"; failure ||= new Error("private_audio_cleanup_failed");
    }
    if (before) {
      const after = await snapshot(process.env);
      report.desktopDefaultsAfterSha256 = createHash("sha256").update(JSON.stringify(after)).digest("hex");
      report.checks.desktopDefaultsPreservedAfter = JSON.stringify(before) === JSON.stringify(after);
      if (!report.checks.desktopDefaultsPreservedAfter) { report.result = "FAIL"; failure ||= new Error("desktop_audio_inventory_changed"); }
    }
    report.temporaryModuleCount = modules.length;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.writeFile(resultPath, JSON.stringify(report, null, 2) + "\n");
  }
  if (failure) throw failure;
  assert.equal(report.checks.privateProcessesStopped, true);
  console.log(JSON.stringify({ result: report.result, report: resultPath, isolatedOsAudioStack: true, physicalHardwareTested: false }));
})().catch(error => { console.error("Linux OS audio fixture failed: " + error.message); process.exitCode = 1; });
