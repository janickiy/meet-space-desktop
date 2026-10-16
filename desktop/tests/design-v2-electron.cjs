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
  window.setContentSize(1440,1000);
  const execute=code=>window.webContents.executeJavaScript(code,true);
  const until=async(predicate,label)=>{const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,40));}throw new Error(label);};
  const visible=value=>until(async()=>(await execute('document.body.innerText')).includes(value),`Missing ${value}`);
  const click=selector=>execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('Missing action: '+${JSON.stringify(selector)});e.click()})()`);
  const field=(selector,value)=>execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing field');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const route=async value=>{window.webContents.send('meetspace:route',value);await until(()=>execute(`location.pathname+location.search===${JSON.stringify(value)}`),'Route applies');};
  const capture=async name=>{
    await execute('document.fonts.ready');
    await execute('Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))');
    await new Promise(r=>setTimeout(r,180));
    const metrics=await execute(`(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,route:location.pathname,brokenImages:[...document.images].filter(i=>i.complete&&i.naturalWidth===0).length}))()`);
    assert.ok(metrics.scrollWidth<=metrics.width+1,`${name}: horizontal overflow`);
    assert.equal(metrics.brokenImages,0,`${name}: broken images`);
    await fs.writeFile(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG());
    captures.push({name,...metrics});
  };
  await execute('window.__designErrors=[];window.addEventListener("error",e=>window.__designErrors.push(e.message));void 0');
  await visible('Подключиться к серверу'); await capture('onboarding-light');
  await field('#desktop-server-origin',fixture.origin);await field('#desktop-server-label','Продуктовая команда');await click('.desktop-server-form button[type=submit]');
  await until(()=>execute('!!document.querySelector("#email")'),'login ready');await capture('login-light');
  await field('#email',fixture.users[0].email);await field('#password',PASSWORD);await click('#auth-form button[type=submit]');
  await until(()=>execute('!!document.querySelector(".sidebar")'),'authenticated workspace');
  const pages=[['meetings','/conferences','Product scheduled meeting'],['chat',`/personal/${DIRECT}`,'Product server message'],['group',`/personal/${GROUP}`,'Product server message'],['folders','/folders','Product personal folder'],['folder',`/folders/${FOLDER}`,'Product scheduled meeting'],['calendar','/calendar','Product scheduled meeting'],['recordings','/recordings','Product finished meeting'],['recording',`/recordings/${RECORDING}?conference=${CONFERENCE}`,'Открыть запись']];
  for(const theme of ['light','dark']){
    // Production preference selector, rather than a CSS-only theme override.
    await route('/app/settings');await visible('Ваш профиль');
    await execute(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Оформление').click()`);
    await click(`input[type=radio][value=${theme}]`);
    await until(()=>execute(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`),'theme applied');
    await capture('settings-'+theme);
    for(const [name,url,ready] of pages){
      await route(url);await visible(ready);await capture(name+'-'+theme);
      if(['meetings','folders','folder','recordings'].includes(name)){
        await click('.collection-view-toggle button[aria-pressed=false]');await capture(name+'-alternate-'+theme);
        await click('.collection-view-toggle button[aria-pressed=false]');
      }
    }
  }
  await route('/conferences'); await visible('Product scheduled meeting');
  await click('.workspace-search-trigger');await visible('Быстрый переход');
  await field('.workspace-search-input input','Product');
  await click('#workspace-meeting-search');
  await until(()=>execute('new URLSearchParams(location.search).get("search")==="Product"'),'meeting search route');
  await until(()=>execute(`document.querySelector('.dashboard-all input[aria-label=\"Поиск конференции по названию\"]')?.value==='Product'`),'meeting search applied');
  checks.push('workspace search opens an accessible dialog and filters the loaded authorized meetings');
  await route('/app/settings');await visible('Ваш профиль');
  await execute(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Оформление').click()`);
  await execute(`(()=>{const s=document.querySelector('.appearance-text-size select');if(!s)throw new Error('text size selector');s.value='150';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await route('/conferences');await visible('Product scheduled meeting');await capture('meetings-text150');
  await route('/app/settings');await visible('Ваш профиль');await execute(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Оформление').click()`);
  await execute(`(()=>{const s=document.querySelector('.appearance-text-size select');s.value='100';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await route('/conferences');await visible('Product scheduled meeting');
  window.setContentSize(1000,800);await capture('meetings-compact');
  await route(`/personal/${DIRECT}`);await visible('Product server message');await capture('chat-compact');
  // Override the production minimum window size only in this test to verify web narrow layouts.
  window.setMinimumSize(320,500);window.setContentSize(390,844);
  await route('/conferences');await visible('Product scheduled meeting');await capture('meetings-mobile');
  await route(`/personal/${DIRECT}`);await visible('Product server message');await capture('chat-mobile');
  await route('/app/settings');await visible('Настройки аккаунта');await capture('settings-mobile');
  await execute(`[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()==='Профиль').click()`);await visible('Ваш профиль');await capture('profile-mobile');
  checks.push('shared routes render in both themes; desktop/compact/mobile have no document overflow or missing image');
  assert.deepEqual(await execute('window.__designErrors'),[]);
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,checks,captures,platform:process.platform,arch:process.arch,source:'shared production React; synthetic local TLS API data',windowsRuntimeTested:false},null,2)+'\n');
  console.log(JSON.stringify({ok:true,captures:captures.length,checks}));
  clearTimeout(watchdog);window.destroy();await fixture.close();await cert.close();app.exit(0);
 }catch(error){console.error(error.stack);clearTimeout(watchdog);if(window&&!window.isDestroyed())window.destroy();if(fixture)await fixture.close();if(cert)await cert.close();app.exit(1);}
})();
