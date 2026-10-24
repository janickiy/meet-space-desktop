// Real Electron renderer/preload/IPC; remote installer replies are a deterministic
// fixture. Real SSH handshakes and controller persistence have separate tests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {app, ipcMain} = require('electron');
app.setPath('userData', process.argv[2]); app.setPath('sessionData',process.argv[2]);
const {startApp} = require('../dist/main.js');
const output = path.resolve(__dirname,'../artifacts/ssh-installer-images-20261024');
(async () => {
  const calls=[], checks=[], screenshots=[], layoutChecks=[];
  let window, state={busy:false,phase:'idle',hasCredentials:false};
  let sequence=0, statusReply='running';
  const plan = {hash:'a'.repeat(64),version:'v1.2.3',commit:'b'.repeat(40),options:{domain:'meet.example.com',publicIpv4:'8.8.8.8'},architecture:'arm64',installDocker:true,expiresAt:Math.floor(Date.now()/1000)+900,sourceSelection:'release: v1.2.3',sourceSha256:'c'.repeat(64),resourceProfile:'compact-test',installDockerPluginsOnly:false,missingDockerPlugins:[],actions:['install-docker']};
  const phases=['docker','source','images','configuration','dependencies','backup','migrations','https','services','readiness'];
  const preflightChecks = [
    {id:'os',title:'Операционная система',level:'pass',detail:'Ubuntu 24.04. Автоматическая установка поддерживает Ubuntu 22.04 и 24.04 LTS.'},
    {id:'architecture',title:'Архитектура',level:'pass',detail:'x86_64. Поддерживаются ARM64 и x64.'},
    {id:'cpu',title:'Процессор',level:'pass',detail:'4 CPU. Ресурсов достаточно для установки MeetSpace.'},
    {id:'memory',title:'Оперативная память',level:'pass',detail:'8 ГБ RAM. Можно использовать стандартный режим установки.'},
    {id:'disk',title:'Свободное место',level:'pass',detail:'42 ГБ доступно. Для компонентов и записей требуется не менее 30 ГБ.'},
    {id:'docker',title:'Docker',level:'pass',detail:'Docker уже установлен. Используем существующую установку и сохраним её данные.'},
    {id:'port-80',title:'Порт 80/TCP',level:'warn',detail:'Порт занят. Существующий сервис не останавливался; совместное размещение проверяется планом.'},
    {id:'port-443',title:'Порт 443/TCP',level:'warn',detail:'Порт занят. Существующий сервис не останавливался; совместное размещение проверяется планом.'},
    {id:'dns',title:'DNS домена',level:'warn',detail:'Домен пока не разрешается. До запуска HTTPS настройте DNS на адрес сервера.'},
    {id:'external-network',title:'Firewall и внешняя сеть',level:'unknown',detail:'Внешние TCP/UDP и cloud firewall требуют отдельной проверки.'},
  ];
  const status = (value, phase='images') => ({jobId:state.ticket.jobId,state:value,phase,completedPhases:value==='completed'?phases:['docker','source'],events:[{sequence:++sequence,state:value,phase}],terminal:['completed','needs_recovery'].includes(value)});
  const watchdog=setTimeout(()=>app.exit(1),85000);
  try {
    window=await startApp({show:false,userDataDir:process.argv[2],rendererRoot:path.resolve(__dirname,'../../frontend/dist-desktop')});
    assert.ok(window);
    // Exercise the narrow responsive layout rather than letting the production
    // minimum window width silently enlarge the requested QA viewport.
    window.setMinimumSize(0,0);
    ipcMain.removeHandler('meetspace:ssh:state');
    ipcMain.handle('meetspace:ssh:state',() => ({ok:true,value:state}));
    ipcMain.removeHandler('meetspace:ssh:action');
    ipcMain.handle('meetspace:ssh:action',async(event,action,input)=>{
      assert.equal(event.sender,window.webContents); assert.equal(event.senderFrame,window.webContents.mainFrame);
      calls.push({action,input}); state.error=undefined;
      if(action==='discover') state={busy:false,phase:'host-key',hasCredentials:false,endpoint:input.endpoint,identity:{fingerprint:'SHA256:'+'F'.repeat(43),algorithm:'ssh-ed25519',changed:false,trusted:false}};
      if(action==='acceptHostKey'){assert.equal(input.fingerprint,state.identity.fingerprint);state.identity.trusted=true;state.phase='trusted';}
      if(action==='preflight') {assert.equal(input.credentials.password,'local-ui-fixture-only'); state.hasCredentials=true;state.phase='preflight';state.preflight={domain:input.domain,checkedAt:new Date().toISOString(),ready:true,checks:preflightChecks};}
      if(action==='plan'){
        assert.ok(['images','source'].includes(input.options.imageMode));
        assert.equal(input.options.imageRelease,input.options.imageMode==='images'?'latest':undefined);
        plan.options=input.options;plan.imageMode=input.options.imageMode;
        plan.imageArchiveSha256=plan.imageMode==='images'?'d'.repeat(64):undefined;
        plan.imageArchiveBytes=plan.imageMode==='images'?200*1024*1024:undefined;
        state.plan=structuredClone(plan);state.phase='planned';assert.equal(input.smtpPassword,undefined);
      }
      if(action==='apply') {
        assert.equal(input.confirmedPlanHash,plan.hash);assert.equal(input.acceptAcmeTerms,true);assert.equal(input.confirmDockerInstall,true);
        if(plan.options.smtp) assert.equal(input.smtpPassword,'smtp-ui-fixture-only');
        else assert.ok(input.smtpPassword===undefined || input.smtpPassword==='', 'Disabled SMTP must not retain a password');
        state.ticket={jobId:'592ec96c-2562-4509-95ef-fbe145f2e22f',domain:plan.options.domain,...state.endpoint,planHash:plan.hash};
        state.phase='error';state.error={code:'NETWORK',message:'Соединение прервано. Проверьте состояние задания.'};state.hasCredentials=false;
      }
      if(action==='status') {
        assert.ok(input.credentials?.password || state.hasCredentials);
        state.hasCredentials=statusReply==='running';
        if(statusReply==='stale') {
          // Failed polling retains the last successful snapshot; the renderer must
          // not describe it as a fresh, actively progressing observation.
          state.phase='error';state.error={code:'NETWORK',message:'Не удалось обновить состояние задания.'};
        } else {
          state.phase='running';state.status=status(statusReply,'images:api');
        }
      }
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
    await fs.mkdir(output,{recursive:true});
    const capture = async (name, {width=1280,height=800,theme='light',selector='.desktop-ssh-installer',largeText=false}={}) => {
      window.setContentSize(width,height);
      await execute(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.dataset.largeText=${JSON.stringify(String(largeText))};document.documentElement.style.setProperty('--text-scale',${JSON.stringify(largeText ? '1.5' : '1')});document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'});void 0`);
      await execute('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
      await new Promise(resolve=>setTimeout(resolve,250));
      {
        const layout = await execute(`(() => {
          const root=document.documentElement;
          const selectors='.desktop-foundation-card,.desktop-ssh-installer,.desktop-ssh-checks,.desktop-ssh-checks li,.desktop-ssh-installer .button,.desktop-ssh-installer input,.desktop-ssh-progress-summary,.desktop-ssh-phases,.desktop-ssh-phases li,.desktop-ssh-source-options,.desktop-ssh-source-option,.desktop-ssh-phase-details';
          const overflowing=[...document.querySelectorAll(selectors)].filter(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1).map(element => ({selector:element.id || element.className,width:element.clientWidth,scrollWidth:element.scrollWidth}));
          return {viewport:{width:innerWidth,height:innerHeight},scale:getComputedStyle(root).getPropertyValue('--text-scale').trim(),documentWidth:root.clientWidth,documentScrollWidth:root.scrollWidth,overflowing};
        })()`);
        layoutChecks.push({name,...layout});
        assert.deepEqual(layout.viewport,{width,height},'Capture uses the requested viewport, without OS minimum-size clamping');
        assert.equal(layout.scale,largeText?'1.5':'1');
        assert.ok(layout.documentScrollWidth <= layout.documentWidth + 1, 'Installer must not overflow the document horizontally');
        assert.deepEqual(layout.overflowing,[], 'Installer cards, choices, checks, buttons and inputs must fit horizontally');
      }
      await fs.writeFile(path.join(output,`${name}.png`),(await window.webContents.capturePage()).toPNG());
      screenshots.push({name,width,height,theme,textScale:largeText ? 1.5 : 1});
    };
    const progressSnapshot = () => execute(`(() => {
      const summary=document.querySelector('.desktop-ssh-progress-summary');
      const bar=summary?.querySelector('[role=progressbar]');
      const plan=document.querySelector('details.desktop-ssh-saved-plan');
      const box=summary?.getBoundingClientRect();
      return {
        text:summary?.textContent,mode:summary?.dataset.mode,
        percent:bar?.getAttribute('aria-valuenow') ?? null,
        minimum:bar?.getAttribute('aria-valuemin'),maximum:bar?.getAttribute('aria-valuemax'),
        valueText:bar?.getAttribute('aria-valuetext'),
        planClosed:!!plan && !plan.open,
        summaryBeforePlan:!!summary && !!plan && !!(summary.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING),
        summaryBounds:box ? {top:box.top,bottom:box.bottom,height:innerHeight} : null,
        summaryVisible:!!box && box.top >= -1 && box.bottom <= innerHeight + 1,
        timelineClosed:!!document.querySelector('details.desktop-ssh-phase-details') && !document.querySelector('details.desktop-ssh-phase-details').open,
        completedSteps:document.querySelectorAll('.desktop-ssh-phases .is-complete').length,
        activeSteps:[...document.querySelectorAll('.desktop-ssh-phases .is-current')].map(item=>item.textContent),
      };
    })()`);
    const assertProgress = async (percent, mode) => {
      await until(async()=> (await progressSnapshot()).mode===mode, 'Missing progress mode '+mode);
      const observed=await progressSnapshot();
      assert.equal(observed.percent,percent===null ? null : String(percent));
      assert.equal(observed.minimum,'0');assert.equal(observed.maximum,'100');
      assert.ok(observed.valueText,'Progress exposes a useful screen-reader description');
      assert.ok(observed.planClosed,'Saved plan must start collapsed once a ticket exists');
      assert.ok(observed.summaryBeforePlan,'Installation progress must precede the saved plan');
      return observed;
    };
    const captureProgress = async (name, options={}) => {
      await capture(name,{...options,selector:'.desktop-ssh-progress-summary'});
      const observed=await progressSnapshot();
      assert.ok(observed.summaryVisible,'Progress, percentage and current stage must fit in the visible viewport: '+JSON.stringify(observed.summaryBounds));
      return observed;
    };
    const captureRunning = async (name, options={}) => {
      await capture(name,{selector:'.desktop-ssh-installer',...options});
      const observed=await progressSnapshot();
      assert.ok(observed.timelineClosed,'Full timeline starts collapsed while the actual current stage stays visible');
      assert.ok(observed.summaryVisible,'Current stage and percentage fit without scrolling the full timeline: '+JSON.stringify(observed.summaryBounds));
      const actions=await execute(`[...document.querySelectorAll('.desktop-ssh-progress > .desktop-ssh-actions button')].map(button=>{const r=button.getBoundingClientRect();return {label:button.textContent.trim(),disabled:button.disabled,top:r.top,bottom:r.bottom,height:innerHeight};})`);
      assert.equal(actions.length,2);
      for(const action of actions) assert.ok(action.top>=0 && action.bottom<=action.height,'Running action must be visible: '+JSON.stringify(action));
      layoutChecks.push({name,kind:'running-action-visibility',timelineClosed:observed.timelineClosed,actions});
    };
    await visible('Начнём с подключения');await clickText('Продолжить');await visible('Подключиться к серверу');await clickText('Установить сервер по SSH');await visible('SSH-адрес хоста');
    await capture('ssh-host-1280-light');
    await capture('ssh-host-1920-dark',{width:1920,height:1080,theme:'dark'});
    await field('desktop-ssh-host','vps.example.com');await clickText('Проверить ключ хоста');await visible('Подтвердите ключ хоста');
    assert.equal(await isDisabled('Доверять этому ключу'),true);assert.equal(calls.some(c=>c.input.credentials),false);
    await click('.desktop-ssh-trust input[type=checkbox]');await clickText('Доверять этому ключу');await visible('Домен MeetSpace');
    assert.equal(await execute(`document.querySelector('input[name="desktop-ssh-image-mode"]:checked').value`),'images','Ready Docker images are the default');
    assert.equal(await execute(`document.getElementById('desktop-ssh-image-release').value`),'latest','Ready-image release defaults to latest');
    assert.doesNotMatch(await execute(`document.querySelector('.reference-welcome-brand').textContent`),/WINDOWS|LINUX/i,'The logo has no platform caption');
    await capture('ssh-image-mode-1280-light',{selector:'.desktop-ssh-install-source'});
    await capture('ssh-image-mode-800-dark-large-text',{width:800,height:900,theme:'dark',largeText:true,selector:'.desktop-ssh-install-source'});
    await click('input[name="desktop-ssh-image-mode"][value="source"]');
    assert.equal(await execute(`document.querySelector('input[name="desktop-ssh-image-mode"]:checked').value`),'source');
    assert.equal(await execute(`!!document.getElementById('desktop-ssh-image-release')`),false,'Source mode has no archive release selector');
    await click('input[name="desktop-ssh-image-mode"][value="images"]');
    assert.equal(await execute(`document.querySelector('input[name="desktop-ssh-image-mode"]:checked').value`),'images');
    checks.push('Ready Docker images are selected by default; both native radio choices change the selected mode; logo platform caption is removed');
    await capture('ssh-trusted-1280-light');
    await capture('ssh-trusted-1920-dark',{width:1920,height:1080,theme:'dark'});
    await field('desktop-ssh-domain','meet.example.com');await field('desktop-ssh-public-ip','8.8.8.8');await field('desktop-ssh-password','local-ui-fixture-only');
    assert.equal(await execute("document.getElementById('desktop-smtp-enabled').checked"),false);
    assert.equal(await execute("!!document.getElementById('desktop-smtp-host')"),false);
    await visible('Без SMTP приглашения и напоминания');await click('#desktop-smtp-enabled');
    await field('desktop-smtp-host','smtp.example.com');await field('desktop-smtp-from','meetings@example.com');await field('desktop-smtp-username','meetings@example.com');await clickText('Проверить готовность хоста');
    await visible('Подготовить план установки');
    assert.equal(await execute("document.querySelectorAll('.desktop-ssh-checks li').length"),preflightChecks.length);
    await capture('ssh-checks-1280-light',{selector:'.desktop-ssh-preflight'});
    await capture('ssh-checks-1920-light',{width:1920,height:1080,selector:'.desktop-ssh-preflight'});
    await capture('ssh-checks-1920-dark',{width:1920,height:1080,theme:'dark',selector:'.desktop-ssh-preflight'});
    await capture('ssh-checks-1280-large-text',{selector:'.desktop-ssh-preflight',largeText:true});
    checks.push('Representative preflight pass, warning and unknown states render at 1280×800 and 1920×1080; 150% text has no horizontal overflow');
    await execute("document.documentElement.dataset.largeText='false';document.documentElement.style.setProperty('--text-scale','1');void 0");
    await clickText('Подготовить план установки');await visible('План установки');
    assert.equal(calls.filter(c=>c.action==='plan').length,1);
    assert.equal(calls.find(c=>c.action==='plan').input.options.imageMode,'images');
    assert.equal(calls.find(c=>c.action==='plan').input.options.imageRelease,'latest');
    const imagePlan=await execute(`document.querySelector('.desktop-ssh-plan').textContent`);
    assert.match(imagePlan,/Готовые Docker-образы/);assert.match(imagePlan,/SHA-256 архива образов/);assert.match(imagePlan,/200 МБ/);
    assert.ok(imagePlan.includes('d'.repeat(64)));
    checks.push('The actual plan IPC request sends imageMode=images and imageRelease=latest, and the resulting immutable plan shows archive checksum and size');
    assert.equal(await isDisabled('Установить MeetSpace'),true);
    assert.equal(await execute("!!document.querySelector('#desktop-ssh-password')"),false);
    checks.push('Host fingerprint confirmation precedes credentials; preflight credentials leave React form; immutable plan requires all three consents');
    await capture('ssh-plan-light',{selector:'.desktop-ssh-plan'});
    await capture('ssh-plan-dark',{width:1920,height:1080,theme:'dark',selector:'.desktop-ssh-plan'});
    await click('#desktop-ssh-plan-consent');assert.equal(await isDisabled('Установить MeetSpace'),true);
    await click('#desktop-ssh-acme-consent');assert.equal(await isDisabled('Установить MeetSpace'),true);
    await click('#desktop-ssh-docker-consent');assert.equal(await isDisabled('Установить MeetSpace'),true);
    await field('desktop-smtp-password','smtp-ui-fixture-only');await until(async()=> !(await isDisabled('Установить MeetSpace')),'All consents and SMTP password enable installation');
    await clickText('Установить MeetSpace');await visible('Соединение прервано');
    assert.equal(calls.filter(c=>c.action==='apply').length,1);
    const unknown=await assertProgress(null,'unknown');
    assert.equal(unknown.mode,'unknown');
    assert.match(unknown.text,/Состояние установки неизвестно/);
    assert.doesNotMatch(unknown.text,/\d+\s*%/,'Unknown status must not present a numerical completion percentage');
    await captureProgress('ssh-progress-unknown-1280-light');
    checks.push('Ticket without a remote status has an indeterminate progress bar; no fabricated percentage is shown');
    await field('desktop-ssh-password','local-ui-fixture-only');await clickText('Проверить состояние');await visible('Установка выполняется');
    const running=await assertProgress(20,'running');
    assert.equal(running.mode,'running');
    assert.equal(running.completedSteps,2);
    assert.equal(running.activeSteps.length,1);
    assert.match(running.activeSteps[0],/Загрузка Docker-образов/);
    assert.match(running.text,/20\s*%/,'Progress percentage must be visible as text, not only exposed to assistive technology');
    assert.match(running.text,/Этап\s+3\s+из\s+10/);
    assert.match(running.text,/Завершено этапов:\s*2\s+из\s+10/);
    assert.match(running.text,/Загрузка Docker-образов/);
    assert.doesNotMatch(running.text,/Сборка компонентов/);
    assert.match(running.text,/API/);
    assert.equal(running.timelineClosed,true);
    await captureRunning('ssh-progress-running-top-1280-light');
    await captureRunning('ssh-progress-running-top-1366-light',{width:1366,height:768});
    await captureRunning('ssh-progress-running-top-800-light',{width:800,height:900});
    await captureRunning('ssh-progress-running-top-1280-dark',{theme:'dark'});
    await captureRunning('ssh-progress-running-800-dark-large-text',{width:800,height:900,theme:'dark',largeText:true,selector:'.desktop-ssh-progress-summary'});
    await click('details.desktop-ssh-phase-details > summary');
    await visible('Проверка готового выпуска');
    assert.equal(await execute(`document.querySelectorAll('.desktop-ssh-phases li').length`),10);
    await click('details.desktop-ssh-phase-details > summary');
    checks.push('Running image download shows the actual 20% and current stage with a collapsed expandable ten-stage timeline; status/stop actions are visible at 1280×800, 1366×768 and 800×900, including dark 150% text after the progress heading is brought into view');
    await captureProgress('ssh-progress-running-1280-light');
    await captureProgress('ssh-progress-running-1280-dark',{theme:'dark'});
    await captureProgress('ssh-progress-running-1280-large-text',{largeText:true});
    await execute("document.documentElement.dataset.largeText='false';document.documentElement.style.setProperty('--text-scale','1');void 0");
    checks.push('Running image download shows 20% from two confirmed steps, the current stage and API detail above a collapsed saved plan in light/dark themes and at 150% text');
    statusReply='stale';
    await until(async()=> !(await isDisabled('Проверить состояние')),'Status refresh becomes available');
    await clickText('Проверить состояние');await visible('Не удалось обновить состояние задания.');
    const stale=await assertProgress(20,'stale');
    assert.equal(stale.mode,'stale');
    assert.match(stale.text,/Нет актуального состояния/);
    assert.match(stale.text,/Показаны последние полученные данные/);
    assert.equal(stale.completedSteps,2,'A failed poll preserves the last confirmed progress');
    assert.doesNotMatch(stale.text,/Установка выполняется/,'A stale snapshot must not be presented as current installation activity');
    await captureProgress('ssh-progress-stale-1280-light');
    checks.push('A failed status refresh preserves the last confirmed percentage and identifies the snapshot as stale');
    statusReply='needs_recovery';
    await field('desktop-ssh-password','local-ui-fixture-only');await clickText('Проверить состояние');await visible('Установка ждёт продолжения');
    const recovery=await assertProgress(20,'needs_recovery');
    assert.equal(recovery.mode,'needs_recovery');
    assert.equal(recovery.completedSteps,2);
    assert.match(recovery.text,/Загрузка Docker-образов/);
    assert.equal(await isDisabled('Возобновить установку'),true);
    assert.equal(await execute("document.querySelector('#desktop-ssh-password').value"),'','Terminal status must clear manually submitted credentials');
    await captureProgress('ssh-progress-paused-1280-light');
    await field('desktop-ssh-password','local-ui-fixture-only');await click('#desktop-ssh-resume-consent');await clickText('Возобновить установку');await visible('Ваше пространство готово.');
    assert.equal(calls.filter(c=>c.action==='apply').length,1);
    checks.push('Ambiguous apply preserves ticket, accepts reauthentication and checks status without duplicate apply; explicit resume binds saved plan hash');
    const completed=await assertProgress(100,'completed');
    assert.equal(completed.mode,'completed');
    assert.equal(completed.completedSteps,10);
    assert.match(completed.text,/100\s*%/);
    assert.equal(completed.activeSteps.length,0,'Completed installation has no current stage left');
    assert.equal(await execute("document.querySelector('details.desktop-ssh-completed-phases').open"),false,'Completed timeline is collapsed so the connection action stays prominent');
    await capture('ssh-completed-1440-light',{width:1440,height:1000});
    await capture('ssh-completed-1280-light');
    await capture('ssh-completed-1440-dark',{width:1440,height:1000,theme:'dark'});
    await capture('ssh-completed-800-light',{width:800,height:900});
    await capture('ssh-completed-1280-large-text',{largeText:true});
    const completedLayout=await execute(`(()=>{const action=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Подключиться к MeetSpace');const r=action.getBoundingClientRect();return {top:r.top,bottom:r.bottom,viewport:innerHeight,hasResultCard:!!document.querySelector('.desktop-ssh-result-address'),completionCaption:document.querySelector('.desktop-ssh-step-caption').textContent,hasReferenceArt:!!document.querySelector('.desktop-ssh-art')};})()`);
    assert.ok(completedLayout.hasResultCard);assert.match(completedLayout.completionCaption,/05 \/ 05/);assert.ok(completedLayout.hasReferenceArt);
    await execute("document.documentElement.dataset.largeText='false';document.documentElement.style.setProperty('--text-scale','1');void 0");
    await capture('ssh-completed-1440-light',{width:1440,height:1000});
    const readyAction=await execute(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Подключиться к MeetSpace');const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};})()`);
    assert.ok(readyAction.top>=0&&readyAction.bottom<=readyAction.height,'Completed connection action is visible without scrolling at reference size');
    checks.push('Reference completion screen includes 05/05, success icon, server address, collapsed completed timeline and a visible connect action; light/dark, narrow window and 150% text layouts captured');
    // A local keyring outage must not turn a completed remote installation into
    // a failed install. Retry follows the actual preload/parent refresh path.
    let storageAvailable=false,storageRefreshes=0;
    const serverState=()=>({items:[],selectedId:null,generation:0,storageAvailable});
    ipcMain.removeHandler('meetspace:servers:list');
    ipcMain.handle('meetspace:servers:list',event=>{assert.equal(event.sender,window.webContents);storageRefreshes++;storageAvailable=true;return {ok:true,value:serverState()};});
    window.webContents.send('meetspace:transport',{kind:'servers',type:'changed',state:serverState()});
    await visible('Проверить хранилище');
    assert.equal(await isDisabled('Подключиться к MeetSpace'),true);
    await assertProgress(100,'completed');
    await capture('ssh-completed-storage-unavailable',{width:1440,height:1000});
    await clickText('Проверить хранилище');
    await until(async()=>!(await isDisabled('Подключиться к MeetSpace')),'Storage recovery enables connection without restarting installation');
    assert.equal(storageRefreshes,1);assert.equal(calls.filter(c=>c.action==='apply').length,1);
    await assertProgress(100,'completed');
    assert.equal(await execute("!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Проверить хранилище')"),false);
    checks.push('Completed installation with unavailable local storage retains 100%, disables connection and exposes explicit keyring retry; one native listServers refresh recovers it without duplicate apply');
    checks.push('Only confirmed completion reaches 100%; every installation stage is marked complete');
    // Exercise the actual preload rejection and the SSH wizard's onConnect
    // catch: a compatible transport must not become a fabricated DNS/TLS error.
    ipcMain.removeHandler('meetspace:servers:probe');
    let connectionProbes=0, connectionFailureCode='incompatible_server';
    ipcMain.handle('meetspace:servers:probe',(event,origin)=>{
      assert.equal(event.sender,window.webContents);assert.equal(event.senderFrame,window.webContents.mainFrame);
      assert.equal(origin,'https://meet.example.com');connectionProbes++;
      return {ok:false,error:{code:connectionFailureCode,message:'UNTRUSTED_CONNECTION_DETAIL_WITH_SECRET'}};
    });
    await clickText('Подключиться к MeetSpace');await visible('версия несовместима с этим приложением');
    const connectionError=await execute("document.querySelector('.desktop-ssh-installer .error-notice').textContent");
    assert.doesNotMatch(connectionError,/DNS|HTTPS|сертификат|сети|UNTRUSTED_CONNECTION_DETAIL_WITH_SECRET/);
    assert.equal(connectionProbes,1);
    assert.equal(calls.filter(c=>c.action==='apply').length,1,'Connection failure must not restart server installation');
    await assertProgress(100,'completed');
    for(const code of ['incompatible_server','tls_error','dns_error','network_timeout','network_unavailable','secure_storage_unavailable']) {
      connectionFailureCode=code;
      const rejection=await execute("window.meetspaceDesktop.probeServer('https://meet.example.com').then(()=>({unexpectedSuccess:true}),error=>({code:error.code,keys:Object.keys(error).sort()}))");
      assert.equal(rejection.code,code,'Native error code must survive the isolated preload/contextBridge boundary');
      assert.deepEqual(rejection.keys,['code','message'],'Only the explicit native rejection DTO crosses the bridge');
    }
    ipcMain.removeHandler('meetspace:http');
    ipcMain.handle('meetspace:http',(event,input)=>{
      assert.equal(event.sender,window.webContents);assert.equal(event.senderFrame,window.webContents.mainFrame);
      assert.equal(input.path,'/api/v1/auth/me');
      return {ok:false,error:{code:'network_unavailable',message:'Сервер недоступен. Проверьте подключение или выберите другой сервер.'}};
    });
    const httpRejection=await execute("window.meetspaceDesktop.http({id:crypto.randomUUID(),method:'GET',path:'/api/v1/auth/me',responseType:'json'}).then(()=>({unexpectedSuccess:true}),error=>({code:error.code,message:error.message,keys:Object.keys(error).sort()}))");
    assert.deepEqual(httpRejection,{code:'network_unavailable',message:'Сервер недоступен. Проверьте подключение или выберите другой сервер.',keys:['code','message']});
    checks.push('A completed-server connection rejected with incompatible_server shows compatibility guidance, without a DNS/TLS diagnosis or raw transport text; completed installation stays at 100%');
    checks.push('Native probe and HTTP rejection codes and fixed messages survive the sandboxed contextBridge as explicit code/message DTOs');
    const saved = await execute('JSON.stringify(localStorage)');assert.equal(saved.includes('local-ui-fixture-only'),false);assert.equal(saved.includes('smtp-ui-fixture-only'),false);
    await click('.desktop-ssh-close');await visible('Подключиться к серверу');await until(()=>Promise.resolve(calls.some(c=>c.action==='detach')),'Wizard unmount detaches native credentials');
    checks.push('No SSH credentials in localStorage; terminal status clears reentered password and leaving wizard calls native detach');
    state={...state,status:undefined,phase:'error',error:{code:'STATE_UNAVAILABLE',message:'Состояние задания недоступно.'},hasCredentials:false};
    await clickText('Установить сервер по SSH');await visible('Управление локальной карточкой установки');await click('details.desktop-ssh-recovery > summary');await visible('Удалить локальную карточку');
    assert.equal(await isDisabled('Удалить локальную карточку'),true);
    await click('.desktop-ssh-close');await visible('Подключиться к серверу');
    state={...state,identity:{...state.identity,trusted:false,changed:true},error:{code:'TICKET_INVALID',message:'Ключ сохранённого задания изменился.'}};
    await clickText('Установить сервер по SSH');await visible('Управление локальной карточкой установки');await click('details.desktop-ssh-recovery > summary');await visible('Удалить локальную карточку');
    assert.equal(await isDisabled('Удалить локальную карточку'),true);
    await click('#desktop-ssh-forget-consent');await clickText('Удалить локальную карточку');
    await until(()=>Promise.resolve(calls.some(c=>c.action==='forget')),'Explicit local recovery-card removal reaches native controller');
    assert.equal(calls.filter(c=>c.action==='apply').length,1);
    checks.push('STATE_UNAVAILABLE and changed/untrusted host both permit only explicit local ticket removal, without duplicate apply or remote deletion');
    // A second, explicit source selection must change the real plan request;
    // it must not silently fall back to ready images or retain the prior archive.
    statusReply='running';
    await visible('SSH-адрес хоста');
    await field('desktop-ssh-host','vps.example.com');await clickText('Проверить ключ хоста');await visible('Подтвердите ключ хоста');
    await click('.desktop-ssh-trust input[type=checkbox]');await clickText('Доверять этому ключу');await visible('Домен MeetSpace');
    await click('input[name="desktop-ssh-image-mode"][value="source"]');
    await field('desktop-ssh-domain','meet.example.com');await field('desktop-ssh-public-ip','8.8.8.8');await field('desktop-ssh-password','local-ui-fixture-only');
    if(await execute(`document.getElementById('desktop-smtp-enabled').checked`)) await click('#desktop-smtp-enabled');
    await clickText('Проверить готовность хоста');await visible('Подготовить план установки');await clickText('Подготовить план установки');await visible('План установки');
    const sourceRequest=calls.filter(c=>c.action==='plan').at(-1);
    assert.equal(sourceRequest.input.options.imageMode,'source');assert.equal(sourceRequest.input.options.imageRelease,undefined);
    const sourcePlan=await execute(`document.querySelector('.desktop-ssh-plan').textContent`);
    assert.match(sourcePlan,/Сборка из исходного кода/);assert.match(sourcePlan,/SHA-256 исходного кода/);assert.doesNotMatch(sourcePlan,/Размер образов|SHA-256 архива образов/);
    await click('#desktop-ssh-plan-consent');await click('#desktop-ssh-acme-consent');await click('#desktop-ssh-docker-consent');
    await clickText('Установить MeetSpace');await visible('Соединение прервано');
    await field('desktop-ssh-password','local-ui-fixture-only');await clickText('Проверить состояние');await visible('Установка выполняется');
    const sourceRunning=await assertProgress(20,'running');
    assert.match(sourceRunning.text,/Сборка компонентов/);assert.doesNotMatch(sourceRunning.text,/Загрузка Docker-образов/);
    assert.equal(calls.filter(c=>c.action==='apply').length,2,'Exactly one installation starts for each of the two explicitly tested modes');
    await captureRunning('ssh-progress-source-top-1366-light',{width:1366,height:768});
    checks.push('Explicit source selection sends imageMode=source without imageRelease, shows source checksum instead of archive metadata, and keeps source compilation labels for actual running status');
    const report={ok:true,platform:process.platform,arch:process.arch,checks,screenshots,layoutChecks,remoteMode:'deterministic IPC fixture; no remote installation',actionSequence:calls.map(c=>c.action)};
    await fs.writeFile(path.join(output,'ssh-ui.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
    clearTimeout(watchdog);app.exit(0);
  }catch(e){console.error(e.stack);if(window)await fs.writeFile(path.join(output,'ssh-ui-failure.png'),(await window.webContents.capturePage()).toPNG()).catch(()=>{});clearTimeout(watchdog);app.exit(1);}
})();
