const {app,BrowserWindow}=require('electron');
const path=require('node:path');
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  try {
    await window.loadFile(path.join(process.argv[2],'index.html'));
    const result=await window.webContents.executeJavaScript(`(async()=>{
      const assert=(ok,message)=>{if(!ok)throw Error(message)};
      const delay=ms=>new Promise(r=>setTimeout(r,ms));
      const contexts=[];const NativeContext=AudioContext;
      window.AudioContext=class extends NativeContext{constructor(...a){super(...a);contexts.push(this)}};
      const source=new NativeContext();await source.resume();
      const destination=source.createMediaStreamDestination();
      const tone=source.createOscillator();tone.frequency.value=440;
      tone.connect(destination);tone.start();
      const raw=destination.stream.getAudioTracks()[0];
      const processor=new MeetSpaceAudio.MicrophoneGain(raw,100);await processor.ready();
      assert(processor.track.id!==raw.id,'processed track identity must be published');
      const tx=new RTCPeerConnection(),rx=new RTCPeerConnection();
      tx.onicecandidate=e=>e.candidate&&rx.addIceCandidate(e.candidate);
      rx.onicecandidate=e=>e.candidate&&tx.addIceCandidate(e.candidate);
      const received=new Promise(r=>rx.ontrack=e=>r(e.track));
      tx.addTrack(processor.track,new MediaStream([processor.track]));
      await tx.setLocalDescription(await tx.createOffer());await rx.setRemoteDescription(tx.localDescription);
      await rx.setLocalDescription(await rx.createAnswer());await tx.setRemoteDescription(rx.localDescription);
      const remote=await received;
      const playback=new Audio();playback.srcObject=new MediaStream([remote]);playback.volume=0;await playback.play();
      const analyser=source.createAnalyser();analyser.fftSize=2048;
      const receiver=source.createMediaStreamSource(new MediaStream([remote]));receiver.connect(analyser);
      const silentOutput=source.createGain();silentOutput.gain.value=0;analyser.connect(silentOutput).connect(source.destination);
      const samples=new Float32Array(2048);
      const rms=async()=>{let values=[];for(let i=0;i<8;i++){await delay(80);analyser.getFloatTimeDomainData(samples);values.push(Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/samples.length));}return values.reduce((s,x)=>s+x,0)/values.length;};
      await delay(1200);const full=await rms();assert(full>0.1,'RTC must receive audio');
      processor.setVolume(0);await delay(400);const silent=await rms();assert(silent<0.0001,'zero mic volume must silence outgoing RTC audio');
      processor.setVolume(25);await delay(400);const quarter=await rms();assert(quarter/full>0.18&&quarter/full<0.32,'quarter-volume audio amplitude');
      raw.enabled=false;await delay(400);const muted=await rms();assert(muted<0.0001,'mute must still silence processed track');raw.enabled=true;
      processor.dispose();processor.dispose();assert(processor.track.readyState==='ended'&&raw.readyState==='live','dispose only owns output');
      playback.pause();playback.srcObject=null;tx.close();rx.close();receiver.disconnect();analyser.disconnect();silentOutput.disconnect();
      for(let i=0;i<25;i++){const p=new MeetSpaceAudio.MicrophoneGain(raw,i);await p.ready();p.dispose();assert(p.track.readyState==='ended','track cleanup');}
      const ended=new MeetSpaceAudio.MicrophoneGain(raw,70);await ended.ready();raw.stop();raw.dispatchEvent(new Event('ended'));assert(ended.track.readyState==='ended','hardware end cleanup');
      await delay(100);assert(contexts.every(c=>c.state==='closed'),'all processing contexts must close');
      tone.stop();tone.disconnect();await source.close();
      return {result:'PASS',rtcRms:{full,silent,quarter,muted},closedProcessingContexts:contexts.length,physicalDevicesOpened:false};
    })()`);
    console.log(JSON.stringify(result));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
