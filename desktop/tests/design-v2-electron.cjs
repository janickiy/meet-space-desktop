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
const { createCertificates, PASSWORD, CONFERENCE, USER_A, USER_B } = require('./fixtures/https-fixture.cjs');
const { createProductFixture, DIRECT, GROUP, FOLDER, RECORDING } = require('./fixtures/product-fixture.cjs');
(async () => {
 let cert, fixture, window;
 const captures = [], checks = [];
 const output = path.resolve(__dirname, '../artifacts/design-v2');
 const watchdog = setTimeout(() => { console.error('Design QA timeout'); app.exit(1); }, 170000);
 try {
  await fs.mkdir(output, {recursive:true});
  cert = await createCertificates(); fixture = await createProductFixture(cert);
  const message = (n, own, text) => ({id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`,sequence:String(n),
    senderId:own?USER_A:USER_B,senderName:own?'Product owner':'Product direct peer',text,attachments:[],
    createdAt:new Date(Date.now()-600000+n*60000).toISOString(),version:1,deletedAt:null,important:false,replyTo:null});
  fixture.product.controls.messages = [
    message(1,false,'Product server message. Привет! Подготовил новую сборку. Покажу, что получилось с навигацией и сообщениями.'),
    {...message(2,true,'Отлично! Добавил вопросы к обсуждению. Посмотрите перед встречей.'),attachments:[fixture.product.attachment]},
    message(3,false,'Я тоже буду. Принесу обратную связь от пользователей — есть несколько интересных наблюдений.'),
    message(4,false,'Здорово, до встречи на синке! 👋'),
  ];
  window = await startApp({show:false,userDataDir:process.argv[2],rendererRoot:path.resolve(__dirname,'../../frontend/dist-desktop'),brokerOptions:{transport:createNodeHttpsTransport({ca:cert.ca,timeoutMs:3000}),createSocket:(url,protocols,options)=>new WebSocket(url,protocols,{...options,ca:cert.ca,rejectUnauthorized:true})}});
  window.setContentSize(1280,800);
  const execute=code=>window.webContents.executeJavaScript(code,true);
  const until=async(predicate,label)=>{const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,40));}throw new Error(label);};
  const visible=value=>until(async()=>(await execute('document.body.innerText')).includes(value),`Missing ${value}`);
  const click=selector=>execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('Missing action: '+${JSON.stringify(selector)});e.click()})()`);
  const clickTextInForm = text => execute(`(() => { const b=[...document.querySelectorAll('#auth-form button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if (!b) throw new Error('Missing form action');b.click(); })()`);
  const tab=label=>execute(`(()=>{const e=[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw new Error('Missing settings tab: '+${JSON.stringify(label)});e.click()})()`);
  const field=(selector,value)=>execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing field');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const route=async value=>{window.webContents.send('meetspace:route',value);await until(()=>execute(`location.pathname+location.search===${JSON.stringify(value)}`),'Route applies');};
  const reload=async()=>{
    assert.deepEqual(await execute('window.__designErrors'),[]);
    const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));
    window.webContents.reload();await loaded;
    await execute('window.__designErrors=[];window.addEventListener("error",e=>window.__designErrors.push(e.message));void 0');
  };
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
  const checkMeetingFilters = async name => {
    const compact = await execute("document.querySelector('.dashboard-mobile-filter').getClientRects().length > 0");
    if (compact) await click('.dashboard-mobile-filter');
    const root = compact ? '.meeting-filter-form' : '.conference-filters';
    await until(() => execute(`!!document.querySelector(${JSON.stringify(root)})?.getClientRects().length`), 'Meeting filters visible');
    const scope = root + ' select', from = root + ' input[aria-label="Встречи с даты"]', to = root + ' input[aria-label="Встречи по дату"]';
    const values = () => execute(`[...document.querySelector(${JSON.stringify(root)}).querySelectorAll('select, input[type=date]')].map(e=>e.value)`);
    assert.deepEqual(await values(), ['all', '', ''], 'Attendance and both dates initially show the full list');
    if (!compact) {
      const [participation, start, end, reset] = await execute(`[...document.querySelector('.conference-filters').querySelectorAll('select,input[type=date],button')].map(e=>{
        const {left, right, width, height, bottom} = e.getBoundingClientRect();
        return {left, right, width, height, bottom};
      })`);
      assert.equal(participation.height,40);
      assert.equal(start.height,40);
      assert.equal(end.height,40);
      assert.deepEqual([reset.width,reset.height],[36,36],'Reference reset is a square icon');
      for (const control of [participation,start,end]) assert.ok(Math.abs(control.bottom - reset.bottom - 1) < 1, 'Filter fields align with the 1px reset inset');
      for (const [left,right] of [[participation,start],[start,end],[end,reset]]) assert.ok(Math.abs(right.left-left.right-14)<1, 'Adjacent filters have the reference 14px gutter');
    }
    await execute(`(()=>{const e=document.querySelector(${JSON.stringify(scope)});e.value='owned';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await field(from,'2026-01-01');
    await field(to,'2026-12-31');
    assert.deepEqual(await values(),['owned','2026-01-01','2026-12-31']);
    await capture(name);
    if (compact) {
      await click(root+' button[type=submit]');
      await until(() => execute("document.querySelector('.meeting-filter-count')?.textContent==='3' && !document.querySelector('.meeting-filter-form')"),'Compact filters applied');
      await click('.meeting-chip-reset');
      await click('.dashboard-mobile-filter');
    } else await click(root+' button[aria-label="Сбросить фильтры"]');
    assert.deepEqual(await values(),['all','',''],'Reset restores attendance and both dates');
    if (compact) await click('.meeting-filter-form button[type=button]');
    await visible('Product scheduled meeting');
  };
  const checkIncomingCall=async theme=>{
    await route(`/personal/${DIRECT}`);await visible('Product server message');
    const call={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',conversationId:DIRECT,
      caller:{id:USER_B,displayName:'Product direct peer'},callee:{id:USER_A,displayName:'Product owner'},status:'ringing',version:1};
    await execute(`window.dispatchEvent(new CustomEvent('meet:direct-call',{detail:{userId:${JSON.stringify(USER_A)},call:${JSON.stringify(call)}}}));void 0`);
    await until(()=>execute('!!document.querySelector(".direct-call-accept")'),'incoming call opens');
    for(const [width,height] of [[1280,800],[390,844]]) {
      window.setMinimumSize(320,500);window.setContentSize(width,height);
      const controls=await execute(`(()=>[...document.querySelectorAll('.direct-call-controls > button')].map(e=>{const r=e.getBoundingClientRect(),caption=e.querySelector('.direct-call-control-caption'),c=caption?.getBoundingClientRect();return {width:r.width,height:r.height,top:r.top,bottom:r.bottom,label:e.getAttribute('aria-label')||e.innerText.trim(),caption:caption?.textContent.trim(),captionTop:c?.top,captionCenter:c?(c.left+c.right)/2:null,center:(r.left+r.right)/2,background:getComputedStyle(e).backgroundColor};}))()`);
      assert.equal(controls.length,4,'Incoming call has microphone, camera, answer and decline');
      assert.deepEqual(controls.map(c=>c.caption),['Микрофон','Камера','Ответить','Отклонить']);
      for(const control of controls) {
        assert.equal(control.width,controls[0].width,'Answer and decline match device control width');
        assert.equal(control.height,controls[0].height,'Answer and decline match device control height');
        assert.equal(control.top,controls[0].top,'Call controls share a row');
        assert.ok(control.label,'Call controls retain accessible names');
        assert.ok(control.captionTop>control.bottom,'Call captions sit below the icon buttons');
        assert.ok(Math.abs(control.captionCenter-control.center)<1,'Call captions are centered below their buttons');
      }
      const rgb=color=>color.match(/\d+/g).map(Number);
      const answer=rgb(controls[2].background),decline=rgb(controls[3].background);
      assert.ok(answer[1]>answer[0]&&answer[1]>answer[2],'Answer retains its green background');
      assert.ok(decline[0]>decline[1]&&decline[0]>decline[2],'Decline retains its red background');
      await capture(`incoming-call-${width}x${height}-${theme}`);
    }
    await execute(`window.dispatchEvent(new CustomEvent('meet:direct-call',{detail:{userId:${JSON.stringify(USER_A)},call:${JSON.stringify({...call,status:'ended',version:2})}}}));void 0`);
    await until(()=>execute('!document.querySelector(".direct-call-accept")'),'ended call replaces ringing controls');
    await click('.direct-call-end');
    await until(()=>execute('!document.querySelector(".direct-call-modal")'),'ended call closes');
    window.setMinimumSize(1000,700);window.setContentSize(1440,1000);
  };
  await execute('window.__designErrors=[];window.addEventListener("error",e=>window.__designErrors.push(e.message));void 0');
  await visible('Команда ближе.'); await capture('onboarding-intro-light');
  await click('[data-onboarding=connect]');
  await visible('Подключиться к серверу'); await capture('onboarding-light');
  const { nativeTheme } = require('electron');
  const initialTheme = nativeTheme.themeSource;
  nativeTheme.themeSource='dark';
  await until(()=>execute("document.documentElement.dataset.theme==='dark'"),'Connection screen follows system dark mode');
  await field('#desktop-server-origin',fixture.origin);await click('.desktop-server-form button[type=submit]');
  await until(()=>execute('!!document.querySelector("#email")'),'login ready');await until(()=>execute("document.documentElement.dataset.theme==='dark'"),'Sign-in preserves the system theme on handoff');
  await capture('login-dark');
  await click('.auth-card a[href^="/register"]');
  await until(()=>execute("!!document.querySelector('.register-card') && document.documentElement.dataset.theme==='dark'"),'Registration follows the system theme');
  await capture('register-dark');
  nativeTheme.themeSource='light';
  await until(()=>execute("document.documentElement.dataset.theme==='light'"),'Registration follows system theme changes');
  await capture('register-light');
  await click('.auth-card a[href^="/login"]');
  await until(()=>execute("!!document.querySelector('#email') && !document.querySelector('.register-card')"),'Return to sign-in');
  await capture('login-light');
  nativeTheme.themeSource=initialTheme;
  await clickTextInForm("Забыли пароль?");
  await field('#email',fixture.users[0].email); await click('#auth-form button[type=submit]');
  await visible("вы получите письмо"); await capture("password-recovery-light");
  await route("/register"); await visible("Рады знакомству"); await capture("register-light");
  fixture.controls.authMode = "ldap";
  await reload(); await visible("Корпоративный вход");
  assert.equal(await execute('location.pathname'),'/login');
  assert.equal(await execute("!!document.querySelector('.reference-auth-tabs a[href*=register]')"),false);
  await capture("ldap-light");
  fixture.controls.providersStatus = 503; await reload(); await visible("Не удалось получить настройки входа");
  assert.equal(await execute('!!document.querySelector("#password")'),false);
  fixture.controls.providersStatus = 404; fixture.controls.authMode = "local"; await clickTextInForm("Повторить");
  await until(()=>execute('!!document.querySelector("#password")'), "legacy local login after provider discovery 404");
  await field('#email',fixture.users[0].email);await field('#password',PASSWORD);await click('#auth-form button[type=submit]');
  await until(()=>execute('!!document.querySelector(".sidebar")'),'authenticated workspace');
  window.setContentSize(1440,1000);
  await require("./redesign-matrix.cjs")({window,route,visible,click,tab,execute,until,output});
  const pages=[['meetings','/conferences','Product scheduled meeting'],['chat',`/personal/${DIRECT}`,'Product server message'],['group',`/personal/${GROUP}`,'Product server message'],['folders','/folders','Product personal folder'],['folder',`/folders/${FOLDER}`,'Product scheduled meeting'],['calendar','/calendar','Product scheduled meeting'],['recordings','/recordings','Product finished meeting'],['recording',`/recordings/${RECORDING}?conference=${CONFERENCE}`,'Открыть запись']];
  for(const theme of ['light','dark']){
    // Production preference selector, rather than a CSS-only theme override.
    await route('/app/settings');await visible('Мой профиль');
    assert.equal(await execute('document.querySelector(".reference-settings-page")!==null && document.querySelector(".account-settings-modal")===null'),true,'Settings route is a page');
    await tab('Внешний вид');
    await click(`input[type=radio][value=${theme}]`);
    await until(()=>execute(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`),'theme applied');
    await capture('settings-'+theme);
    await tab('Аудио');
    await until(()=>execute(`!!document.querySelector('#devices-heading') && !!document.querySelector('select[aria-label="Микрофон"]')`),'audio settings are available');
    await capture('devices-'+theme);
    for(const [name,url,ready] of pages){
      await route(url);await visible(ready);await capture(name+'-'+theme);
      if(['meetings','folders','folder','recordings'].includes(name)){
        await click('.collection-view-toggle button[aria-pressed=false]');await capture(name+'-alternate-'+theme);
        await click('.collection-view-toggle button[aria-pressed=false]');
      }
      if(name==='meetings'){
        await checkMeetingFilters('meeting-filters-'+theme);
        assert.equal(await execute(`document.querySelector('[role=tab][id=tab-past]')?.textContent.trim()`),'Завершённые','Completed meetings tab remains available');
        const row=await execute(`(() => {const row=document.querySelector('.dashboard-meeting-row'), open=row.querySelector('.dashboard-meeting-open');
          return {path:open.pathname, title:open.querySelector('.dashboard-meeting-title').textContent,
            attendees:open.querySelector('.meeting-attendees').textContent.trim(), info:row.querySelector('.meeting-info-trigger').getAttribute('aria-haspopup')};})()`);
        assert.deepEqual(row,{path:'/meetings/'+CONFERENCE,title:fixture.product.conference.title,attendees:'2 участника',info:'dialog'},'The meeting card exposes separate room and details actions and the actual participant count');
        await click('.dashboard-meeting-row .meeting-info-trigger');
        await until(()=>execute('!!document.querySelector(".meeting-reference-info .meeting-info-facts")'),'meeting information dialog');
        await capture('meeting-info-'+theme);
        await click('.meeting-reference-info button[aria-label="Закрыть окно"]');
        await until(()=>execute('!document.querySelector(".meeting-reference-info")'),'meeting information dialog closes');
      }
      if(name==='calendar'){
        assert.equal(await execute("document.querySelectorAll('.agenda-week button').length"),7,'Agenda displays all seven days');
        const agenda = await execute(`(() => {
          const event=document.querySelector('.agenda-time .calendar-event'), times=[...event.querySelectorAll('time')];
          const day=document.querySelector('.agenda-day').getBoundingClientRect(), legend=document.querySelector('.agenda-summary').getBoundingClientRect();
          return {role:event.dataset.agendaRole, minutes:(Date.parse(times[1].dateTime)-Date.parse(times[0].dateTime))/60000,
            legendAlongside:legend.left>=day.right && Math.abs(legend.top-day.top)<1};
        })()`);
        assert.deepEqual(agenda,{role:'owner',minutes:fixture.product.conference.plannedDurationMin,legendAlongside:true},'Agenda shows the real meeting range and legend next to the timeline');
        await click('.agenda-time .calendar-event');
        await until(()=>execute('!!document.querySelector(".meeting-reference-info .meeting-info-facts")'),'calendar meeting information dialog');
        await capture('calendar-meeting-'+theme);
        await click('.meeting-reference-info button[aria-label="Закрыть окно"]');
        await until(()=>execute('!document.querySelector(".meeting-reference-info")'),'calendar meeting dialog closes');
        await click('.agenda-week button[aria-pressed=false]');
        const selectedDay = await execute("document.querySelector('.agenda-week button[aria-pressed=true]').getAttribute('aria-label')");
        await click('.agenda-schedule');
        await until(()=>execute('!!document.querySelector(".meeting-create-modal #scheduled-date")'),'calendar schedules over its selected day');
        assert.equal(await execute('!!document.querySelector(".agenda-week") && new URL(location.href).pathname === "/calendar"'),true,'calendar remains under the scheduling dialog');
        const schedule = await execute(`(() => {
          const dialog=document.querySelector('.meeting-create-modal'), box=dialog.getBoundingClientRect();
          const date=dialog.querySelector('#scheduled-date'), time=dialog.querySelector('#scheduled-time'), duration=dialog.querySelector('#planned-duration');
          const d=date.getBoundingClientRect(), t=time.getBoundingClientRect(), p=duration.getBoundingClientRect();
          return {day:new Date(date.value+'T12:00').toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'}),
            width:box.width, sameRow:d.top===t.top && d.right<t.left, fullDuration:p.top>=d.bottom && Math.abs(p.left-d.left)<1 && Math.abs(p.right-t.right)<1,
            scheduleEnabled:dialog.querySelector('[role=switch][aria-label="Запланировать встречу"]').checked};
        })()`);
        assert.deepEqual(schedule,{day:selectedDay,width:440,sameRow:true,fullDuration:true,scheduleEnabled:true},'Planning uses the chosen calendar date in the desktop reference editor');
        await capture('calendar-schedule-'+theme);
        await click('.meeting-create-modal button[aria-label="Закрыть окно"]');
        await click('.calendar-navigation .button');
        await execute(`(()=>{const view=document.querySelector('select[aria-label="Вид календаря"]');view.value='month';view.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await until(()=>execute("!!document.querySelector('.calendar-month-grid .calendar-event')"),'month view retains scheduled meeting');
        await capture('calendar-month-'+theme);
      }
      if(name==='recording'){
        const recordingLayout=await execute(`(()=>{const player=document.querySelector('.recording-detail-player')?.getBoundingClientRect();const about=document.querySelector('.recording-detail-sidebar')?.getBoundingClientRect();return {right:!!player&&!!about&&about.left>=player.right,actions:document.querySelector('.recording-detail-about-actions')?.innerText||'',nativePlayerPending:!!document.querySelector('.recording-detail-player .button')};})()`);
        assert.equal(recordingLayout.right,true,'Recording information is beside the player');
        assert.ok(recordingLayout.actions.includes('Скачать видеозапись')&&recordingLayout.actions.includes('Скопировать ссылку'),'Recording actions are in the information card');
        assert.equal(recordingLayout.nativePlayerPending,true,'Opening the page does not fetch private media before user action');
      }
      if(['chat','group'].includes(name)){
        const chat = await execute(`(() => {
          const root = document.querySelector('.personal-thread');
          const composer = root.querySelector('.chat-compose-row').getBoundingClientRect();
          const input = root.querySelector('textarea').getBoundingClientRect();
          const send = root.querySelector('.chat-send-button').getBoundingClientRect();
          return {
            messages: root.querySelectorAll('.chat-message').length,
            headerTimes: root.querySelectorAll('.chat-message header time').length,
            bubbleTimes: root.querySelectorAll('.chat-message-bubble footer time').length,
            ownAvatarHidden: getComputedStyle(root.querySelector('.chat-message-own .chat-message-avatar')).display === 'none',
            composerInline: send.left >= input.right && Math.abs(send.bottom - input.bottom) <= 2,
            sendInside: send.right <= composer.right + 1,
            chatIcon: !!document.querySelector('.sidebar a[href="/personal"] svg.lucide-messages-square'),
            newChatAction: !!document.querySelector('.workspace-top .chat-new-action button[aria-label="Новый чат"]')
          };
        })()`);
        assert.equal(chat.headerTimes, 0, 'Timestamps belong inside chat bubbles');
        assert.equal(chat.bubbleTimes, chat.messages, 'Every confirmed bubble has a timestamp');
        for (const field of ['ownAvatarHidden','composerInline','sendInside','chatIcon','newChatAction']) {
          assert.equal(chat[field], true, 'Messenger layout: ' + field);
        }
      }
      if(name==='recordings'){
        assert.deepEqual(await execute(`[...document.querySelectorAll('.recordings-status-tabs button')].map(e=>e.textContent.trim())`), ['Завершённые','В эфире'], 'Library filters by meeting status');
        if (theme === 'light') {
          const activeId = '30303030-3030-4030-8030-303030303030', pastId = '40404040-4040-4040-8040-404040404040';
          const now = new Date(), older = new Date(now.getTime()-15*86400000).toISOString();
          fixture.product.controls.libraryExamples = {
            live: {...fixture.product.conference, id:activeId, status:'active', title:'Live recording meeting'},
            past: {...fixture.product.conference, id:pastId, status:'finished', title:'Older audio meeting'},
            activeRecord: {...fixture.product.recording, conferenceId:activeId, status:'recording', files:[]},
            olderRecord: {...fixture.product.recording, conferenceId:pastId, startedAt:older, mode:'audio_only'}
          };
          await reload();await visible('Older audio meeting');
          const select = (query, value) => execute(`(()=>{const e=document.querySelector(${JSON.stringify(query)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          const titles = () => execute(`[...document.querySelectorAll('.recordings-row-title')].map(e=>e.textContent)`);
          assert.deepEqual(await titles(),['Product finished meeting','Older audio meeting']);
          await select('[aria-label="Сортировка записей"]','oldest');
          assert.deepEqual(await titles(),['Older audio meeting','Product finished meeting']);
          await select('[aria-label="Период записей"]','7');
          assert.deepEqual(await titles(),['Product finished meeting']);
          await select('[aria-label="Период записей"]','30');
          await select('.recordings-meeting-filter select',pastId);
          assert.deepEqual(await titles(),['Older audio meeting']);
          await click('.recordings-status-tabs button:last-child');await visible('Live recording meeting');
          assert.deepEqual(await titles(),['Live recording meeting']);
          assert.equal(await execute("document.querySelector('.recordings-row a') === null"),true,'Recording in progress has no playback or download action');
          await capture('recordings-live-light');
          await click('.recordings-status-tabs button:first-child');await visible('Product finished meeting');
          delete fixture.product.controls.libraryExamples;
          await reload();await visible('Product finished meeting');
        }
        assert.equal(await execute(`document.querySelectorAll('.recordings-count,.recordings-catalogue-footer,.recordings-page a[href="/conferences?view=past"]').length`),0,'Recording library omits the count and completed-meeting links');
        await field('.recordings-search input','No matching recording');
        await until(()=>execute('!!document.querySelector(".recordings-empty")'),'empty recording search appears');
        assert.equal(await execute(`document.querySelectorAll('.recordings-page a[href="/conferences?view=past"]').length`),0,'Empty recording search omits completed-meeting links');
        await click('.recordings-empty button');await visible('Product finished meeting');
      }
    }
    fixture.product.recording.status='failed';
    await route('/recordings');await reload();await visible('Записей пока нет');
    assert.equal(await execute(`document.querySelectorAll('.recordings-count,.recordings-page a[href="/conferences?view=past"]').length`),0,'Empty recording library omits the count and completed-meeting links');
    await capture('recordings-empty-'+theme);
    fixture.product.recording.status='ready';
    await reload();await visible('Product finished meeting');
    for(const [width,height] of [[1280,800],[1920,1080]]){
      window.setContentSize(width,height);
      for(const [name,url,ready] of pages.filter(([name])=>['chat','group','recordings'].includes(name))){
        await route(url);await visible(ready);await capture(`${name}-${width}x${height}-${theme}`);
      }
      await route('/conferences');await visible('Product scheduled meeting');
      await capture(`meetings-${width}x${height}-${theme}`);
      await checkMeetingFilters(`meeting-filters-${width}x${height}-${theme}`);
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
    await checkIncomingCall(theme);
    window.setContentSize(1440,1000);
  }
  await route('/conferences'); await visible('Product scheduled meeting');
  await click('.workspace-search-trigger');await visible('Быстрый переход');
  await field('.workspace-search-input input','Product');
  await click('#workspace-meeting-search');
  await until(()=>execute('new URLSearchParams(location.search).get("search")==="Product"'),'meeting search route');
  await until(()=>execute(`document.querySelector('.meetings-reference-page input[aria-label=\"Поиск конференции по названию\"]')?.value==='Product'`),'meeting search applied');
  checks.push('workspace search opens an accessible dialog and filters the loaded authorized meetings');
  await route('/app/settings');await visible('Мой профиль');
  await tab('Внешний вид');
  await execute(`(()=>{const s=document.querySelector('.appearance-text-size select');if(!s)throw new Error('text size selector');s.value='150';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(()=>execute('document.documentElement.dataset.textSize==="150"'),'large text preference applies');
  window.setContentSize(1280,800);
  await capture('settings-text150-1280x800');
  await route('/conferences');await visible('Product scheduled meeting');await capture('meetings-text150');
  await checkMeetingFilters('meeting-filters-text150');
  await route('/app/settings');await visible('Мой профиль');await tab('Внешний вид');
  await execute(`(()=>{const s=document.querySelector('.appearance-text-size select');s.value='100';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await route('/conferences');await visible('Product scheduled meeting');
  window.setContentSize(1000,800);await capture('meetings-compact');
  await route(`/personal/${DIRECT}`);await visible('Product server message');await capture('chat-compact');
  // Override the production minimum window size only in this test to verify web narrow layouts.
  window.setMinimumSize(320,500);window.setContentSize(390,844);
  await route('/conferences');await visible('Product scheduled meeting');await capture('meetings-mobile');await checkMeetingFilters('meeting-filters-mobile');
  await route(`/personal/${DIRECT}`);await visible('Product server message');await capture('chat-mobile');
  await route('/app/settings');await visible('Мой профиль');await capture('settings-mobile');
  await tab('Мой профиль');await visible('Электронная почта');await capture('profile-mobile');
  checks.push('onboarding introduction leads to server connection; settings render as a page with combined devices; meeting and calendar information dialogs close without mutation; recording information and native download actions sit beside the player');
  checks.push('incoming answer and decline match device control dimensions with centered captions and green/red colors in both themes at desktop/mobile widths; the 36px filter reset aligns with the 40px date and participation fields at the reference spacing, including 150% text; mobile filter chips apply and reset all three controls; recordings omit count and completed links while completed meetings remain available');
  checks.push('shared routes render in both themes; 1280x800 and 1920x1080 workspace and meeting editors, 1280x800 onboarding/login and 150% settings/meetings; desktop/compact/mobile have no document or content-region horizontal overflow, clipped button content, out-of-viewport dialog or missing image');
  assert.deepEqual(await execute('window.__designErrors'),[]);
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,checks,captures,platform:process.platform,arch:process.arch,source:'shared production React; synthetic local TLS API data',windowsRuntimeTested:false},null,2)+'\n');
  console.log(JSON.stringify({ok:true,captures:captures.length,checks}));
  clearTimeout(watchdog);window.destroy();await fixture.close();await cert.close();app.exit(0);
 }catch(error){console.error(error.stack);clearTimeout(watchdog);if(window&&!window.isDestroyed())window.destroy();if(fixture)await fixture.close();if(cert)await cert.close();app.exit(1);}
})();
