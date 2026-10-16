const assert = require('node:assert/strict');
const fs = require('node:fs');
const {app, BrowserWindow, Menu, screen} = require('electron');
const {startApp} = require('../dist/main.js');
const config = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const until = async fn => {const end=Date.now()+15000; while(Date.now()<end){if(await fn())return;await pause(30);}throw Error('native_shell_condition_timeout');};
(async()=>{
  const window=await startApp({userDataDir:config.profile,rendererRoot:config.renderer,show:false});
  if(config.phase==='secondary'){assert.equal(window,null);return;}
  assert.ok(window);
  assert.equal(window.webContents.backgroundThrottling,false,'tray window continues processing live events');
  const js=code=>window.webContents.executeJavaScript(code,true);
  const preferences=await js('window.meetspaceDesktop.getNativePreferences()');
  assert.equal(preferences.startupSupported,process.platform==='win32'&&app.isPackaged);
  assert.equal(preferences.trayAvailable,true,'actual Electron Tray created');
  if(config.phase==='first'){
    assert.equal(preferences.closeToTray,false);
    await js('window.meetspaceDesktop.setNativePreferences({closeToTray:true,nativeNotifications:false})');
    await assert.rejects(js('window.meetspaceDesktop.setNativePreferences({closeToTray:"true"})'));
    await assert.rejects(js('window.meetspaceDesktop.setNativePreferences({startAtLogin:true})'));
    await assert.rejects(js('window.meetspaceDesktop.setNotificationContext({token:null,route:"//evil.invalid/",soundEnabled:true})'));
    await js('window.meetspaceDesktop.setNotificationContext({token:null,route:"/app",soundEnabled:false})');
    const foreign=new BrowserWindow({show:false,webPreferences:{preload:require('node:path').resolve(__dirname,'../dist/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,session:window.webContents.session}});
    await foreign.loadURL('app://meetspace/');
    await assert.rejects(foreign.webContents.executeJavaScript('window.meetspaceDesktop.getNativePreferences()'));
    foreign.destroy();
    window.show();window.close();await pause(100);
    assert.equal(window.isDestroyed(),false);assert.equal(window.isVisible(),false);
    const submenu=Menu.getApplicationMenu().items.find(item=>item.label==='MeetSpace').submenu;
    submenu.items.find(item=>item.label==='Открыть MeetSpace').click();await pause(50);
    assert.equal(window.isVisible(),true);
    submenu.items.find(item=>item.label==='Скрыть в трей').click();await pause(50);
    assert.equal(window.isVisible(),false);
    const work=screen.getPrimaryDisplay().workArea;
    window.setBounds({x:work.x+40,y:work.y+40,width:Math.min(1000,work.width),height:Math.min(700,work.height)});
    await pause(250);
    await js('window.__routes=[];window.__quitSeen=false;window.meetspaceDesktop.onRoute(route=>{window.__routes.push(route);history.pushState({},"",route)});window.meetspaceDesktop.onTransportEvent(event=>{if(event.kind==="lifecycle"&&event.type==="quit")window.__quitSeen=true});void 0');
    console.log('NATIVE_SHELL_READY');
    await until(()=>js('window.__routes.length>0'));
    assert.equal(await js('window.location.pathname'),config.expectedRoute);
    assert.equal(window.isVisible(),true,'second instance opens hidden primary');
    const state=JSON.parse(fs.readFileSync(require('node:path').join(config.profile,'desktop-state.json'),'utf8'));
    assert.equal(state.preferences.closeToTray,true);
    assert.equal(/token|userId|route|serverId/.test(JSON.stringify(state)),false);
    let release=false;
    app.once('before-quit',()=>{setTimeout(()=>{void js('window.__quitSeen').then(value=>{release=value;});},50);});
    app.once('will-quit',()=>{assert.equal(release,true,'renderer receives capture cleanup before quit');console.log(JSON.stringify({result:'PASS',phase:'first',checks:['actual Tray','explicit close-to-tray','tray menu show/hide','typed preferences and foreign-window rejection','single-instance deep link','quit cleanup signal']}));});
    await js('window.meetspaceDesktop.quit()');
  }else{
    assert.equal(preferences.closeToTray,true);assert.equal(preferences.nativeNotifications,false);
    const saved=JSON.parse(fs.readFileSync(require('node:path').join(config.profile,'desktop-state.json'),'utf8')).window;
    assert.deepEqual(window.getNormalBounds(),saved.bounds);
    window.maximize();await pause(150);assert.equal(window.isMaximized(),true);window.unmaximize();
    console.log(JSON.stringify({result:'PASS',phase:'restart',checks:['preferences and bounds restored','native maximize and restore']}));
    app.quit();
  }
})().catch(error=>{console.error('Native shell Electron verification failed: '+error.message);app.exit(1)});
