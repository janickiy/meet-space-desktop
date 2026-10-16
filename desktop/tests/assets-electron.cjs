// Actual Electron networking, app:// Range and H.264/AAC decode against a local
// synthetic fixture. A private session trusts one pinned disposable test leaf,
// only after checking its CA signature, hostname and lifetime. No global trust
// store or production certificate policy is changed.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {X509Certificate}=require('node:crypto');
const {app,session,net,protocol,BrowserWindow}=require('electron');
const {createCertificates,createFixture}=require('./fixtures/https-fixture.cjs');
const {createAssetsFixture,signed,asset}=require('./fixtures/assets-fixture.cjs');
const {createElectronTransport}=require('../dist/network/transport.js');
const {NativeAssets}=require('../dist/downloads.js');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
app.on('window-all-closed',()=>{}); // Cleanup completes before the explicit test exit.
const watchdog=setTimeout(()=>{console.error(JSON.stringify({result:'FAIL',stage:'watchdog'}));app.exit(1);},90000);
let stage='initialize';
(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'meetspace-assets-electron-'));
  await fs.mkdir(path.join(directory,'user-data'));
  app.setPath('userData',path.join(directory,'user-data'));
  let certificates,fixture,wrong,assets,window;
  const report={result:'PASS',platform:process.platform,electron:process.versions.electron,syntheticOnly:true,productionRequests:0};
  try{
    certificates=await createCertificates();
    const clip=path.join(directory,'synthetic.mp4');
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',clip],{stdio:'pipe'});
    await app.whenReady();
    const native=session.fromPartition('meetspace-assets-native-test');
    const ca=new X509Certificate(certificates.ca),expected=new X509Certificate(certificates.cert);
    native.setCertificateVerifyProc((request,callback)=>{
      try{
        const leaf=new X509Certificate(request.certificate.data),now=Date.now();
        const valid=request.hostname==='127.0.0.1'&&leaf.raw.equals(expected.raw)&&leaf.verify(ca.publicKey)&&
          leaf.checkIP('127.0.0.1')==='127.0.0.1'&&Date.parse(leaf.validFrom)<=now&&Date.parse(leaf.validTo)>now;
        callback(valid?0:-2);
      }catch{callback(-2);}
    });
    const transport=createElectronTransport(net,native);
    stage='native-auth';fixture=await createAssetsFixture(certificates,{bytes:await fs.readFile(clip),transport});
    report.nativeHttpsAuth=true;
    stage='negative-tls';wrong=await createFixture({name:'wrong-host',certificates:certificates.wrongHost});
    await assert.rejects(transport.request({url:`${wrong.origin}/version`,method:'GET',headers:{},signal:new AbortController().signal,maxResponseBytes:8192}));
    assert.equal(wrong.requests.length,0);report.untrustedCertificateRejected=true;
    let saveChoice=null,dialogCalls=0;
    assets=new NativeAssets({broker:fixture.broker,cacheDir:path.join(directory,'unused-media-cache'),
      chooseSavePath:async()=>{dialogCalls++;return saveChoice;},emit:()=>{}});
    await assets.initialize();
    let next=0;const input=()=>({id:`electron-asset-${++next}`,token:fixture.marker,asset});
    stage='save-cancel';assert.deepEqual(await assets.save(input()),{cancelled:true,saved:false});
    assert.equal(fixture.contentReads,0);assert.equal(dialogCalls,1);report.saveCancel='injected-main-dialog-result';
    stage='save-native-stream';saveChoice=path.join(directory,'saved.mp4');await assets.save(input());
    assert.deepEqual(await fs.readFile(saveChoice),fixture.bytes);report.actualNativeSaveBytes=true;
    const renderer=session.fromPartition('meetspace-assets-renderer-test');
    renderer.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    renderer.setPermissionCheckHandler(()=>false);
    renderer.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('app://meetspace/')}));
    renderer.protocol.handle('app',async request=>await assets.handleMedia(request)||new Response('<!doctype html><meta charset="utf-8"><video id="video" controls muted></video>',{headers:{'content-type':'text/html','content-security-policy':"default-src 'none'; media-src 'self'; connect-src 'self'"}}));
    window=new BrowserWindow({show:false,webPreferences:{session:renderer,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
    await window.loadURL('app://meetspace/');
    stage='protocol-range';const opened=await assets.open(input());
    const fetched=await window.webContents.executeJavaScript(`(async()=>{const response=await fetch(${JSON.stringify(opened.url)},{headers:{Range:'bytes=32-255'}});return{status:response.status,range:response.headers.get('content-range'),bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};})()`);
    assert.equal(fetched.status,206);assert.deepEqual(Buffer.from(fetched.bytes),fixture.bytes.subarray(32,256));report.actualProtocolRange=true;
    stage='chromium-video';const playback=await window.webContents.executeJavaScript(`(async()=>{const video=document.getElementById('video');video.src=${JSON.stringify(opened.url)};await video.play();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('video_timeout')),7000);video.onended=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error('video_decode'));};});return{time:video.currentTime,frames:video.getVideoPlaybackQuality().totalVideoFrames,width:video.videoWidth};})()`,true);
    assert.ok(playback.time>=1.5&&playback.frames>5&&playback.width===160);report.h264AacPlayback=true;
    stage='consumer-pause';let first=true,count=0;
    console.log(JSON.stringify({stage:'consumer-pause',seconds:36,reason:'exceeds-production-network-idle-deadline'}));
    await transport.request({url:signed(fixture.origin),method:'GET',headers:{},signal:new AbortController().signal,maxResponseBytes:1024,
      onChunk:async bytes=>{if(first){first=false;await new Promise(resolve=>setTimeout(resolve,36000));}count+=bytes.byteLength;}});
    assert.equal(count,fixture.bytes.length);report.nativeAsyncSinkPause36Seconds=true;
    stage='abort-paused-sink';let entered,release;
    const inside=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve),abort=new AbortController();
    const pending=transport.request({url:signed(fixture.origin),method:'GET',headers:{},signal:abort.signal,maxResponseBytes:1024,onChunk:async()=>{entered();await wait;}});
    const rejected=assert.rejects(pending,/request_cancelled/);await inside;abort.abort();await rejected;release();report.nativeAbortPausedSink=true;
    stage='lifetime';assets.close(opened.id);
    assert.equal(await window.webContents.executeJavaScript(`fetch(${JSON.stringify(opened.url)}).then(response=>response.status)`),404);
    assert.equal(await fs.stat(path.join(directory,'unused-media-cache')).catch(()=>null),null);report.noRecordingDiskCache=true;
    for(const request of fixture.seen)for(const name of ['authorization','cookie','origin','sec-fetch-site'])assert.equal(request.headers[name],undefined);
    report.storageCredentialIsolation=true;
  }finally{
    window?.destroy();await assets?.dispose();await fixture?.close();await wrong?.close();await certificates?.close();
    await fs.rm(directory,{recursive:true,force:true});
  }
  clearTimeout(watchdog);console.log(JSON.stringify(report));app.exit(0);
})().catch(()=>{clearTimeout(watchdog);console.error(JSON.stringify({result:'FAIL',stage}));app.exit(1);});
