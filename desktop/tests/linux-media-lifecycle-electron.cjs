// Test-only extension; main/preload/media production sources remain unchanged.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'../..'),original=path.join(root,'desktop/tests/stage07-media-electron.cjs');
let source=fs.readFileSync(original,'utf8');
const insertion=String.raw`
    // Synthetic display capture uses Chromium fake getUserMedia tracks. This is
    // deliberately NOT a system picker/portal or physical display test.
    await js("navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({audio:true,video:{width:320,height:240,frameRate:10}}); void 0");
    await checkpoint("extended-before");
    await js("window.__stage07.startMedia()");
    await waitFor(() => js("window.__stage07.mediaSettled()"), "initial extended media connection");
    for (let cycle = 1; cycle <= config.extendedCycles; cycle++) {
      await js("window.__stage07.replaceCamera()");
      await waitFor(() => js("window.__stage07.mediaSettled()"), "camera replacement ready");
      await js("window.__stage07.replaceMicrophone()");
      await waitFor(() => js("window.__stage07.mediaSettled()"), "microphone replacement ready");
      await js("window.__stage07.startScreen()");
      await waitFor(() => js("window.__stage07.mediaSettled()"), "synthetic screen ready");
      const sharing = await js("({ ...window.__stage07.metrics(), ...window.__stage07.mediaMetrics() })");
      assert.equal(sharing.screenSharing, true);
      assert.equal(sharing.screenTracks, 2);
      assert.equal(sharing.liveTracks, 4);
      await js("window.__stage07.stopScreen()");
      await waitFor(() => js("window.__stage07.mediaSettled()"), "synthetic screen stopped");
      const stopped = await js("({ ...window.__stage07.metrics(), ...window.__stage07.mediaMetrics() })");
      assert.equal(stopped.screenSharing, false);
      assert.equal(stopped.localTracks, 2);
      assert.equal(stopped.liveTracks, 2);
      assert.equal(stopped.pendingCapture, 0);
      if (cycle % 25 === 0) await checkpoint("extended-media-" + cycle);
    }
    const activeSfu = await rpc("stats");
    await js("window.__stage07.stopMedia(); void 0");
    await waitFor(async () => {
      const value = await rpc("stats");
      return value.peers + value.rooms + value.tracks + value.subscriptions === 0;
    }, "extended Pion cleanup");
    await checkpoint("extended-after");
    const finalMetrics = checkpoints.at(-1).metrics;
    assert.equal(finalMetrics.liveTracks + finalMetrics.livePeers + finalMetrics.retainedClients, 0);
    assert.equal(finalMetrics.createdPeers, finalMetrics.closedPeers);
    const extendedLifecycle = {cycles: config.extendedCycles, cameraReplacements: config.extendedCycles,
      microphoneReplacements: config.extendedCycles, syntheticDisplayStartStop: config.extendedCycles,
      actualChromiumTracks: true, realPion: true, realDisplayCapture: false, physicalDevices: false,
      activeSfu, finalSfu: checkpoints.at(-1).sfu, finalMetrics};
`;
const marker='    if (!config.regressionOnly) {';
if(!source.includes(marker))throw Error('Original media harness drift');
source=source.replace(marker,insertion+'\n'+marker);
const resultMarker='    result.routeRegression = routeRegression;';
if(!source.includes(resultMarker))throw Error('Original result marker drift');
source=source.replace(resultMarker,'    result.extendedLifecycle = extendedLifecycle;\n'+resultMarker);
const loaded=new Module(original,module);loaded.filename=original;loaded.paths=Module._nodeModulePaths(path.dirname(original));loaded._compile(source,original);
