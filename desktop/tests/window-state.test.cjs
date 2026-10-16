const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {restoreWindowState, DesktopLocalState} = require('../dist/window-state.js');
const primary = {x:0,y:0,width:1920,height:1040};
test('removed display restores visible normal bounds and preserves maximize', () => {
  const restored = restoreWindowState({bounds:{x:3840,y:40,width:1300,height:900},maximized:true},[primary],primary);
  assert.deepEqual(restored,{bounds:{x:310,y:70,width:1300,height:900},maximized:true});
});
test('negative monitor coordinates and work area clamp use DIP units', () => {
  const second = {x:-1280,y:-200,width:1280,height:720};
  const restored = restoreWindowState({bounds:{x:-1450,y:-250,width:1600,height:950},maximized:false},[primary,second],primary);
  assert.deepEqual(restored.bounds,{x:-1280,y:-200,width:1280,height:720});
});
test('small display remains fully reachable despite normal minimum size', () => {
  const small={x:40,y:20,width:800,height:580};
  assert.deepEqual(restoreWindowState(null,[small],small).bounds,small);
});
test('saved geometry and explicit toggles survive restart, malformed state uses defaults', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'meetspace-window-state-'));
  try {
    const state=new DesktopLocalState(directory);
    assert.deepEqual(state.getPreferences(),{closeToTray:false,nativeNotifications:true});
    state.updatePreferences({closeToTray:true,nativeNotifications:false});
    state.setWindow({bounds:{x:100,y:70,width:1000,height:700},maximized:true});
    const restarted=new DesktopLocalState(directory);
    assert.deepEqual(restarted.getPreferences(),{closeToTray:true,nativeNotifications:false});
    assert.equal(restarted.windowState().maximized,true);
    assert.throws(()=>restarted.updatePreferences({startAtLogin:true}));
    assert.throws(()=>restarted.updatePreferences({closeToTray:'true'}));
    const content=fs.readFileSync(path.join(directory,'desktop-state.json'),'utf8');
    assert.equal(/token|route|userId|serverId/.test(content),false);
    fs.writeFileSync(path.join(directory,'desktop-state.json'),'{broken');
    assert.equal(new DesktopLocalState(directory).windowState(),null);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
