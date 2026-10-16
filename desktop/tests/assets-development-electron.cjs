// Real main/preload, IPC, session request guard and CSP from fixed localhost
// development UI to app:// media. Only API transport uses a trusted local CA
// fixture seam; credentials and recording bytes are synthetic test inputs.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {execFileSync}=require('node:child_process');
process.env.MEETSPACE_DESKTOP_DEV='1';
process.env.MEETSPACE_DEV_CSP_NONCE=randomBytes(24).toString('hex');
const {app,BrowserWindow}=require('electron');
const {startApp}=require('../dist/main.js'); // Protocol registration must precede app readiness.
const {createCertificates,PASSWORD}=require('./fixtures/https-fixture.cjs');
const {createAssetsFixture,asset}=require('./fixtures/assets-fixture.cjs');
const {createNodeHttpsTransport}=require('../dist/network/transport.js');
const {DEV_ORIGIN}=require('../dist/security.js');
let stage='initialize';
const watchdog=setTimeout(()=>{console.error(JSON.stringify({result:'FAIL',stage:'watchdog'}));app.exit(1);},25000);
(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'meetspace-assets-development-'));
  const userDataDir=path.join(directory,'user-data');await fs.mkdir(userDataDir);
  let certificates,fixture,window,foreign;
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>MeetSpace development media test</title><video id="video" controls muted></video>');});
  try{
    stage='bind-5173';await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5173,'127.0.0.1',resolve);});
    // Binding fails closed when any process already owns the fixed dev port.
    const clip=path.join(directory,'synthetic.mp4');
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',clip],{stdio:'pipe'});
    certificates=await createCertificates();fixture=await createAssetsFixture(certificates,{bytes:await fs.readFile(clip)});
    stage='start-real-main';window=await startApp({show:false,userDataDir,brokerOptions:{transport:createNodeHttpsTransport({ca:certificates.ca,timeoutMs:3000})}});
    assert.ok(window);assert.equal(window.webContents.getURL(),DEV_ORIGIN+'/');
    stage='bridge-login';const bridgeResult=await window.webContents.executeJavaScript(`(async()=>{let step='bridge';try{
      const bridge=window.meetspaceDesktop;
      step='add';
      await bridge.addServer({origin:${JSON.stringify(fixture.api.origin)},label:'Local development fixture'});
      step='select';
      const state=await bridge.listServers();await bridge.selectServer(state.items.find(item=>item.origin===${JSON.stringify(fixture.api.origin)}).id);
      step='login';
      const login=await bridge.http({id:'development-login',method:'POST',path:'/api/v1/auth/login',responseType:'json',body:{email:${JSON.stringify(fixture.api.users[0].email)},password:${JSON.stringify(PASSWORD)}}});
      if(login.status!==200)throw new Error('fixture_login');
      window.testMarker=login.body.accessToken;
      step='open';
      window.testMedia=await bridge.openRecordingMedia({id:'development-media',token:login.body.accessToken,asset:${JSON.stringify(asset)}});
      return{ok:true};}catch(error){return{ok:false,step,code:typeof error.code==='string'?error.code:error.name};}
    })()`);
    if(!bridgeResult.ok){console.error(JSON.stringify({stage:'bridge-diagnostic',...bridgeResult}));throw new Error('bridge_failed');}
    stage='owned-window-range';const result=await window.webContents.executeJavaScript(`(async()=>{
      const response=await fetch(window.testMedia.url,{headers:{Range:'bytes=5-123'}});
      return{url:window.testMedia.url,status:response.status,range:response.headers.get('content-range'),bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};
    })()`);
    assert.equal(result.status,206);assert.deepEqual(Buffer.from(result.bytes),fixture.bytes.subarray(5,124));
    assert.equal(result.range,`bytes 5-123/${fixture.bytes.length}`);
    stage='actual-dev-video';const playback=await window.webContents.executeJavaScript(`(async()=>{
      const video=document.getElementById('video');video.src=window.testMedia.url;await video.play();
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('video_timeout')),7000);video.onended=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error('video_decode'));};});
      return{time:video.currentTime,frames:video.getVideoPlaybackQuality().totalVideoFrames};
    })()`,true);
    assert.ok(playback.time>=1.5&&playback.frames>5);
    stage='foreign-window';foreign=new BrowserWindow({show:false,webPreferences:{session:window.webContents.session,preload:path.resolve(__dirname,'../dist/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
    await foreign.loadURL(DEV_ORIGIN);const before=fixture.contentReads;
    assert.equal(await foreign.webContents.executeJavaScript(`fetch(${JSON.stringify(result.url)},{headers:{Range:'bytes=5-123'}}).then(()=>false,()=>true)`),true);
    assert.equal(fixture.contentReads,before,'same-origin unowned window cannot reach storage');
    assert.equal(await foreign.webContents.executeJavaScript(`window.meetspaceDesktop.openRecordingMedia({id:'foreign-media',token:'desktop-session:foreign',asset:${JSON.stringify(asset)}}).then(()=>false,()=>true)`),true);
    stage='csp-boundary';assert.equal(await window.webContents.executeJavaScript(`fetch(${JSON.stringify(fixture.api.origin+'/version')}).then(()=>false,()=>true)`),true);
    stage='close';await window.webContents.executeJavaScript(`window.meetspaceDesktop.closeRecordingMedia('development-media')`);
    assert.equal(await window.webContents.executeJavaScript(`fetch(window.testMedia.url).then(response=>response.status)`),404);
    assert.equal(await fs.stat(path.join(userDataDir,'native-media-cache')).catch(()=>null),null);
  }finally{
    foreign?.destroy();window?.destroy();await fixture?.close();await certificates?.close();
    server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));await fs.rm(directory,{recursive:true,force:true});
  }
  clearTimeout(watchdog);console.log(JSON.stringify({result:'PASS',platform:process.platform,electron:process.versions.electron,realMainPreload:true,actualFixedDevelopmentOriginRange:true,actualH264AacPlayback:true,foreignWindowNetworkAndIpcDenied:true,directRemoteCspDenied:true,productionRequests:0}));app.exit(0);
})().catch(()=>{clearTimeout(watchdog);console.error(JSON.stringify({result:'FAIL',stage}));app.exit(1);});
