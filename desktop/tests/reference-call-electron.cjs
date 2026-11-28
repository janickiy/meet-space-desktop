// Production React + native permission policy, disposable loopback API and
// Chromium fake devices. This checks UI/capture lifecycle, not SFU transmission.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const WebSocket = require('ws');
const { app, clipboard, ClipboardItem } = require('electron');
assert.ok(path.isAbsolute(process.argv[2]), 'A fresh profile is required');
const visualOnly = process.argv.includes('--visual-only');
app.setPath('userData', process.argv[2]);
app.setPath('sessionData', process.argv[2]);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
const { startApp } = require('../dist/main.js');
const { createNodeHttpsTransport } = require('../dist/network/transport.js');
const { createCertificates, createFixture, PASSWORD, CONFERENCE, USER_A, USER_B, INVITE } = require('./fixtures/https-fixture.cjs');

(async () => {
  let certificates, fixture, window;
  const captures = [], checks = [], blockedDestinations = [];
  const conferenceSockets = [], mediaJoins = [], observedSockets = new WeakSet();
  const output = path.resolve(__dirname, visualOnly ? '../artifacts/conference-chat-reference' : '../artifacts/conference-invitation-fix');
  const invitationPosts = [], invitationQueries = [];
  let holdInvitation = false, pendingInvitation = null, clipboardSnapshot = null;
  const restoreClipboard = async () => {
    if (!clipboardSnapshot) return;
    if (clipboardSnapshot.length) await clipboard.write(clipboardSnapshot);
    else clipboard.clear();
    clipboardSnapshot = null;
  };
  const now = new Date().toISOString();
  const conference = { id: CONFERENCE, ownerId: USER_A, title: 'Обсуждение следующего выпуска',
    inviteCode: INVITE, status: 'active', createdAt: now, updatedAt: now, startedAt: now,
    finishedAt: null, scheduledAt: null, plannedDurationMin: 30, participantCount: 1, waitingRoomEnabled: false };
  const membership = { id: '66666666-6666-4666-8666-666666666666', conferenceId: CONFERENCE, userId: USER_A,
    displayName: 'Call UI fixture 1', role: 'owner', status: 'joined', joinedAt: now, leftAt: null,
    createdAt: now, updatedAt: now, microphoneEnabled: false, cameraEnabled: false, screenSharing: false,
    microphoneBlocked: false, cameraBlocked: false, screenBlocked: false, mediaPolicyVersion: 1,
    admissionState: 'admitted', admissionDecidedAt: null, admissionVersion: 1 };
  let joined = false;
  const recordingId = '77777777-7777-4777-8777-777777777777';
  const recordingModes = ['composite', 'audio_only', 'individual_tracks', 'screen_focus'];
  const recordingStarts = [];
  let recording, recordingStops = 0;
  const watchdog = setTimeout(() => { console.error('Call UI QA timeout'); app.exit(1); }, 110000);
  try {
    await fs.mkdir(output, { recursive: true });
    certificates = await createCertificates();
    fixture = await createFixture({ name: 'call-ui', certificates, ui: true, handleRequest: ({ request, response, url, body, send }) => {
      const route = url.pathname.slice('/api/v1'.length);
      const reply = (body, code = 200) => { send(response, code, { status: 'success', ...body }); return true; };
      if (route === `/conferences/${CONFERENCE}`) return reply({ item: { ...conference, inviteUrl: `${fixture.origin}/i/${INVITE}` } });
      if (route === `/conferences/${CONFERENCE}/participants/me`) return joined ? reply({ item: membership }) : reply({ status: 'failed', message: 'Not joined' }, 404);
      if (route === `/conferences/${CONFERENCE}/participants`) return reply({ items: joined ? [membership] : [] });
      if (route === `/conferences/${CONFERENCE}/join` && request.method === 'POST') { joined = true; return reply({ item: membership }); }
      if (route === '/me/conferences') return reply({ items: [conference], nextCursor: null });
      if (route === '/notifications/preferences') return reply({ invitation: true, reminder: true, recording: true, summary: true });
      if (route === `/conferences/${CONFERENCE}/invitation-users`) {
        invitationQueries.push(url.searchParams.get('query'));
        return reply({ items: [fixture.users[1]] });
      }
      if (route === `/conferences/${CONFERENCE}/invitations` && request.method === 'POST') {
        invitationPosts.push(body);
        const complete = () => reply({ items: [
          ...(body.emails || []).map((email, index) => ({ id: `77777777-7777-4777-8777-${String(index + 1).padStart(12,'0')}`, email, userId: null, status: 'queued' })),
          ...(body.userIds || []).map((userId, index) => ({ id: `88888888-8888-4888-8888-${String(index + 1).padStart(12,'0')}`, email: fixture.users.find(user => user.id === userId)?.email, userId, status: 'queued' })),
        ] });
        if (holdInvitation) { pendingInvitation = complete; return true; }
        return complete();
      }
      if (route === `/conferences/${CONFERENCE}/messages`) return reply({ items: [
        { id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',conferenceId:CONFERENCE,sequence:'1',senderId:USER_B,senderName:'Анна Кузнецова',text:'Коллеги, давайте начнём. Все успели посмотреть материалы к встрече?',createdAt:now,updatedAt:now,version:1,deletedAt:null,attachments:[] },
        { id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',conferenceId:CONFERENCE,sequence:'2',senderId:USER_A,senderName:'Call UI fixture 1',text:'Да, всё подготовил. Давайте обсудим основные изменения.',createdAt:now,updatedAt:now,version:1,deletedAt:null,attachments:[] },
      ], nextCursor:null,unreadCount:0 });
      if (route === `/conferences/${CONFERENCE}/chat/read`) return reply({ item: {conferenceId:CONFERENCE,unreadCount:0,lastReadSequence:'2',lastReadMessageId:'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'} });
      if (route === '/capabilities') return reply({ capabilities: { recordingModes } });
      if (route === `/conferences/${CONFERENCE}/recordings`) {
        if (request.method === 'POST') {
          recordingStarts.push(body.mode);
          recording = {
            uuid: recordingId, conferenceId: CONFERENCE, requestedBy: USER_A,
            mode: body.mode, status: 'recording', createdAt: now, files: [],
          };
          return reply({ item: recording });
        }
        return reply({ items: recording ? [recording] : [], nextCursor: null });
      }
      if (route === `/conferences/${CONFERENCE}/recordings/${recordingId}/stop`) {
        recordingStops++;
        recording = { ...recording, status: 'processing' };
        return reply({ item: recording });
      }
      return false;
    } });
    const transport = createNodeHttpsTransport({ ca: certificates.ca, timeoutMs: 3000 });
    const guard = (url, protocol) => {
      const destination = new URL(url);
      const allowed = new URL(fixture.origin);
      if (destination.protocol !== protocol || destination.hostname !== '127.0.0.1' || destination.port !== allowed.port) {
        blockedDestinations.push(destination.origin);
        throw new Error('Only the disposable loopback fixture is permitted');
      }
    };
    window = await startApp({ show: false, userDataDir: process.argv[2], rendererRoot: path.resolve(__dirname, '../../frontend/dist-desktop'),
      mediaAccess: require('./fixtures/synthetic-media-access.cjs').syntheticMediaAccess,
      brokerOptions: { transport: { request: input => { guard(input.url, 'https:'); return transport.request(input); } },
        createSocket: (url, protocols, options) => {
          guard(url, 'wss:');
          const socket = new WebSocket(url, protocols, { ...options, ca: certificates.ca, rejectUnauthorized: true });
          if (new URL(url).pathname === `/api/v1/conferences/${CONFERENCE}/ws`) conferenceSockets.push(socket);
          return socket;
        } } });
    window.setContentSize(1440, 1000);
    const expectedInviteLink = `${fixture.origin}/i/${INVITE}`;
    const { qrCodePath } = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/src/vendor/qr-code.js')).href);
    const expectedQr = qrCodePath(expectedInviteLink);
    const invitationText = `Приглашаю на встречу «${conference.title}».\n\nПодключиться к встрече: ${expectedInviteLink}`;
    const execute = code => window.webContents.executeJavaScript(code, true);
    const until = async (predicate, label) => {
      const end = Date.now() + 10000;
      while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
      throw new Error(label);
    };
    const exists = selector => until(() => execute(`!!document.querySelector(${JSON.stringify(selector)})`), `Missing ${selector}`);
    const visible = text => until(async () => (await execute('document.body.innerText')).includes(text), `Missing ${text}`);
    const click = selector => execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('Missing/enabled action');e.focus();e.click();})()`);
    const field = (selector, value) => execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const prototype=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const route = async value => { window.webContents.send('meetspace:route', value); await until(() => execute(`location.pathname+location.search===${JSON.stringify(value)}`), 'Route applies'); };
    const trackCounts = () => execute(`(()=>{const tracks=window.__callUI.tracks.map(r=>r.deref()).filter(Boolean);return {captures:window.__callUI.captures,audio:tracks.filter(t=>t.kind==='audio'&&t.readyState==='live').length,video:tracks.filter(t=>t.kind==='video'&&t.readyState==='live').length,ended:tracks.filter(t=>t.readyState==='ended').length};})()`);
    const tracksAre = async (audio, video) => until(async () => { const counts = await trackCounts(); return counts.audio === audio && counts.video === video; }, `Expected ${audio} live audio and ${video} live video tracks`);
    const capture = async (name, toolbarState) => {
      await execute('document.fonts.ready');
      await execute('Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))');
      await new Promise(resolve => setTimeout(resolve, 160));
      const metrics = await execute(`(()=>{
        const visible=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
        const regions=[...document.querySelectorAll('.workspace-main,.prejoin-grid,.call-reference-room,[role=dialog]')].filter(visible);
        const controls=[...document.querySelectorAll('.prejoin-toggles button,.prejoin-join,.room-header button,.conference-control-bar button,.room-media-connection button,.call-share-modal button,.call-invite-modal button')].filter(visible);
        const bar=document.querySelector('.conference-control-bar');
        const barStyle=bar&&getComputedStyle(bar);
        const toolbar=bar&&{background:barStyle.backgroundColor,backgroundImage:barStyle.backgroundImage,boxShadow:barStyle.boxShadow,
          borders:['Top','Right','Bottom','Left'].map(side=>barStyle['border'+side+'Width']),
          receiveOnlyInside:!!bar.querySelector('.room-media-connection'),
          buttons:[...bar.children].map(e=>{const icon=e.querySelector(':scope > .conference-room-control-icon');const label=e.querySelector(':scope > .conference-room-control-label');
            const ir=icon?.getBoundingClientRect(),lr=label?.getBoundingClientRect(),r=e.getBoundingClientRect();
            const glyph=icon?.querySelector('svg');
            const glyphRect=glyph?.getBoundingClientRect();
            const drawing=glyph&&{names:[...glyph.classList],width:glyphRect.width,height:glyphRect.height,strokeWidth:parseFloat(getComputedStyle(glyph).strokeWidth)};
            return {tag:e.tagName,label:label?.textContent.trim(),compact:e.matches('button.conference-room-control'),disabled:e.disabled,left:r.left,top:r.top,drawing,pressed:e.getAttribute('aria-pressed')==='true',
              icon:!!icon,labelBelowIcon:!!ir&&!!lr&&lr.top>=ir.bottom-1,
              singleLine:!!lr&&lr.height<=parseFloat(getComputedStyle(label).lineHeight)+1,
              withinViewport:r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,
              labelCentered:!!ir&&!!lr&&Math.abs((ir.left+ir.right)/2-(lr.left+lr.right)/2)<=2};})};
        const previewTop=document.querySelector('.prejoin-preview-top')?.getBoundingClientRect();
        const avatar=document.querySelector('.prejoin-initials')?.getBoundingClientRect();
        const emptyTitle=document.querySelector('.media-empty strong')?.getBoundingClientRect();
        const emptyCopy=document.querySelector('.media-empty span')?.getBoundingClientRect();
        const dialog=document.querySelector('.call-share-modal,.call-invite-modal');
        const title=dialog?.querySelector('h2'),close=dialog?.querySelector('.modal-close');
        const tr=title?.getBoundingClientRect(),cr=close?.getBoundingClientRect();
        const qr=document.querySelector('.call-share-qr-code'),svg=qr?.querySelector('svg'),qrr=qr?.getBoundingClientRect();
        const card=document.querySelector('.call-share-card'),copy=document.querySelector('.call-share-copy');
        const copyRect=copy?.getBoundingClientRect();
        const invitationUI=dialog&&{step:dialog.classList.contains('call-share-modal')?'share':'invite',width:dialog.getBoundingClientRect().width,
          title:title?.textContent,focusInside:dialog.contains(document.activeElement),
          focusDiagnostic:{tag:document.activeElement?.tagName,className:document.activeElement?.className,disabled:document.activeElement?.disabled,dialogConnected:dialog.isConnected},
          titleOverlapsClose:!!tr&&!!cr&&tr.left<cr.right&&tr.right>cr.left&&tr.top<cr.bottom&&tr.bottom>cr.top,
          link:dialog.querySelector('input[aria-label="Ссылка-приглашение"]')?.value,
          qr:qrr&&{width:qrr.width,height:qrr.height,background:getComputedStyle(qr).backgroundColor,viewBox:svg?.getAttribute('viewBox'),path:svg?.querySelector('path')?.getAttribute('d'),label:qr.getAttribute('aria-label')},
          columns:card&&getComputedStyle(card).gridTemplateColumns.split(/\\s+/).length,
          stacked:!!qrr&&!!copyRect&&qrr.top>=copyRect.bottom-1,
          readonlyText:dialog.querySelector('textarea[readonly]')?.value,
          fieldsLabelled:[...dialog.querySelectorAll('input,textarea')].every(e=>!!e.getAttribute('aria-label')||!!e.labels?.length)};
        return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,textSize:document.documentElement.dataset.textSize,
          previewBadgeOverlapsAvatar:!!previewTop&&!!avatar&&previewTop.left<avatar.right&&previewTop.right>avatar.left&&previewTop.top<avatar.bottom&&previewTop.bottom>avatar.top,
          emptyRoomTextOverlaps:!!emptyTitle&&!!emptyCopy&&emptyCopy.top<emptyTitle.bottom,
          clippedRegions:regions.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className),
          clippedButtons:controls.filter(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1).map(e=>e.textContent.trim()),
          unnamedControls:controls.filter(e=>!(e.getAttribute('aria-label')||e.textContent.trim())).length,
          dialogs:[...document.querySelectorAll('[role=dialog]')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};}),
          toolbar,invitationUI,brokenImages:[...document.images].filter(e=>e.complete&&!e.naturalWidth).length};})()`);
      assert.ok(metrics.scrollWidth <= metrics.width + 1, `${name}: horizontal document overflow`);
      assert.deepEqual(metrics.clippedRegions, [], `${name}: horizontal content overflow`);
      assert.deepEqual(metrics.clippedButtons, [], `${name}: clipped control text`);
      assert.equal(metrics.unnamedControls, 0, `${name}: accessible control names`);
      assert.equal(metrics.brokenImages, 0, `${name}: broken images`);
      assert.equal(metrics.previewBadgeOverlapsAvatar, false, `${name}: preview status overlaps the avatar`);
      assert.equal(metrics.emptyRoomTextOverlaps, false, `${name}: empty room title and description need separate lines`);
      if (toolbarState) {
        assert.ok(metrics.toolbar, `${name}: room toolbar remains visible`);
        assert.deepEqual(metrics.toolbar.buttons.map(button => button.label), ['Микрофон','Камера','Экран','Участники','Чат','Настройки','Выйти'], `${name}: exact reference control order`);
        assert.deepEqual([...metrics.toolbar.buttons].sort((a,b) => Math.abs(a.top-b.top)>2 ? a.top-b.top : a.left-b.left).map(button => button.label), ['Микрофон','Камера','Экран','Участники','Чат','Настройки','Выйти'], `${name}: visual order matches DOM and reference order`);
        if (metrics.width >= 1000) {
          assert.ok(Math.max(...metrics.toolbar.buttons.map(button => button.top))-Math.min(...metrics.toolbar.buttons.map(button => button.top)) <= 2, `${name}: desktop controls share one row`);
          assert.ok(metrics.toolbar.buttons.every(button => button.singleLine), `${name}: desktop labels stay on one line`);
        }
        assert.ok(metrics.toolbar.buttons.every(button => button.tag === 'BUTTON' && button.compact && button.icon && button.labelBelowIcon && button.labelCentered && button.withinViewport), `${name}: each compact icon tile has its own centered label below it and fits the viewport`);
        const glyphSize = metrics.width >= 780 ? 20 : 19;
        const glyphNames = [
          metrics.toolbar.buttons[0].pressed ? 'mic' : 'mic-off',
          metrics.toolbar.buttons[1].pressed ? 'video' : 'video-off',
          metrics.toolbar.buttons[2].pressed ? 'screen-share-off' : 'monitor-up',
          'users', 'message-circle', 'settings', 'log-out',
        ];
        metrics.toolbar.buttons.forEach(({ drawing }, index) => {
          assert.ok(drawing?.names.includes('lucide-'+glyphNames[index]), `${name}: expected ${glyphNames[index]} glyph`);
          assert.deepEqual([drawing.width, drawing.height, drawing.strokeWidth], [glyphSize, glyphSize, 1.75], `${name}: reference glyph dimensions and stroke`);
        });
        assert.equal(metrics.toolbar.background, metrics.width >= 780 ? 'rgb(36, 30, 44)' : 'rgba(0, 0, 0, 0)', `${name}: room controls use the reference surface at the current width`);
        assert.equal(metrics.toolbar.backgroundImage, 'none', `${name}: no enclosing toolbar background image`);
        assert.equal(metrics.toolbar.boxShadow, 'none', `${name}: no enclosing toolbar shadow`);
        assert.deepEqual(metrics.toolbar.borders, ['1px','1px','1px','1px'], `${name}: room controls retain the toolbar outline`);
        assert.equal(metrics.toolbar.receiveOnlyInside, false, `${name}: receive-only action is outside the seven controls`);
        if (toolbarState === 'disconnected') {
          assert.deepEqual(metrics.toolbar.buttons.map(button => button.disabled), [true,true,true,false,false,false,false], `${name}: capture and screen controls wait for authenticated room state; participant/chat/settings/leave remain available`);
        } else if (toolbarState === 'before-media') {
          assert.deepEqual(metrics.toolbar.buttons.map(button => button.disabled), [false,false,true,false,false,false,false], `${name}: mic and camera can start independently; screen waits for media`);
        }
      }
      if (metrics.invitationUI) {
        const invitation = metrics.invitationUI;
        assert.equal(invitation.focusInside, true, `${name}: focus stays inside the current invitation step ${JSON.stringify(invitation.focusDiagnostic)}`);
        assert.equal(invitation.titleOverlapsClose, false, `${name}: heading does not overlap the close action`);
        assert.equal(invitation.fieldsLabelled, true, `${name}: all invitation fields have accessible labels`);
        assert.ok(Math.abs(invitation.width - Math.min(invitation.step === 'share' ? 680 : 520, metrics.width - (metrics.width <= 650 ? 28 : 60))) <= 1, `${name}: reference modal width (${invitation.width}px at ${metrics.width}px)`);
        if (invitation.step === 'share') {
          assert.equal(invitation.title, 'Поделиться встречей', `${name}: share step heading`);
          assert.equal(invitation.link, expectedInviteLink, `${name}: share link uses the selected backend origin`);
          assert.ok(invitation.qr?.label, `${name}: QR has an accessible description`);
          assert.equal(invitation.qr?.viewBox, `0 0 ${expectedQr.size} ${expectedQr.size}`, `${name}: QR SVG has the expected geometry`);
          assert.equal(invitation.qr?.path, expectedQr.path, `${name}: QR encodes this server invitation, not a demo URL`);
          assert.equal(invitation.qr?.background, 'rgb(255, 255, 255)', `${name}: QR preserves white scan contrast in both themes`);
          const qrWidth = metrics.width <= 650 ? 156 : metrics.width <= 850 ? 170 : 200;
          assert.ok(Math.abs(invitation.qr.width-qrWidth)<=1 && Math.abs(invitation.qr.height-qrWidth)<=1, `${name}: QR square is ${qrWidth}px`);
          assert.equal(invitation.columns, metrics.width <= 650 ? 1 : 2, `${name}: reference share card columns`);
          if (metrics.width <= 650) assert.equal(invitation.stacked, true, `${name}: QR stacks below the copy area on narrow windows`);
          // Geometry equality is useful for assertions, but need not be repeated
          // as thousands of SVG commands in every capture's report entry.
          delete invitation.qr.path;
        } else {
          assert.equal(invitation.title, 'Пригласить участников', `${name}: send step heading`);
          assert.equal(invitation.readonlyText, invitationText, `${name}: readonly invitation text uses this title and backend URL`);
        }
      }
      for (const dialog of metrics.dialogs) assert.ok(dialog.left >= -1 && dialog.top >= -1 && dialog.right <= metrics.width + 1 && dialog.bottom <= metrics.height + 1, `${name}: dialog bounds`);
      await fs.writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
      captures.push({ name, ...metrics });
    };
    await visible('Команда ближе.');
    await click('[data-onboarding=connect]');
    await exists('#desktop-server-origin');
    await field('#desktop-server-origin', fixture.origin);
    await click('.desktop-server-form button[type=submit]');
    await exists('#email');
    await field('#email', fixture.users[0].email); await field('#password', PASSWORD);
    await click('#auth-form button[type=submit]'); await exists('.sidebar');
    await execute(`(()=>{window.__callUI={captures:0,requests:[],tracks:[],errors:[]};window.addEventListener('error',e=>window.__callUI.errors.push(e.message));const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async constraints=>{window.__callUI.requests.push(JSON.parse(JSON.stringify(constraints)));const stream=await original(constraints);window.__callUI.captures++;for(const track of stream.getTracks())window.__callUI.tracks.push(new WeakRef(track));return stream;};})()`);
    const prejoin = `/conferences/${CONFERENCE}/join`;
    const room = `/conferences/${CONFERENCE}`;
    const setAppearance = async (theme, size = '100', destination = prejoin) => {
      await route('/app/settings'); await visible('Мой профиль');
      await execute(`(()=>{[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()==='Внешний вид').click();})()`);
      await click(`input[type=radio][value=${theme}]`);
      await execute(`(()=>{const e=document.querySelector('.appearance-text-size select');e.value=${JSON.stringify(size)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await route(destination); await exists(destination === prejoin ? '.prejoin-reference-page .prejoin-join' : '.call-reference-room .conference-control-bar');
    };
    for (const theme of ['light', 'dark']) {
      await setAppearance(theme);
      for (const [width, height] of [[1440,1000],[1280,800]]) { window.setContentSize(width,height); await capture(`prejoin-${theme}-${width}`); }
    }
    assert.equal((await trackCounts()).captures, 0, 'Opening prejoin/settings does not request capture');
    await setAppearance('light', '150'); await capture('prejoin-text150-1280');
    await setAppearance('light'); window.setContentSize(1440,1000);
    const mic = '.prejoin-toggles button[aria-label="Включить микрофон"]';
    const camera = '.prejoin-toggles button[aria-label="Включить камеру"]';
    await click(mic); await tracksAre(1,0);
    await exists('.prejoin-toggles button[aria-label="Выключить микрофон"][aria-pressed=true]');
    await click(camera); await tracksAre(1,1);
    await exists('.prejoin-toggles button[aria-label="Выключить камеру"][aria-pressed=true]');
    await until(() => execute('document.querySelector(".prejoin-video-frame video")?.videoWidth>0'), 'Fake camera produces actual video frames');
    await capture('prejoin-camera-and-microphone');
    const opener = '.prejoin-mobile-devices';
    await click(opener); await exists('[role=dialog] .prejoin-device-selects');
    for (const index of [0, 1]) {
      const before = await trackCounts();
      await until(() => execute(`document.querySelectorAll('.prejoin-device-selects select')[${index}]?.options.length>1`), 'Fake input is enumerated');
      await execute(`(()=>{const e=document.querySelectorAll('.prejoin-device-selects select')[${index}];e.value=[...e.options].find(o=>o.value&&o.value!==e.value).value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await until(async () => (await trackCounts()).captures > before.captures, 'Changing input requests a replacement track');
      await tracksAre(1,1);
      assert.ok((await trackCounts()).ended > before.ended, 'Replaced device track stops');
    }
    assert.equal(await execute(`(()=>{const d=document.querySelector('[role=dialog]');return d.getAttribute('aria-modal')==='true'&&!!document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim()&&d.contains(document.activeElement);})()`), true, 'Devices dialog has a name, modal semantics and initial focus');
    assert.equal(await execute(`(()=>{const d=document.querySelector('[role=dialog]');const els=[...d.querySelectorAll('button:not(:disabled),select:not(:disabled)')];els.at(-1).focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return document.activeElement===els[0];})()`), true, 'Devices dialog wraps Tab');
    assert.equal(await execute(`(()=>{const d=document.querySelector('[role=dialog]');const els=[...d.querySelectorAll('button:not(:disabled),select:not(:disabled)')];els[0].focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));return document.activeElement===els.at(-1);})()`), true, 'Devices dialog wraps Shift+Tab');
    assert.equal(await execute(`[...document.querySelectorAll('[role=dialog] select')].every(e=>e.labels?.length>0)`), true, 'Device selects have associated labels');
    await capture('prejoin-devices-dialog');
    await execute(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
    await until(() => execute('!document.querySelector("[role=dialog]")'), 'Escape closes devices');
    assert.equal(await execute(`document.activeElement===document.querySelector(${JSON.stringify(opener)})`), true, 'Devices dialog returns focus');
    await click('.prejoin-toggles button[aria-label="Выключить микрофон"]'); await tracksAre(0,1);
    await click('.prejoin-toggles button[aria-label="Выключить камеру"]'); await tracksAre(0,0);
    await until(() => execute('!document.querySelector(".prejoin-video-frame video")'), 'Disabled camera removes the preview');
    await click(mic); await click(camera); await tracksAre(1,1);
    await route('/conferences'); await tracksAre(0,0);
    checks.push('Prejoin does not capture on entry; mic/camera buttons expose their state, start real Chromium fake tracks, show actual preview frames, and stop on toggle or route exit; changing either input stops its previous track');
    checks.push('Devices dialog has labels, initial/return focus, Tab/Shift+Tab containment and Escape close');
    await route(prejoin); await exists('.prejoin-join');
    window.setMinimumSize(320,500); window.setContentSize(390,844);
    await capture('prejoin-narrow-390'); await click(opener); await capture('prejoin-narrow-devices-dialog');
    await click('[role=dialog] button[aria-label="Закрыть окно"]');
    window.setContentSize(1440,1000);
    await click(opener); await exists('[role=dialog] .prejoin-device-selects');
    const selectedOutput = await execute(`(()=>{const e=document.querySelectorAll('.prejoin-device-selects select')[2];if(!e)return null;const option=[...e.options].find(o=>o.value&&o.value!=='default');if(!option)return null;e.value=option.value;e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;})()`);
    assert.ok(selectedOutput, 'Chromium fake audio output is selectable');
    await click('[role=dialog] button[aria-label="Закрыть окно"]');
    await click('.prejoin-join'); await exists('.call-reference-room');
    await tracksAre(0,0);
    assert.equal(await execute('document.querySelector(".conference-stage-rail").hidden'), true, 'Room starts with the side panel closed, matching the reference');
    assert.equal(await execute(`Object.keys(localStorage).filter(k=>k.startsWith('meet.devices.v1:')).some(k=>JSON.parse(localStorage.getItem(k)).audioOutputId===${JSON.stringify(selectedOutput)})`), true, 'Selected audio output is saved by the production join flow');
    await capture('active-room-reconnecting', 'disconnected');
    // Model a real presence event from the local server, without pretending to
    // negotiate a media connection or publishing a synthetic remote video.
    let stateRevision = 0;
    const sendPresence = async (withPeer = false, extraPeers = []) => {
      await until(() => Promise.resolve(conferenceSockets.at(-1)?.readyState === WebSocket.OPEN), 'Conference realtime socket opens');
      const connectionId = `fixture-connection-${++stateRevision}`;
      const stateEvent = JSON.stringify({ id: `fixture-call-state-${stateRevision}`, version: 1, type: 'conference.state', userId: USER_A,
        conferenceId: CONFERENCE, timestamp: now, data: { connectionId, participantId: membership.id,
          status: 'active', participants: [{ ...membership, online: true, connections: 1, connectionIds: [connectionId] },
            ...(withPeer ? [{...membership,id:'55555555-5555-4555-8555-555555555555',userId:USER_B,displayName:'Анна Кузнецова',role:'participant',online:true,connections:1,connectionIds:['fixture-peer']}] : []),
            ...extraPeers] } });
      for (const socket of fixture.sockets) {
        if (!observedSockets.has(socket)) {
          observedSockets.add(socket);
          // The base fixture echoes messages. A client-only media request must
          // not be echoed as a server event: production correctly rejects it.
          // Observe media.join without fabricating a media-worker reply/SDP.
          socket.removeAllListeners('message');
          socket.on('message', message => {
            const envelope = JSON.parse(message.toString());
            if (envelope.type === 'media.join') mediaJoins.push(envelope);
            if (!envelope.type?.startsWith('media.')) socket.send(message);
          });
        }
        if (socket.readyState === WebSocket.OPEN) socket.send(stateEvent);
      }
      await visible('Встреча в эфире');
      await visible(extraPeers.length ? '5 участников' : withPeer ? '2 участника' : '1 участник');
      await until(() => execute('!document.querySelector(".room-microphone-control")?.disabled'), 'Presence enables independent mic/camera start');
    };
    await sendPresence();
    assert.equal(await execute(`(() => {
      const stage = document.querySelector('.room-video-stage').getBoundingClientRect();
      const tile = document.querySelector('.room-video-stage .media-tile').getBoundingClientRect();
      return tile.width > stage.width / 2 && Math.abs(tile.width / tile.height - 16/9) < .01;
    })()`), true, 'A single desktop video tile uses the available stage height');
    assert.equal(await execute(`(() => {
      const grid = document.querySelector('.room-view-options button:first-child svg');
      return grid.classList.contains('lucide-layout-grid') &&
        grid.querySelectorAll('rect').length === 4 &&
        parseFloat(getComputedStyle(grid).strokeWidth) === 1.75;
    })()`), true, 'The gallery switch uses the four-square reference glyph');
    await capture('active-room-before-media', 'before-media');
    await sendPresence(true, ['Мария Полякова', 'Дмитрий Волков', 'Максим Петров'].map((name, index) => ({
      ...membership, displayName:name, role:'participant', online:true, connections:1,
      id:`77777777-7777-4777-8777-77777777777${index}`,
      userId:`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`, connectionIds:[`fixture-peer-${index}`],
    })));
    assert.deepEqual(await execute(`Object.values([...document.querySelectorAll('.room-video-stage .media-tile')].reduce((rows,tile) => {
      const top = Math.round(tile.getBoundingClientRect().top);
      rows[top] = (rows[top] || 0) + 1;
      return rows;
    }, {}))`), [3,2], 'A wide desktop gallery shows five participants in two centered rows');
    await capture('active-room-gallery-five');
    await sendPresence(true);
    const pairedGallery = await execute(`(() => {
      const tiles = [...document.querySelectorAll('.media-grid[data-layout="gallery"][data-count="2"] .media-tile')];
      if (tiles.length !== 2) return null;
      const [left, right] = tiles.map(tile => tile.getBoundingClientRect()).sort((a,b) => a.left - b.left);
      return {
        sameRow: Math.abs(left.top - right.top) <= 1,
        ratio: left.width / left.height,
        gap: right.left - left.right,
        labelInset: tiles[0].querySelector('.media-tile-label').getBoundingClientRect().left - tiles[0].getBoundingClientRect().left,
      };
    })()`);
    assert.ok(pairedGallery?.sameRow && Math.abs(pairedGallery.ratio - 16/9) < .01, 'Gallery respects a 16:9 two-tile row');
    assert.ok(Math.abs(pairedGallery.gap - 10) <= 1 && Math.abs(pairedGallery.labelInset - 10) <= 1, 'Gallery tile gap and label inset match the mockup: '+JSON.stringify(pairedGallery));
    await capture('active-room-gallery');
    await click('.room-tile-spotlight[aria-label="Закрепить участника: Анна Кузнецова"]');
    await until(()=>execute("document.querySelector('.media-tile[data-featured=true]')?.innerText.includes('Анна Кузнецова')"), 'Pinned member appears in the speaker tile');
    assert.equal(await execute("document.querySelectorAll('.media-tile[data-featured=true]:not([hidden])').length"),1,'Exactly one visible speaker tile');
    assert.equal(await execute(`(() => {
      const featured = document.querySelector('.media-tile[data-featured="true"]').getBoundingClientRect();
      const other = document.querySelector('.media-tile:not([data-featured])').getBoundingClientRect();
      return featured.bottom <= other.top && featured.width > other.width;
    })()`), true, 'Speaker appears above the horizontal strip');
    await capture('active-room-speaker-pin');
    await click('button.room-speaker-badge');
    assert.equal(await execute('!!document.querySelector("button.room-speaker-badge")'), false, 'Unpin clears the badge');
    await click('.room-view-options button:first-child'); await sendPresence();
    await click('.room-header button[aria-label="Пригласить"]'); await exists('[role=dialog]');
    await capture('active-room-invitation'); await click('[role=dialog] button[aria-label="Закрыть окно"]');
    await click('.room-participants-control');
    await exists('.room-participants-control[aria-expanded=true]'); await capture('active-room-participants');
    await click('.room-participants-control');
    await exists('.room-participants-control[aria-expanded=false]');
    assert.equal(await execute('document.querySelector(".conference-stage-rail").hidden'), true, 'Second participants click closes the same panel');
    const chatControl = '.conference-control-bar button[aria-keyshortcuts="C"]';
    await click(chatControl); await exists(`${chatControl}[aria-expanded=true]`);
    await exists('#meeting-tab-chat[aria-selected=true]'); await visible('Коллеги, давайте начнём.'); await capture('active-room-chat');
    const chatGeometry=await execute(`(()=>{const root=document.querySelector('.meeting-thread');const bubble=root.querySelector('.chat-message-own .chat-message-bubble');const input=root.querySelector('textarea').getBoundingClientRect(),send=root.querySelector('.chat-send-button').getBoundingClientRect();return {times:root.querySelectorAll('.chat-message-bubble footer time').length,headerTimes:root.querySelectorAll('.chat-message header time').length,ownHeaderHidden:getComputedStyle(root.querySelector('.chat-message-own header')).display==='none',bubble:getComputedStyle(bubble).backgroundColor,ownBorder:getComputedStyle(root.querySelector('.chat-message-own')).borderLeftWidth,composerTwoRows:send.top>=input.bottom-1,tabs:[...document.querySelectorAll('.conference-stage-tabs button')].map(e=>e.textContent.trim())};})()`);
    assert.equal(chatGeometry.times,2);assert.equal(chatGeometry.headerTimes,0);assert.equal(chatGeometry.ownHeaderHidden,true);
    assert.equal(chatGeometry.bubble,'rgb(240, 230, 244)');assert.equal(chatGeometry.ownBorder,'0px');assert.equal(chatGeometry.composerTwoRows,true);
    assert.equal(chatGeometry.tabs[0], 'Чат', 'Chat tab precedes participants as in the reference');
    assert.equal(await execute(`(()=>{const root=document.querySelector('.meeting-thread');const input=root.querySelector('textarea').getBoundingClientRect();return [...root.querySelectorAll('.chat-attachment-trigger,.emoji-picker-trigger')].every(e=>e.getBoundingClientRect().top>=input.bottom-1);})()`),true,'Attachment and emoji controls sit below the input without overlapping its placeholder');
    await click(chatControl); await exists(`${chatControl}[aria-expanded=false]`);
    assert.equal(await execute('document.querySelector(".conference-stage-rail").hidden'), true, 'Second chat click closes the same panel');
    await click('.room-settings-control'); await exists('[role=dialog]');
    await capture('active-room-settings'); await click('[role=dialog] button[aria-label="Закрыть окно"]');
    checks.push('Gallery tiles use the reference aspect ratio, gap and caption position; selecting a participant switches to speaker view, pins the participant in the top tile, and supports unpinning; chat uses the reference tab order and tinted panel.');
    checks.push('Production join saves the selected audio output and transitions to the active room; local realtime presence, invite, participants and settings controls work without a media connection');
    checks.push('Prejoin light/dark, 1440/1280/390 widths, 150% text and device dialogs have no horizontal overflow, clipped controls, unnamed controls, broken images or out-of-viewport dialogs');

    // Every matrix starts a fresh room subscription, so the disabled-state
    // screenshots test the real initial state rather than editing React state.
    for (const theme of ['light', 'dark']) {
      for (const textSize of ['100', '150']) {
        await setAppearance(theme, textSize, room);
        await tracksAre(0,0);
        const sizes = textSize === '100' ? [[1440,1000],[1280,800],[390,844]] : [[1280,900],[390,844]];
        for (const [width,height] of sizes) {
          window.setContentSize(width,height);
          await capture(`toolbar-${theme}-text${textSize}-${width}-disconnected`, 'disconnected');
        }
        const callsBeforeDisabledClick = await execute('window.__callUI.requests.length');
        await execute('document.querySelector(".room-microphone-control").click();document.querySelector(".room-camera-control").click();document.querySelector(".room-screen-control").click()');
        assert.equal(await execute('window.__callUI.requests.length'), callsBeforeDisabledClick, 'Disabled controls do not request device access before conference.state');
        await sendPresence();
        for (const [width,height] of sizes) {
          window.setContentSize(width,height);
          await capture(`toolbar-${theme}-text${textSize}-${width}-before-media`, 'before-media');
        }
      }
    }
    checks.push('The seven icon-and-label controls stay in reference order while disconnected and before media, in light/dark, 1440/1280/390 widths and 150% text; each label stays below its icon, all controls fit within the toolbar');
    checks.push('Microphone, camera and screen are disabled before conference.state; local participants, chat, settings and leave remain available, and clicking disabled capture controls never requests devices');

    const shareOpener = '.room-header button[aria-label="Пригласить"]';
    const closeWithEscape = async () => {
      await execute('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
      await until(() => execute('!document.querySelector("[role=dialog]")'), 'Escape closes the invitation dialog');
      assert.equal(await execute(`document.activeElement===document.querySelector(${JSON.stringify(shareOpener)})`), true, 'Closing an invitation restores the room invite action focus');
    };
    const checkDialogKeyboard = async () => {
      for (const shiftKey of [false,true]) {
        assert.equal(await execute(`(()=>{const d=document.querySelector('[role=dialog]');const els=[...d.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(e=>e.tabIndex>=0&&!e.closest('[hidden],[inert]'));${shiftKey ? 'els[0]' : 'els.at(-1)'}.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:${shiftKey},bubbles:true,cancelable:true}));return document.activeElement===${shiftKey ? 'els.at(-1)' : 'els[0]'};})()`), true, `Invitation dialog traps ${shiftKey ? 'Shift+Tab' : 'Tab'}`);
      }
    };
    const assertNativeCopy = async (selector, expected) => {
      // Geometry/media QA can run on a locked desktop. Native Clipboard API
      // acceptance remains a separate explicit, focused-desktop run.
      if (visualOnly) return;
      if (!clipboardSnapshot) {
        const items = await clipboard.read();
        clipboardSnapshot = await Promise.all(items.map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
      }
      try {
        // Chromium requires a focused document for the real Clipboard API.
        // Other visual scenarios stay hidden; only this isolated copy check
        // briefly shows its disposable fixture window.
        window.show(); window.focus(); window.webContents.focus();
        await until(() => execute('document.hasFocus()'), 'Native clipboard copy has a focused document');
        await click(selector);
        await until(async () => await clipboard.readText() === expected, 'Clipboard contains the exact production invitation value');
      } finally {
        await restoreClipboard();
        window.hide();
      }
    };
    for (const theme of ['light','dark']) {
      for (const textSize of ['100','150']) {
        await setAppearance(theme, textSize, room);
        const sizes = textSize === '100' ? [[1440,1000],[1280,800],[390,844]] : [[1280,900],[700,900],[390,844]];
        for (const [width,height] of sizes) {
          window.setContentSize(width,height);
          await click(shareOpener); await exists('.call-share-modal');
          await capture(`share-${theme}-text${textSize}-${width}`);
          if (theme === 'light' && textSize === '100' && width === 1440) {
            await checkDialogKeyboard();
            await assertNativeCopy('.call-share-modal .copy-link .button', expectedInviteLink);
            if (!visualOnly) await visible('Скопировано');
          }
          await click('.call-share-invite-button'); await exists('.call-invite-modal');
          await until(() => execute('document.activeElement===document.querySelector(".call-invite-modal input[inputmode=email]")'), 'Second invitation step focuses the recipient field');
          await capture(`invite-${theme}-text${textSize}-${width}`);
          if (theme === 'light' && textSize === '100' && width === 1440) {
            await checkDialogKeyboard();
            await assertNativeCopy('.call-invite-copy .button', invitationText);
            if (!visualOnly) await visible('Приглашение скопировано.');
          }
          await click('.call-invite-back'); await exists('.call-share-modal');
          await until(() => execute('document.activeElement===document.querySelector(".call-share-invite-button")'), 'Back returns focus to the send-invitation action');
          await closeWithEscape();
        }
      }
    }
    await restoreClipboard();
    checks.push('Both invitation steps match reference modal widths in light/dark at 1440/1280/390 and 150% text; share QR is 200px on desktop or 156px in a single narrow column, and its SVG geometry encodes the real selected backend invite URL');
    checks.push(`${visualOnly ? 'Native Clipboard API check skipped in visual-only mode; ' : 'Share link and readonly invitation text copy their exact production values through the native Clipboard API; original clipboard formats are restored; '}both steps trap Tab/Shift+Tab, move focus on next/back and restore the room invite action after Escape`);

    // Exercise the existing authorised form against only this disposable local
    // backend, including a held POST so busy guards can be observed reliably.
    await setAppearance('light','100',room); window.setContentSize(1280,900);
    await click(shareOpener); await click('.call-share-invite-button'); await exists('.call-invite-modal');
    const emails = '.call-invite-modal input[inputmode=email]';
    const submitInvitation = '.call-invite-modal button[type=submit]';
    const postsBeforeValidation = invitationPosts.length;
    await field(emails, 'not-an-email'); await click(submitInvitation);
    await visible('Проверьте адреса email.');
    assert.equal(invitationPosts.length, postsBeforeValidation, 'Invalid email is rejected before POST');
    await field(emails, Array.from({length:21},(_,index)=>`person${index}@fixture.invalid`).join(', '));
    await click(submitInvitation); await visible('не больше 20 человек');
    assert.equal(invitationPosts.length, postsBeforeValidation, 'Twenty-one recipients never reach the backend');
    const beforePaste = 'prefix@fixture.invalid, REPLACE, suffix@fixture.invalid';
    const pastedEmails = 'first@fixture.invalid\r\nsecond@fixture.invalid\nthird@fixture.invalid';
    const normalizedPaste = pastedEmails.replace(/\r\n?|\n/g, ', ');
    const pasteStart = beforePaste.indexOf('REPLACE');
    await field(emails, beforePaste);
    await execute(`(()=>{const e=document.querySelector(${JSON.stringify(emails)});e.focus();e.setSelectionRange(${pasteStart},${pasteStart+'REPLACE'.length});const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(pastedEmails)});e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`);
    await until(() => execute(`document.querySelector(${JSON.stringify(emails)}).value===${JSON.stringify(beforePaste.replace('REPLACE',normalizedPaste))}`), 'Multiline paste preserves all recipient addresses and surrounding selection text');
    await until(() => execute(`document.querySelector(${JSON.stringify(emails)}).selectionStart===${pasteStart+normalizedPaste.length}`), 'Paste restores the caret after inserted recipient addresses');
    await field('.call-invite-modal input[type=search]', 'peer');
    await exists('.invitation-user-results input[type=checkbox]');
    assert.ok(invitationQueries.includes('peer'), 'Search is sent through the production REST broker');
    await click('.invitation-user-results input[type=checkbox]');
    await field(emails, `EXTERNAL@fixture.invalid, external@fixture.invalid, ${fixture.users[1].email.toUpperCase()}`);
    holdInvitation = true;
    await click(submitInvitation);
    await until(() => Promise.resolve(invitationPosts.length === postsBeforeValidation+1 && !!pendingInvitation), 'One invitation POST is held by the fixture');
    await exists(`${submitInvitation}[aria-busy=true]`);
    assert.deepEqual(invitationPosts.at(-1), { emails:['external@fixture.invalid'], userIds:[fixture.users[1].id] }, 'Selected accounts and case-insensitive duplicate emails are sent once');
    assert.equal(await execute('document.querySelector(".call-invite-back").disabled'), true, 'Back cannot unmount an in-flight invitation');
    assert.equal(await execute('[...document.querySelectorAll(".conference-invitation-form input")].every(e=>e.disabled)'), true, 'Recipient edits are disabled while sending');
    await execute('document.querySelector(".call-invite-modal .modal-close").click();document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));document.querySelector(".modal-backdrop").dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));document.querySelector(".conference-invitation-form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
    await capture('invite-sending-busy-guard');
    assert.equal(await execute('!!document.querySelector(".call-invite-modal")'), true, 'Close button, Escape and backdrop cannot dismiss a pending invitation');
    assert.equal(invitationPosts.length, postsBeforeValidation+1, 'Repeated submit while busy does not duplicate the POST');
    holdInvitation = false; pendingInvitation(); pendingInvitation = null;
    await visible('Приглашение поставлено в очередь');
    await until(() => execute('!document.querySelector(".call-invite-back").disabled'), 'Successful POST releases the busy guard');
    assert.equal(await execute(`document.querySelector(${JSON.stringify(emails)}).value`), '', 'Successful server response clears recipient emails');
    assert.equal(await execute('document.querySelectorAll(".invitation-selected li").length'), 0, 'Successful server response clears selected users');
    await capture('invite-confirmed-by-local-backend');
    await closeWithEscape();
    checks.push('Invitation search and the real POST run through the production broker to localhost only; invalid/21-recipient input is rejected, multiline paste preserves each address and the surrounding selection/caret, selected users and duplicate emails are deduplicated, and success is shown only after the backend reply');
    checks.push('During a held invitation POST, edits/back are disabled, close/Escape/backdrop preserve the dialog and repeated submit is ignored; a confirmed reply clears recipients and releases the close guard');

    const openRoom = async () => {
      await route('/conferences');
      await until(() => execute('!document.querySelector(".call-reference-room")'), 'Previous room unmounts');
      await tracksAre(0,0);
      const previousSocketCount = conferenceSockets.length;
      await route(room); await exists('.call-reference-room .conference-control-bar');
      await until(() => Promise.resolve(conferenceSockets.length > previousSocketCount), 'A fresh room subscription is created');
      await sendPresence();
    };
    await setAppearance('light', '100', room);
    window.setContentSize(1440,1000);
    await sendPresence();
    for (const [device,audio,video] of [['microphone',1,0],['camera',0,1]]) {
      if (device === 'camera') await openRoom();
      const requestsBefore = await execute('window.__callUI.requests.length');
      const joinsBefore = mediaJoins.length;
      await click(`.room-${device}-control`);
      await tracksAre(audio,video);
      await until(() => Promise.resolve(mediaJoins.length > joinsBefore), `${device} start reaches the fixture media.join boundary`);
      const requested = await execute(`window.__callUI.requests.slice(${requestsBefore})`);
      assert.ok(requested.length > 0, `${device} explicitly asks Chromium for capture`);
      assert.ok(requested.every(constraints => device === 'microphone' ? !!constraints.audio && constraints.video === false : constraints.audio === false && !!constraints.video), `${device} initial start requests only its selected source`);
      await exists(`.room-${device}-control[aria-pressed=true]`);
      await capture(`toolbar-${device}-started-without-sfu`, 'media-starting');
    }
    await openRoom();
    const receiveOnlyBefore = await execute('window.__callUI.requests.length');
    const joinsBeforeReceiveOnly = mediaJoins.length;
    await exists('.room-media-connection .button');
    assert.equal(await execute('!!document.querySelector(".conference-control-bar .room-media-connection")'), false, 'Receive-only connection is separate from the toolbar');
    await click('.room-media-connection .button');
    await until(() => Promise.resolve(mediaJoins.length > joinsBeforeReceiveOnly), 'Receive-only start reaches the fixture media.join boundary');
    await tracksAre(0,0);
    assert.equal(await execute('window.__callUI.requests.length'), receiveOnlyBefore, 'Receive-only start does not request camera or microphone');
    await capture('toolbar-receive-only-without-sfu', 'media-starting');
    const openRecording = 'button[aria-label="Записи конференции"]';
    const recordingDialog = '.meeting-recording-modal';
    const startRecording = recordingDialog + ' .button-primary';
    const stopRecording = recordingDialog + ' .button-danger';
    await click(openRecording);
    await until(() => execute(`document.querySelectorAll('${recordingDialog} input[type=radio]').length === 4 && !document.querySelector('${startRecording}')?.disabled`), 'Recording shows the four server-supported formats');
    assert.equal(await execute(`document.querySelector('${recordingDialog} input:checked').value`), 'composite');
    await capture('meeting-recording-modal-desktop');
    window.setMinimumSize(320,500);
    window.setContentSize(390,650);
    await until(() => execute('Math.abs(innerWidth - 390) <= 2'), 'Compact recording dialog viewport');
    await capture('meeting-recording-modal-compact');
    window.setContentSize(1440,1000);
    await click(recordingDialog + ' input[value="audio_only"]');
    await until(() => execute(`!document.querySelector('${startRecording}')?.disabled`), 'Selected format can start');
    await click(startRecording);
    await until(() => execute(`!document.querySelector('${recordingDialog}')`), 'Successful start closes recording dialog');
    assert.deepEqual(recordingStarts, ['audio_only']);
    await click(openRecording);
    await exists(stopRecording);
    await click(stopRecording); await visible('Остановить запись?');
    assert.equal(recordingStops, 0, 'Stop awaits confirmation');
    await click(recordingDialog + ' .button-outline');
    assert.equal(recordingStops, 0, 'Cancel leaves the recording running');
    await click(stopRecording); await click(stopRecording);
    await visible('Файлы появятся в записях встречи после обработки.');
    assert.equal(recordingStops, 1, 'Confirm sends one stop command');
    await click(recordingDialog + ' .modal-close');
    checks.push('Recording dialog fits desktop and compact widths, renders server-supported radio cards, starts the selected mode, confirms stop, and shows processing from the API');

    await route('/conferences'); await tracksAre(0,0);
    await route(`${room}?chat=1`); await exists('.call-reference-room.room-panel-open');
    await exists(`${chatControl}[aria-expanded=true]`);
    assert.equal(await execute('document.querySelector(".conference-stage-rail").hidden'), false, 'Explicit chat deep link still opens the chat panel');
    await capture('toolbar-explicit-chat-deep-link', 'disconnected');
    await route('/conferences'); await tracksAre(0,0);
    checks.push('Room side panel starts closed; participants/chat buttons each open and close their panel on repeated clicks, while an explicit ?chat=1 link opens chat');
    checks.push('Before any media connection, microphone starts only audio and camera starts only video through production getUserMedia; each reaches media.join without requiring synthetic SDP, and room unmount stops all owned tracks');
    checks.push('The separate receive-only action reaches media.join without getUserMedia or live local tracks; no SFU answer, connected peer or remote stream is fabricated');
    assert.deepEqual(blockedDestinations, []);
    assert.deepEqual(await execute('window.__callUI.errors'), []);
    assert.ok(fixture.requests.some(request => request.method === 'POST' && request.path.endsWith('/join')), 'Join went through the production broker');
    const result = { ok: true, checks, captures, tracks: await trackCounts(), captureRequests: await execute('window.__callUI.requests'), mediaJoinRequests: mediaJoins.length,
      invitations: { queries: invitationQueries, posts: invitationPosts, clipboard: visualOnly ? 'Not tested: visual-only run' : 'Native copy verified; original clipboard formats restored' }, platform: process.platform, arch: process.arch,
      captureSource: 'Chromium fake devices via production getUserMedia and permission policy',
      network: 'Disposable HTTPS/WebSocket loopback fixture only; broker rejects all other destinations',
      limitations: ['No SFU media transmission', 'No real camera/microphone or Windows/Linux runtime acceptance'] };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result,null,2)+'\n');
    await fs.rm(path.join(output, 'failure.png'), { force: true });
    await fs.rm(path.join(output, 'failure.json'), { force: true });
    console.log(JSON.stringify({ ok:true, captures: captures.length, checks, tracks: result.tracks }));
    clearTimeout(watchdog); window.destroy(); await fixture.close(); await certificates.close(); app.exit(0);
  } catch (error) {
    console.error(error.stack);
    await restoreClipboard().catch(restoreError => console.error(`Clipboard restoration failed: ${restoreError.message}`));
    if (window && !window.isDestroyed()) {
      const diagnostics = await window.webContents.executeJavaScript(`(()=>{const qa=window.__callUI;const tracks=qa?.tracks.map(r=>r.deref()).filter(Boolean)||[];return {path:location.pathname+location.search,requests:qa?.requests,tracks:tracks.map(t=>({kind:t.kind,state:t.readyState})),errors:qa?.errors,mediaStatus:document.querySelector('[data-testid=media-status]')?.textContent,connectionNotice:document.querySelector('.conference-connection-notice')?.textContent};})()`).catch(() => null);
      await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, diagnostics, mediaJoinRequests: mediaJoins.length },null,2)+'\n').catch(()=>{});
      await fs.writeFile(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG()).catch(()=>{});
      window.destroy();
    }
    clearTimeout(watchdog); if(fixture) await fixture.close(); if(certificates) await certificates.close(); app.exit(1);
  }
})();
