const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const syncFs = require("node:fs");
const path = require("node:path");
const { app, systemPreferences } = require("electron");
const config = JSON.parse(syncFs.readFileSync(process.argv[2], "utf8"));
assert.equal(process.platform, "darwin");
app.setPath("userData", config.profile); app.setPath("sessionData", config.profile);
assert.equal(app.commandLine.hasSwitch("use-fake-device-for-media-stream"), false);
assert.equal(app.commandLine.hasSwitch("use-fake-ui-for-media-stream"), false);
const { startApp } = require("../dist/main.js");
const { MacOSMediaAccess } = require("../dist/platform/macos-media-access.js");
const access = new MacOSMediaAccess(systemPreferences);
const report = { result: "FAIL", platform: process.platform, arch: process.arch, productVersion: process.getSystemVersion(),
  electron: process.versions.electron, packaged: false, permissionIdentity: "development Electron app",
  syntheticDevices: false, recordingsSaved: false, physicalHeadsetTested: false, physicalSleepTested: false, networkSwitchTested: false };
(async () => {
  try {
    report.before = { camera: access.status("camera"), microphone: access.status("microphone") };
    await startApp({ show: true, userDataDir: config.profile, rendererRoot: config.renderer });
    if (!await access.ensure(["camera", "microphone"])) {
      report.result = "NOT_RUN"; report.reason = "native_camera_or_microphone_permission_unavailable";
    } else {
      const { BrowserWindow } = require("electron");
      const window = BrowserWindow.getAllWindows()[0];
      report.devices = await window.webContents.executeJavaScript(`(async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const builtin = (kind) => devices.find(d => d.kind === kind && /MacBook|FaceTime|Built.in/i.test(d.label) && !/iPhone|Continuity/i.test(d.label));
        const camera = builtin('videoinput'), microphone = builtin('audioinput'), speaker = builtin('audiooutput');
        if (!camera || !microphone) throw new Error('Built-in camera/microphone could not be identified; no other device selected');
        const result = { camera: camera.label, microphone: microphone.label, speaker: speaker?.label || 'system default',
          counts: Object.fromEntries(['videoinput','audioinput','audiooutput'].map(k => [k,devices.filter(d=>d.kind===k).length])), cycles: [] };
        for (let cycle=0; cycle<2; cycle++) {
          let stream, context, video;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video:{deviceId:{exact:camera.deviceId},width:{ideal:640},height:{ideal:360}}, audio:{deviceId:{exact:microphone.deviceId}} });
            video = document.createElement('video'); video.muted=true; video.srcObject=stream; await video.play();
            context = new AudioContext(); await context.resume();
            const analyser=context.createAnalyser(); context.createMediaStreamSource(stream).connect(analyser);
            await new Promise(resolve=>setTimeout(resolve,850));
            const samples=new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
            const item={tracks:stream.getTracks().map(t=>({kind:t.kind,state:t.readyState,enabled:t.enabled})),
              decodedVideoFrames:video.getVideoPlaybackQuality().totalVideoFrames,
              microphoneRms:Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length)};
            if(item.tracks.some(t=>t.state!=='live') || item.decodedVideoFrames<1) throw new Error('Device did not deliver live media');
            stream.getTracks().forEach(t=>t.stop()); item.allEnded=stream.getTracks().every(t=>t.readyState==='ended'); result.cycles.push(item);
          } finally { stream?.getTracks().forEach(t=>t.stop()); if(video){video.pause();video.srcObject=null;} await context?.close(); }
        }
        const context=new AudioContext(), audio=document.createElement('audio');
        try {
          await context.resume(); const destination=context.createMediaStreamDestination(); const oscillator=context.createOscillator(); const gain=context.createGain();
          oscillator.frequency.value=523.25; gain.gain.value=0.12; oscillator.connect(gain).connect(destination);
          audio.srcObject=destination.stream; audio.volume=0.25;
          result.outputSelectionSupported=typeof audio.setSinkId==='function';
          if(result.outputSelectionSupported) await audio.setSinkId(speaker?.deviceId || '');
          await audio.play(); oscillator.start(); oscillator.stop(context.currentTime+0.7);
          await new Promise(resolve=>setTimeout(resolve,800));
          result.testSignalPlayed=true; result.audibility='requires human confirmation';
          destination.stream.getTracks().forEach(t=>t.stop());
        } finally { audio.pause(); audio.srcObject=null; await context.close(); }
        return result;
      })()`, true);
      report.result = "PASS";
    }
    report.after = { camera: access.status("camera"), microphone: access.status("microphone") };
  } catch (error) { report.failure = error.name + ": " + error.message; }
  finally {
    await fs.writeFile(path.join(config.output, "native-devices.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report)); app.exit(report.result === "FAIL" ? 1 : 0);
  }
})();
