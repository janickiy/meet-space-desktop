// Real Electron renderer/preload/IPC; remote installer replies are a deterministic
// fixture. Real SSH handshakes and controller persistence have separate tests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {app, ipcMain} = require('electron');
app.setPath('userData', process.argv[2]); app.setPath('sessionData',process.argv[2]);
const {startApp} = require('../dist/main.js');
const output = path.resolve(__dirname,'../artifacts/ssh-release-20261018');
(async () => {
  const calls=[], checks=[];
  let window, state={busy:false,phase:'idle',hasCredentials:false};
  let sequence=0;
  const plan = {hash:'a'.repeat(64),version:'v1.2.3',commit:'b'.repeat(40),options:{domain:'meet.example.com',publicIpv4:'8.8.8.8'},architecture:'arm64',installDocker:true,expiresAt:Math.floor(Date.now()/1000)+900,sourceSelection:'release: v1.2.3',sourceSha256:'c'.repeat(64),resourceProfile:'compact-test',installDockerPluginsOnly:false,missingDockerPlugins:[],actions:['install-docker']};
  const phases=['docker','source','images','configuration','dependencies','backup','migrations','https','services','readiness'];
  const status = (value, phase='images') => ({jobId:state.ticket.jobId,state:value,phase,completedPhases:value==='completed'?phases:['docker','source'],events:[{sequence:++sequence,state:value,phase}],terminal:['completed','needs_recovery'].includes(value)});
  const watchdog=setTimeout(()=>app.exit(1),85000);
  try {
    window=await startApp({show:false,userDataDir:process.argv[2],rendererRoot:path.resolve(__dirname,'../../frontend/dist-desktop')});
    assert.ok(window);
    ipcMain.removeHandler('meetspace:ssh:state');
    ipcMain.handle('meetspace:ssh:state',() => ({ok:true,value:state}));
    ipcMain.removeHandler('meetspace:ssh:action');
    ipcMain.handle('meetspace:ssh:action',async(event,action,input)=>{
      assert.equal(event.sender,window.webContents); assert.equal(event.senderFrame,window.webContents.mainFrame);
      calls.push({action,input}); state.error=undefined;
      if(action==='discover') state={busy:false,phase:'host-key',hasCredentials:false,endpoint:input.endpoint,identity:{fingerprint:'SHA256:'+'F'.repeat(43),algorithm:'ssh-ed25519',changed:false,trusted:false}};
      if(action==='acceptHostKey'){assert.equal(input.fingerprint,state.identity.fingerprint);state.identity.trusted=true;state.phase='trusted';}
      if(action==='preflight') {assert.equal(input.credentials.password,'local-ui-fixture-only'); state.hasCredentials=true;state.phase='preflight';state.preflight={domain:input.domain,checkedAt:new Date().toISOString(),ready:true,checks:[{id:'os',title:'Ubuntu 24.04',level:'pass',detail:'Fixture ready'}]};}
      if(action==='plan'){plan.options=input.options;state.plan=plan;state.phase='planned';assert.equal(input.smtpPassword,undefined);}
      if(action==='apply') {
        assert.equal(input.confirmedPlanHash,plan.hash);assert.equal(input.acceptAcmeTerms,true);assert.equal(input.confirmDockerInstall,true);
        assert.equal(input.smtpPassword,'smtp-ui-fixture-only');
        state.ticket={jobId:'592ec96c-2562-4509-95ef-fbe145f2e22f',domain:plan.options.domain,...state.endpoint,planHash:plan.hash};
        state.phase='error';state.error={code:'NETWORK',message:'Соединение прервано. Проверьте состояние задания.'};state.hasCredentials=false;
      }
      if(action==='status') {assert.ok(input.credentials?.password || state.hasCredentials);state.hasCredentials=false;state.phase='running';state.status=status('needs_recovery','images:api');}
      if(action==='resume'){assert.equal(input.confirmedPlanHash,state.ticket.planHash);state.phase='completed';state.hasCredentials=false;state.status=status('completed','readiness');}
      if(action==='detach'){state.hasCredentials=false;}
      if(action==='forget'){assert.equal(input.confirm,true);state={busy:false,phase:'idle',hasCredentials:false};}
      return {ok:true,value:structuredClone(state)};
    });
    const execute=code=>window.webContents.executeJavaScript(code,true);
    const until=async(predicate,label)=>{const end=Date.now()+7000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,30));}throw new Error(label);};
    const visible=value=>until(async()=> (await execute('document.body.innerText')).includes(value),'Missing '+value);
    const clickText=value=>execute(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(value)});if(!e||e.disabled)throw new Error('Unavailable button '+${JSON.stringify(value)});e.click();})()`);
    const click=selector=>execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const field=(id,value)=>execute(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const isDisabled=value=>execute(`([...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(value)}))?.disabled`);
    await visible('Подключиться к серверу');await clickText('Установить сервер по SSH');await visible('SSH-адрес хоста');
    await field('desktop-ssh-host','vps.example.com');await clickText('Проверить ключ хоста');await visible('Подтвердите ключ хоста');
    assert.equal(await isDisabled('Доверять этому ключу'),true);assert.equal(calls.some(c=>c.input.credentials),false);
    await click('.desktop-ssh-trust input[type=checkbox]');await clickText('Доверять этому ключу');await visible('Домен будущего MeetSpace');
    await field('desktop-ssh-domain','meet.example.com');await field('desktop-ssh-public-ip','8.8.8.8');await field('desktop-ssh-password','local-ui-fixture-only');
    assert.equal(await execute("document.getElementById('desktop-smtp-enabled').checked"),false);
    assert.equal(await execute("!!document.getElementById('desktop-smtp-host')"),false);
    await visible('Без SMTP приглашения и напоминания');await click('#desktop-smtp-enabled');
    await field('desktop-smtp-host','smtp.example.com');await field('desktop-smtp-from','meetings@example.com');await field('desktop-smtp-username','meetings@example.com');await clickText('Проверить готовность хоста');
    await visible('Подготовить план установки');await clickText('Подготовить план установки');await visible('План установки');
    assert.equal(await isDisabled('Установить MeetSpace'),true);
    assert.equal(await execute("!!document.querySelector('#desktop-ssh-password')"),false);
    checks.push('Host fingerprint confirmation precedes credentials; preflight credentials leave React form; immutable plan requires all three consents');
    await fs.mkdir(output,{recursive:true});
    for(const theme of ['light','dark']){
      await execute(`document.documentElement.dataset.theme='${theme}';document.querySelector('.desktop-ssh-plan').scrollIntoView({block:'start'});void 0`);
      await new Promise(r=>setTimeout(r,100));
      await fs.writeFile(path.join(output,`ssh-plan-${theme}.png`),(await window.webContents.capturePage()).toPNG());
    }
    await click('#desktop-ssh-plan-consent');assert.equal(await isDisabled('Установить MeetSpace'),true);
    await click('#desktop-ssh-acme-consent');assert.equal(await isDisabled('Установить MeetSpace'),true);
    await click('#desktop-ssh-docker-consent');assert.equal(await isDisabled('Установить MeetSpace'),true);
    await field('desktop-smtp-password','smtp-ui-fixture-only');await until(async()=> !(await isDisabled('Установить MeetSpace')),'All consents and SMTP password enable installation');
    await clickText('Установить MeetSpace');await visible('Соединение прервано');
    assert.equal(calls.filter(c=>c.action==='apply').length,1);
    await field('desktop-ssh-password','local-ui-fixture-only');await clickText('Проверить состояние');await visible('Установка ждёт продолжения');
    assert.equal(await isDisabled('Возобновить установку'),true);
    assert.match(await execute("document.querySelector('.desktop-ssh-phases .is-current').textContent"),/Сборка компонентов/);
    assert.equal(await execute("document.querySelector('#desktop-ssh-password').value"),'','Terminal status must clear manually submitted credentials');
    await field('desktop-ssh-password','local-ui-fixture-only');await click('#desktop-ssh-resume-consent');await clickText('Возобновить установку');await visible('Сервер MeetSpace готов');
    assert.equal(calls.filter(c=>c.action==='apply').length,1);
    checks.push('Ambiguous apply preserves ticket, accepts reauthentication and checks status without duplicate apply; explicit resume binds saved plan hash');
    await execute("document.querySelector('.desktop-ssh-progress').scrollIntoView({block:'start'});void 0");
    await fs.writeFile(path.join(output,'ssh-completed.png'),(await window.webContents.capturePage()).toPNG());
    const saved = await execute('JSON.stringify(localStorage)');assert.equal(saved.includes('local-ui-fixture-only'),false);assert.equal(saved.includes('smtp-ui-fixture-only'),false);
    await clickText('К подключению к серверу');await visible('Подключиться к серверу');await until(()=>Promise.resolve(calls.some(c=>c.action==='detach')),'Wizard unmount detaches native credentials');
    checks.push('No SSH credentials in localStorage; terminal status clears reentered password and leaving wizard calls native detach');
    state={...state,status:undefined,phase:'error',error:{code:'STATE_UNAVAILABLE',message:'Состояние задания недоступно.'},hasCredentials:false};
    await clickText('Установить сервер по SSH');await visible('Удалить локальную карточку');
    assert.equal(await isDisabled('Удалить локальную карточку'),true);
    await clickText('К подключению к серверу');await visible('Подключиться к серверу');
    state={...state,identity:{...state.identity,trusted:false,changed:true},error:{code:'TICKET_INVALID',message:'Ключ сохранённого задания изменился.'}};
    await clickText('Установить сервер по SSH');await visible('Удалить локальную карточку');
    assert.equal(await isDisabled('Удалить локальную карточку'),true);
    await click('#desktop-ssh-forget-consent');await clickText('Удалить локальную карточку');
    await until(()=>Promise.resolve(calls.some(c=>c.action==='forget')),'Explicit local recovery-card removal reaches native controller');
    assert.equal(calls.filter(c=>c.action==='apply').length,1);
    checks.push('STATE_UNAVAILABLE and changed/untrusted host both permit only explicit local ticket removal, without duplicate apply or remote deletion');
    const report={ok:true,platform:process.platform,arch:process.arch,checks,remoteMode:'deterministic IPC fixture; no remote installation',actionSequence:calls.map(c=>c.action)};
    await fs.writeFile(path.join(output,'ssh-ui.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
    clearTimeout(watchdog);app.exit(0);
  }catch(e){console.error(e.stack);if(window)await fs.writeFile(path.join(output,'ssh-ui-failure.png'),(await window.webContents.capturePage()).toPNG()).catch(()=>{});clearTimeout(watchdog);app.exit(1);}
})();
