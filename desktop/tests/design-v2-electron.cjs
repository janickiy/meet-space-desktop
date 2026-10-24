// Visual and route regression of the shared production renderer with local TLS fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const WebSocket = require('ws');
const { app } = require('electron');
assert.ok(path.isAbsolute(process.argv[2]));
app.setPath('userData', process.argv[2]); app.setPath('sessionData', process.argv[2]);
const { startApp } = require('../dist/main.js');
const { createNodeHttpsTransport } = require('../dist/network/transport.js');
const { createCertificates, PASSWORD, CONFERENCE } = require('./fixtures/https-fixture.cjs');
const { createProductFixture, DIRECT, GROUP, FOLDER, RECORDING } = require('./fixtures/product-fixture.cjs');
(async () => {
 let cert, fixture, window;
 const captures = [], checks = [];
 const output = path.resolve(__dirname, '../artifacts/design-v2');
 const watchdog = setTimeout(() => { console.error('Design QA timeout'); app.exit(1); }, 170000);
 try {
  await fs.mkdir(output, {recursive:true});
  cert = await createCertificates(); fixture = await createProductFixture(cert);
  window = await startApp({show:false,userDataDir:process.argv[2],rendererRoot:path.resolve(__dirname,'../../frontend/dist-desktop'),brokerOptions:{transport:createNodeHttpsTransport({ca:cert.ca,timeoutMs:3000}),createSocket:(url,protocols,options)=>new WebSocket(url,protocols,{...options,ca:cert.ca,rejectUnauthorized:true})}});
  window.setContentSize(1280,800);
  const execute=code=>window.webContents.executeJavaScript(code,true);
  const until=async(predicate,label)=>{const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,40));}throw new Error(label);};
  const visible=value=>until(async()=>(await execute('document.body.innerText')).includes(value),`Missing ${value}`);
  const click=selector=>execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('Missing action: '+${JSON.stringify(selector)});e.click()})()`);
  const tab=label=>execute(`(()=>{const e=[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw new Error('Missing settings tab: '+${JSON.stringify(label)});e.click()})()`);
  const field=(selector,value)=>execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing field');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const route=async value=>{window.webContents.send('meetspace:route',value);await until(()=>execute(`location.pathname+location.search===${JSON.stringify(value)}`),'Route applies');};
  const capture=async name=>{
    await execute('document.fonts.ready');
    await execute('Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))');
    await new Promise(r=>setTimeout(r,180));
    const metrics=await execute(`(()=>{
      const visible=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
      const scrollRegions=[...document.querySelectorAll('.workspace-main,[role=dialog],.desktop-foundation-card')].filter(visible);
      const clippedRegions=scrollRegions.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({className:e.className,width:e.clientWidth,scrollWidth:e.scrollWidth}));
      const clippedButtons=[...document.querySelectorAll('.button')].filter(e=>visible(e)&&e.textContent.trim()&&(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)).map(e=>e.textContent.trim());
      const dialogs=[...document.querySelectorAll('[role=dialog]')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};});
      return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,textSize:document.documentElement.dataset.textSize,route:location.pathname,brokenImages:[...document.images].filter(i=>i.complete&&i.naturalWidth===0).length,clippedRegions,clippedButtons,dialogs};
    })()`);
    assert.ok(metrics.scrollWidth<=metrics.width+1,`${name}: horizontal overflow`);
    assert.equal(metrics.brokenImages,0,`${name}: broken images`);
    assert.deepEqual(metrics.clippedRegions,[],`${name}: content overflows its scroll region`);
    assert.deepEqual(metrics.clippedButtons,[],`${name}: button content is clipped`);
    for(const dialog of metrics.dialogs) assert.ok(dialog.left>=-1&&dialog.top>=-1&&dialog.right<=metrics.width+1&&dialog.bottom<=metrics.height+1,`${name}: dialog is outside the viewport`);
    await fs.writeFile(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG());
    captures.push({name,...metrics});
  };
  await execute('window.__designErrors=[];window.addEventListener("error",e=>window.__designErrors.push(e.message));void 0');
  await visible('Начнём с подключения'); await capture('onboarding-intro-light');
  await click('.reference-onboarding-intro .button');
  await visible('Подключиться к серверу'); await capture('onboarding-light');
  await field('#desktop-server-origin',fixture.origin);await click('.desktop-server-form button[type=submit]');
  await until(()=>execute('!!document.querySelector("#email")'),'login ready');await capture('login-light');
  await field('#email',fixture.users[0].email);await field('#password',PASSWORD);await click('#auth-form button[type=submit]');
  await until(()=>execute('!!document.querySelector(".sidebar")'),'authenticated workspace');
  window.setContentSize(1440,1000);
  const pages=[['meetings','/conferences','Product scheduled meeting'],['chat',`/personal/${DIRECT}`,'Product server message'],['group',`/personal/${GROUP}`,'Product server message'],['folders','/folders','Product personal folder'],['folder',`/folders/${FOLDER}`,'Product scheduled meeting'],['calendar','/calendar','Product scheduled meeting'],['recordings','/recordings','Product finished meeting'],['recording',`/recordings/${RECORDING}?conference=${CONFERENCE}`,'Открыть запись']];
  for(const theme of ['light','dark']){
    // Production preference selector, rather than a CSS-only theme override.
    await route('/app/settings');await visible('Мой профиль');
    assert.equal(await execute('document.querySelector(".reference-settings-page")!==null && document.querySelector(".account-settings-modal")===null'),true,'Settings route is a page');
    await tab('Внешний вид');
    await click(`input[type=radio][value=${theme}]`);
    await until(()=>execute(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`),'theme applied');
    await capture('settings-'+theme);
    await tab('Устройства');
    await until(()=>execute('!!document.querySelector("#camera-title") && !!document.querySelector("#microphone-title")'),'camera and microphone share the devices section');
    await capture('devices-'+theme);
    for(const [name,url,ready] of pages){
      await route(url);await visible(ready);await capture(name+'-'+theme);
      if(['meetings','folders','folder','recordings'].includes(name)){
        await click('.collection-view-toggle button[aria-pressed=false]');await capture(name+'-alternate-'+theme);
        await click('.collection-view-toggle button[aria-pressed=false]');
      }
      if(name==='meetings'){
        await click('.dashboard-meeting-row .meeting-info-trigger');
        await until(()=>execute('!!document.querySelector(".meeting-reference-info .meeting-info-facts")'),'meeting information dialog');
        await capture('meeting-info-'+theme);
        await click('.meeting-reference-info button[aria-label="Закрыть окно"]');
        await until(()=>execute('!document.querySelector(".meeting-reference-info")'),'meeting information dialog closes');
      }
      if(name==='calendar'){
        await click('.calendar-month-grid .calendar-event');
        await until(()=>execute('!!document.querySelector(".calendar-meeting-modal .calendar-meeting-facts")'),'calendar meeting information dialog');
        await capture('calendar-meeting-'+theme);
        await click('.calendar-meeting-modal button[aria-label="Закрыть окно"]');
        await until(()=>execute('!document.querySelector(".calendar-meeting-modal")'),'calendar meeting dialog closes');
      }
      if(name==='recording'){
        const recordingLayout=await execute(`(()=>{const player=document.querySelector('.recording-detail-player')?.getBoundingClientRect();const about=document.querySelector('.recording-detail-sidebar')?.getBoundingClientRect();return {right:!!player&&!!about&&about.left>=player.right,actions:document.querySelector('.recording-detail-about-actions')?.innerText||'',nativePlayerPending:!!document.querySelector('.recording-detail-player .button')};})()`);
        assert.equal(recordingLayout.right,true,'Recording information is beside the player');
        assert.ok(recordingLayout.actions.includes('Скачать видеозапись')&&recordingLayout.actions.includes('Скопировать ссылку'),'Recording actions are in the information card');
        assert.equal(recordingLayout.nativePlayerPending,true,'Opening the page does not fetch private media before user action');
      }
    }
    for(const [width,height] of [[1280,800],[1920,1080]]){
      window.setContentSize(width,height);
      await route('/conferences');await visible('Product scheduled meeting');
      await capture(`meetings-${width}x${height}-${theme}`);
      await click('.meetings-quick-primary');
      await until(()=>execute('!!document.querySelector(".meeting-create-modal #conference-title")'),'new meeting dialog');
      await field('#conference-title','Обсуждение следующего выпуска MeetSpace');
      await capture(`new-meeting-${width}x${height}-${theme}`);
      await click('.meeting-create-modal button[aria-label="Закрыть окно"]');
      await until(()=>execute('!document.querySelector(".meeting-create-modal")'),'new meeting dialog closes without submitting');
      await click('a[href="/meetings/new?scheduled=1"]');
      await until(()=>execute('!!document.querySelector(".meeting-reference-editor #scheduled-date") && !!document.querySelector("#scheduled-time")'),'scheduled meeting editor');
      await field('#conference-title','Обсуждение следующего выпуска MeetSpace');
      await capture(`scheduled-meeting-${width}x${height}-${theme}`);
      await click('.meeting-create-modal button[aria-label="Закрыть окно"]');
      await until(()=>execute('!document.querySelector(".meeting-create-modal")'),'scheduled meeting editor closes without submitting');
    }
    window.setContentSize(1440,1000);
  }
  await route('/conferences'); await visible('Product scheduled meeting');
  await click('.workspace-search-trigger');await visible('Быстрый переход');
  await field('.workspace-search-input input','Product');
  await click('#workspace-meeting-search');
  await until(()=>execute('new URLSearchParams(location.search).get("search")==="Product"'),'meeting search route');
  await until(()=>execute(`document.querySelector('.dashboard-all input[aria-label=\"Поиск конференции по названию\"]')?.value==='Product'`),'meeting search applied');
  checks.push('workspace search opens an accessible dialog and filters the loaded authorized meetings');
  await route('/app/settings');await visible('Мой профиль');
  await tab('Внешний вид');
  await execute(`(()=>{const s=document.querySelector('.appearance-text-size select');if(!s)throw new Error('text size selector');s.value='150';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(()=>execute('document.documentElement.dataset.textSize==="150"'),'large text preference applies');
  window.setContentSize(1280,800);
  await capture('settings-text150-1280x800');
  await route('/conferences');await visible('Product scheduled meeting');await capture('meetings-text150');
  await route('/app/settings');await visible('Мой профиль');await tab('Внешний вид');
  await execute(`(()=>{const s=document.querySelector('.appearance-text-size select');s.value='100';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await route('/conferences');await visible('Product scheduled meeting');
  window.setContentSize(1000,800);await capture('meetings-compact');
  await route(`/personal/${DIRECT}`);await visible('Product server message');await capture('chat-compact');
  // Override the production minimum window size only in this test to verify web narrow layouts.
  window.setMinimumSize(320,500);window.setContentSize(390,844);
  await route('/conferences');await visible('Product scheduled meeting');await capture('meetings-mobile');
  await route(`/personal/${DIRECT}`);await visible('Product server message');await capture('chat-mobile');
  await route('/app/settings');await visible('Настройки');await capture('settings-mobile');
  await tab('Мой профиль');await visible('Мой профиль');await capture('profile-mobile');
  checks.push('onboarding introduction leads to server connection; settings render as a page with combined devices; meeting and calendar information dialogs close without mutation; recording information and native download actions sit beside the player');
  checks.push('shared routes render in both themes; 1280x800 and 1920x1080 workspace and meeting editors, 1280x800 onboarding/login and 150% settings/meetings; desktop/compact/mobile have no document or content-region horizontal overflow, clipped button content, out-of-viewport dialog or missing image');
  assert.deepEqual(await execute('window.__designErrors'),[]);
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,checks,captures,platform:process.platform,arch:process.arch,source:'shared production React; synthetic local TLS API data',windowsRuntimeTested:false},null,2)+'\n');
  console.log(JSON.stringify({ok:true,captures:captures.length,checks}));
  clearTimeout(watchdog);window.destroy();await fixture.close();await cert.close();app.exit(0);
 }catch(error){console.error(error.stack);clearTimeout(watchdog);if(window&&!window.isDestroyed())window.destroy();if(fixture)await fixture.close();if(cert)await cert.close();app.exit(1);}
})();
