// Own unsigned package only. A localhost inspector observes real main/preload/React;
// it is not a production hook or ordinary-launch/visual/login acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const WebSocket = require('ws');
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const [executable, format, output, profileRoot] = process.argv.slice(2);
  assert.equal(process.platform, 'linux');
  assert.notEqual(process.getuid(), 0, 'Electron must run as the ordinary test user');
  assert.ok(path.isAbsolute(executable || '') && path.isAbsolute(output || ''));
  assert.ok(['deb', 'rpm', 'AppImage'].includes(format));
  assert.equal(await fs.realpath(executable), executable);
  const executableInfo = await fs.lstat(executable);
  assert.ok(executableInfo.isFile() && !(executableInfo.mode & 0o022));
  if (format !== 'AppImage') {
    assert.equal(executable, '/opt/meetspace-desktop-test/meetspace-test');
    assert.equal(executableInfo.uid, 0);
    const sandbox = await fs.lstat('/opt/meetspace-desktop-test/chrome-sandbox');
    assert.equal(sandbox.uid, 0); assert.equal(sandbox.gid, 0);
    assert.equal(sandbox.mode & 0o7777, 0o4755);
  }
  const home = await fs.realpath(os.homedir());
  const owned = profileRoot || await fs.mkdtemp(path.join(home, '.meetspace-package-smoke-'));
  assert.equal(path.dirname(owned),home);
  assert.match(path.basename(owned),/^\.meetspace-package-(smoke|acceptance)-[A-Za-z0-9_-]+$/);
  assert.equal(await fs.realpath(owned),owned);
  assert.equal((await fs.lstat(owned)).uid,process.getuid());
  const environment = { ...process.env };
  for (const key of ['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'ELECTRON_RUN_AS_NODE',
    'ELECTRON_OVERRIDE_DIST_PATH', 'CHROME_DEVEL_SANDBOX', 'MEETSPACE_DESKTOP_DEV',
    'MEETSPACE_DEV_CSP_NONCE', 'APPIMAGE', 'APPDIR', 'APPIMAGE_EXTRACT_AND_RUN']) delete environment[key];
  for (const [key, directory] of Object.entries({XDG_CONFIG_HOME:'config', XDG_DATA_HOME:'data', XDG_CACHE_HOME:'cache', XDG_STATE_HOME:'state'})) {
    environment[key] = path.join(owned, directory);
    await fs.mkdir(environment[key], {mode:0o700,recursive:true});
  }
  const report = {schemaVersion:1,result:'FAIL',format,platform:process.platform,arch:process.arch,
    observedAt:new Date().toISOString(),executable,checks:{},
    scope:'Actual installed package or original AppImage and sandboxed shared renderer, with a localhost test-only inspector. No ordinary-launch/visual/actual-login/physical-device acceptance.',
    userProfileAndDefaultsChanged:false,observerAttached:true};
  let child, socket, exited=false, exitCode, stderr='', endpoint, sequence=0;
  const pending = new Map();
  const request = (method, params={}) => new Promise((resolve,reject) => {
    const id=++sequence, timer=setTimeout(()=>{pending.delete(id);reject(Error('bounded_inspector_timeout'));},8000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate = async expression => {
    const result=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:7000});
    if(result.exceptionDetails) throw Error('packaged_inspector_expression_failed');
    return result.result.value;
  };
  let appPath;
  const inspect = expression => evaluate(`(async()=>{const {app,BrowserWindow}=process.getBuiltinModule('module').createRequire(${JSON.stringify(executable)})('electron');const window=BrowserWindow.getAllWindows()[0];${expression}})()`);
  const ipc = (name,...args) => inspect(`return await window.webContents.executeJavaScript(${JSON.stringify(`window.meetspaceDesktop[${JSON.stringify(name)}](...${JSON.stringify(args)})`)});`);
  const waitExit = async () => {const until=Date.now()+10000;while(!exited&&Date.now()<until)await sleep(50);return exited;};
  try {
    child=spawn(executable,['--inspect=127.0.0.1:0'],{env:environment,stdio:['ignore','ignore','pipe']});
    report.pid=child.pid;
    child.once('exit',(code,signal)=>{exited=true;exitCode=code;report.exitSignal=signal;});
    child.once('error',error=>{exited=true;report.spawnError={code:error.code,message:error.message};});
    child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-16384);const match=stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);if(match)endpoint=match[1];});
    const until=Date.now()+90000;
    while(!endpoint&&!exited&&Date.now()<until)await sleep(100);
    assert.ok(endpoint,'package opens its own bounded localhost observer');
    socket=new WebSocket(endpoint,{handshakeTimeout:5000});
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    socket.on('message',bytes=>{const value=JSON.parse(bytes.toString()),entry=pending.get(value.id);if(!entry)return;pending.delete(value.id);value.error?entry.reject(Error(value.error.message)):entry.resolve(value.result);});
    // Requiring Electron before its entry is loaded races Node bootstrap.
    while(Date.now()<until&&!exited) {
      appPath=await evaluate("Object.keys(process.getBuiltinModule('module')._cache).filter(p=>p.endsWith('/resources/app.asar/dist/entry.js')&&process.getBuiltinModule('module')._cache[p].loaded===true)[0]||null");
      if(appPath)break;await sleep(100);
    }
    assert.ok(appPath,'packaged ASAR entry loaded');
    if(format!=='AppImage')assert.equal(appPath,'/opt/meetspace-desktop-test/resources/app.asar/dist/entry.js');
    let snapshot;
    while(Date.now()<until&&!exited) {
      snapshot=await inspect("return {packaged:app.isPackaged,name:app.getName(),version:app.getVersion(),appPath:app.getAppPath(),userData:app.getPath('userData'),noSandbox:app.commandLine.hasSwitch('no-sandbox'),window:window?{loading:window.webContents.isLoading(),url:window.webContents.getURL(),preferences:window.webContents.getLastWebPreferences()}:null};");
      if(snapshot.window&&!snapshot.window.loading)break;await sleep(150);
    }
    assert.equal(snapshot.packaged,true);assert.equal(snapshot.noSandbox,false);assert.equal(snapshot.name,'MeetSpace Test');
    assert.equal(snapshot.version,require('../package.json').version);
    assert.ok(snapshot.userData.startsWith(environment.XDG_CONFIG_HOME+'/'));
    assert.ok(snapshot.window.url.startsWith('app://'));
    assert.equal(snapshot.window.preferences.sandbox,true);
    assert.equal(snapshot.window.preferences.contextIsolation,true);
    assert.equal(snapshot.window.preferences.nodeIntegration,false);
    report.packagedRuntime={...snapshot,window:{url:snapshot.window.url,sandbox:true,contextIsolation:true,nodeIntegration:false}};
    let browser;
    while(Date.now()<until&&!exited) {
      browser=await inspect("return await window.webContents.executeJavaScript('({require:typeof require,node:typeof globalThis.process?.versions?.node,bridge:typeof window.meetspaceDesktop,root:!!document.getElementById(\"root\")?.childElementCount})');");
      if(browser.root&&browser.bridge==='object')break;await sleep(100);
    }
    assert.equal(browser.require,'undefined');assert.equal(browser.node,'undefined');assert.equal(browser.bridge,'object');assert.equal(browser.root,true);
    report.checks.actualPackagedMainPreloadSandboxedReact='PASS';
    const runtime=await ipc('getRuntimeInfo');assert.equal(runtime.isPackaged,true);assert.equal(runtime.arch,process.arch);report.runtime=runtime;
    const updates=await ipc('getUpdateState');assert.equal(updates.enabled,false);assert.equal(updates.phase,'disabled');report.checks.embeddedUpdatesDisabled='PASS';
    const initial=await ipc('getNativePreferences');assert.equal(initial.startAtLogin,false);assert.equal(initial.startupSupported,true);
    await ipc('setNativePreferences',{startAtLogin:true});
    const entry=path.join(environment.XDG_CONFIG_HOME,'autostart/com.janickiy.meetspace.desktop.test.desktop');
    const enabled=await fs.readFile(entry,'utf8');assert.ok(enabled.includes('Hidden=false\n'));
    await inspect("globalThis.__meetspacePackageSecond=0;app.on('second-instance',()=>{globalThis.__meetspacePackageSecond++});return true;");
    await exec('/usr/bin/gio',['launch',entry],{env:environment,timeout:20000,maxBuffer:65536});
    let reused=false;for(let i=0;i<100;i++){reused=await inspect('return globalThis.__meetspacePackageSecond>0;');if(reused)break;await sleep(100);}assert.equal(reused,true);
    await ipc('setNativePreferences',{startAtLogin:false});
    assert.equal(await fs.readFile(entry,'utf8'),enabled.replace('Hidden=false','Hidden=true'));
    report.checks.realOptInGioSecondInstanceOptOut='PASS';
    void ipc('quit').catch(()=>{});socket.close();
    assert.equal(await waitExit(),true);assert.equal(exitCode,0);
    report.checks.actualQuitExitZero='PASS';report.result='PASS';
  } catch(error) {report.failure=error.message;throw error;}
  finally {
    socket?.terminate();for(const item of pending.values())item.reject(Error('observer_closed'));pending.clear();
    if(child&&!exited){child.kill('SIGTERM');await waitExit();if(!exited){child.kill('SIGKILL');await waitExit();}report.forcedCleanup=true;report.result='FAIL';}
    report.actualExitCode=exitCode;report.ownProcessExited=exited;report.stderrTail=stderr;
    if(exited&&!profileRoot)await fs.rm(owned,{recursive:true,force:true});
    report.ownProfileRemoved=exited&&!profileRoot;
    report.profileRetainedForLifecycle=!!profileRoot;
    await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({result:report.result,report:output}));
  }
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
