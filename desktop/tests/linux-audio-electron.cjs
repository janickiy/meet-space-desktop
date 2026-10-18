// Trusted test entry: real main/preload/CSP/permission policy and compiled shared
// output helper. Only private virtual Pulse nodes are available to this process.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app } = require("electron");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const name of Object.values(config.names)) assert.match(name, /^meetspace_[a-f0-9]{12}_[a-z_]+$/);
assert.match(config.removedModule, /^\d+$/);
assert.equal(process.platform, "linux");
assert.equal(app.commandLine.hasSwitch("use-fake-device-for-media-stream"), false);
assert.equal(app.commandLine.hasSwitch("no-sandbox"), false);
app.setPath("userData", config.profile);
app.setPath("sessionData", config.profile);
const { startApp } = require("../dist/main.js");
const exec = promisify(execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { result: "FAIL", platform: process.platform, arch: process.arch,
  electron: process.versions.electron, chromium: process.versions.chrome, checks: {}, rms: {},
  syntheticChromiumCapture: false, isolatedVirtualOsNodes: true, physicalAudioTested: false };
const persist = () => fs.writeFileSync(config.resultPath, JSON.stringify(report, null, 2) + "\n");
let stage = "start";
const watchdog = setTimeout(() => { report.failure = `timeout:${stage}`; persist(); app.exit(1); }, 95000);

function monitor(name) {
  let squared = 0, samples = 0, nonzero = 0;
  const process = spawn("parec", [`--device=${name}.monitor`, "--raw", "--format=float32le", "--channels=2", "--rate=48000", "--latency-msec=40"], { stdio: ["ignore", "pipe", "pipe"] });
  process.stderr.on("data", () => {});
  process.on("error", () => {});
  process.stdout.on("data", buffer => {
    for (let offset = 0; offset + 4 <= buffer.length; offset += 4) {
      const value = buffer.readFloatLE(offset);
      if (!Number.isFinite(value)) continue;
      squared += value * value; samples++; if (Math.abs(value) > 0.002) nonzero++;
    }
  });
  return { process, reset() { squared = samples = nonzero = 0; }, value() { return { samples, nonzero, rms: samples ? Math.sqrt(squared / samples) : 0 }; } };
}
async function signal(probe, name) {
  probe.reset();
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    const sample = probe.value();
    if (sample.samples >= 10000 && sample.nonzero >= 3000 && sample.rms > 0.005) return sample;
    await wait(100);
  }
  throw new Error(`no_pcm_signal:${name}:${JSON.stringify(probe.value())}`);
}

(async () => {
  let window;
  const monitors = [];
  try {
    window = await startApp({ show: true, userDataDir: config.profile, rendererRoot: config.renderer });
    assert.ok(window);
    assert.equal(window.isVisible(), true, "Production window startup must show this fixture");
    window.focus();
    const preferences = window.webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
    const js = code => window.webContents.executeJavaScript(code, true);
    stage = "enumerate";
    const inventory = await js(`(async () => {
      const permission = (await navigator.permissions.query({name:'microphone'})).state;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const names = ${JSON.stringify(config.names)};
      const selected = {};
      for (const [key, name] of Object.entries({source:names.source,b:names.b,c:names.c})) {
        const kind = key==='source'?'audioinput':'audiooutput';
        const match = devices.find(device=>device.kind===kind&&device.label===name);
        if (!match) throw new Error('own_virtual_device_not_enumerated:'+key);
        selected[key]=match.deviceId;
      }
      window.__audioFixture={ selected };
      return {permission,audioInputs:devices.filter(d=>d.kind==='audioinput').length,audioOutputs:devices.filter(d=>d.kind==='audiooutput').length};
    })()`);
    assert.equal(inventory.permission, "granted");
    report.checks.enumeration = inventory;
    stage = "capture";
    const capture = await js(`(async () => {
      const fixture=window.__audioFixture;
      const requested=MeetSpaceAudioDevices.inputTrackConstraints('audio',fixture.selected.source,false);
      const result=await MeetSpaceAudioDevices.captureWithDeviceFallback({audio:{...requested,echoCancellation:false,autoGainControl:false},video:false},undefined,()=>true);
      fixture.stream=result.stream;
      fixture.context=new AudioContext();
      await fixture.context.resume();
      fixture.source=fixture.context.createMediaStreamSource(fixture.stream);
      fixture.analyser=fixture.context.createAnalyser();fixture.analyser.fftSize=2048;fixture.source.connect(fixture.analyser);
      const end=Date.now()+12000; let rms=0;
      while(Date.now()<end){const data=new Float32Array(fixture.analyser.fftSize);fixture.analyser.getFloatTimeDomainData(data);rms=Math.sqrt(data.reduce((n,value)=>n+value*value,0)/data.length);if(rms>0.005)break;await new Promise(resolve=>setTimeout(resolve,100));}
      fixture.audio=document.createElement('audio');fixture.audio.srcObject=fixture.stream;document.body.appendChild(fixture.audio);
      return {rms,tracks:fixture.stream.getTracks().length,kind:fixture.stream.getTracks()[0].kind,live:fixture.stream.getTracks()[0].readyState==='live',exactSource:fixture.stream.getTracks()[0].getSettings().deviceId===fixture.selected.source,usedFallback:result.usedFallback};
    })()`);
    assert.equal(capture.exactSource, true); assert.equal(capture.kind, "audio"); assert.equal(capture.live, true); assert.equal(capture.usedFallback, false); assert.ok(capture.rms > 0.005);
    report.rms.input = capture.rms; report.checks.capture = capture;
    const b = monitor(config.names.b), c = monitor(config.names.c); monitors.push(b, c);
    stage = "output-b";
    assert.equal(await js("MeetSpaceAudioDevices.routeAudioOutput(window.__audioFixture.audio,window.__audioFixture.selected.b,()=>true,()=>navigator.mediaDevices.enumerateDevices())"), "selected");
    await js("window.__audioFixture.audio.play()");
    report.rms.outputB = await signal(b, "output_b");
    stage = "output-c";
    assert.equal(await js("MeetSpaceAudioDevices.routeAudioOutput(window.__audioFixture.audio,window.__audioFixture.selected.c,()=>true,()=>navigator.mediaDevices.enumerateDevices())"), "selected");
    report.rms.outputC = await signal(c, "output_c");
    await wait(300); // Drain the old output's bounded Pulse playback buffer.
    b.reset();
    await wait(300);
    report.rms.previousOutputBAfterSwitch = b.value();
    assert.ok(report.rms.previousOutputBAfterSwitch.samples >= 10000);
    assert.ok(report.rms.previousOutputBAfterSwitch.rms < 0.002, "Switching to C must stop PCM at the previous B output");
    stage = "output-unplug";
    await exec("pactl", ["unload-module", config.removedModule], { timeout: 10000 });
    const end = Date.now() + 8000;
    while (Date.now() < end && await js("navigator.mediaDevices.enumerateDevices().then(devices=>devices.some(device=>device.deviceId===window.__audioFixture.selected.c))")) await wait(100);
    assert.equal(await js("MeetSpaceAudioDevices.routeAudioOutput(window.__audioFixture.audio,window.__audioFixture.selected.c,()=>true,()=>navigator.mediaDevices.enumerateDevices())"), "fallback");
    report.rms.fallbackOutputB = await signal(b, "default_b_after_unplug");
    report.checks.outputSwitchAndUnplugFallback = true;
    stage = "controller-pending-dispose";
    const pending = await js(`(()=>{const f=window.__audioFixture;f.outputResults=[];const inventory=new Promise(resolve=>{f.resolveInventory=resolve;});f.controller=MeetSpaceAudioDevices.createRemotePlayback(f.audio,f.stream,f.selected.b,{readDevices:()=>inventory,onOutput:result=>f.outputResults.push(result),onBlocked:()=>{}});f.pendingRoute=f.controller.refreshOutput();void f.controller.retry();return{muted:f.audio.muted,paused:f.audio.paused,attached:f.audio.srcObject===f.stream,results:f.outputResults.length};})()`);
    assert.deepEqual(pending, { muted: true, paused: true, attached: true, results: 0 });
    await wait(300); b.reset(); await wait(300);
    report.rms.controllerPendingOutputB = b.value();
    assert.ok(report.rms.controllerPendingOutputB.samples >= 10000 && report.rms.controllerPendingOutputB.rms < 0.002);
    const stale = await js(`(async()=>{const f=window.__audioFixture;f.controller.dispose();f.resolveInventory(await navigator.mediaDevices.enumerateDevices());await f.pendingRoute;await f.controller.retry();return{muted:f.audio.muted,paused:f.audio.paused,detached:f.audio.srcObject===null,results:f.outputResults.length};})()`);
    assert.deepEqual(stale, { muted: true, paused: true, detached: true, results: 0 });
    stage = "controller-current-route";
    const current = await js(`(async()=>{const f=window.__audioFixture;f.controller=MeetSpaceAudioDevices.createRemotePlayback(f.audio,f.stream,f.selected.b,{readDevices:()=>navigator.mediaDevices.enumerateDevices(),onOutput:result=>f.outputResults.push(result),onBlocked:()=>{}});const initialMuted=f.audio.muted;await f.controller.refreshOutput();return{initialMuted,muted:f.audio.muted,paused:f.audio.paused,output:f.outputResults.at(-1)};})()`);
    assert.deepEqual(current, { initialMuted: true, muted: false, paused: false, output: "selected" });
    report.rms.controllerAcknowledgedOutputB = await signal(b, "controller_acknowledged_b");
    report.checks.productionRemotePlayback = { pending, stale, current };
    stage = "capture-cleanup";
    const cleanup = await js(`(async()=>{const f=window.__audioFixture;f.controller.dispose();f.audio.pause();f.audio.srcObject=null;f.audio.remove();f.source.disconnect();f.analyser.disconnect();f.stream.getTracks().forEach(t=>t.stop());await f.context.close();return {tracksEnded:f.stream.getTracks().every(t=>t.readyState==='ended'),contextClosed:f.context.state==='closed',playbackDetached:f.audio.srcObject===null};})()`);
    assert.deepEqual(cleanup, { tracksEnded: true, contextClosed: true, playbackDetached: true });
    report.checks.cleanup = cleanup;
    report.result = "PASS";
  } catch (error) { report.stage = stage; report.failure = error.message; }
  finally {
    for (const probe of monitors) probe.process.kill("SIGTERM");
    if (window && !window.isDestroyed()) window.destroy();
    clearTimeout(watchdog); persist();
  }
  console.log(JSON.stringify({ result: report.result, stage, physicalAudioTested: false }));
  if (report.result === "PASS") app.quit(); else app.exit(1);
})().catch(error => { report.failure = error.message; clearTimeout(watchdog); persist(); app.exit(1); });
