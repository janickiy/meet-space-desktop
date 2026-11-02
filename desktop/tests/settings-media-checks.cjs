const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async ({execute,until,visible,click,clickText,field,route,fixture,window,directory}) => {
  const checks=[];
  await route('/app/settings');
  await clickText('Аудио'); await visible('Громкость микрофона');
  const ranges=await execute("[...document.querySelectorAll('.reference-audio input[type=range]')].map(e=>e.getAttribute('aria-label'))");
  assert.deepEqual(ranges,['Громкость микрофона','Громкость динамика','Громкость сигналов']);
  assert.equal(await execute("!!document.querySelector('.reference-audio select[aria-label=Камера]')"),false);
  const pref = () => execute("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('meet.devices.v1:')))||'null')");
  for (const [label,value,key] of [['Громкость микрофона','37','microphoneVolume'],['Громкость динамика','0','outputVolume'],['Громкость сигналов','23','signalVolume']]) {
    await field(`input[aria-label="${label}"]`,value);
    await until(async()=> (await pref())?.[key]===Number(value),label+' persists independently');
  }
  await clickText('Видео'); await visible('Предпросмотр доступен только вам.');
  assert.deepEqual(await execute("[...document.querySelectorAll('.reference-video .device-toggle-row')].map(e=>e.firstElementChild.firstChild.textContent)"),['Подключаться с выключенной камерой','Видеть себя на звонке','Скрыть видео участников']);
  assert.equal(await execute("!!document.querySelector('.reference-video select[aria-label=Микрофон]')"),false);
  await click('.reference-video .device-toggle-row input');
  const cam=(await pref()).cameraEnabled;
  await clickText('Аудио'); await visible('Громкость микрофона');
  assert.deepEqual(await execute("[...document.querySelectorAll('.reference-audio input[type=range]')].map(e=>e.value)"),['37','0','23']);
  assert.equal((await pref()).cameraEnabled,cam);
  checks.push('Audio and Video expose the reference controls in separate tabs; microphone/speaker/signal volume and camera preference persist independently');
  await clickText('Уведомления'); await visible('Каналы доставки');
  const labels=await execute("[...document.querySelectorAll('.preferences-fieldset:not(:nth-of-type(2)) .preference-toggle .preference-title')].map(e=>e.textContent)");
  assert.deepEqual(labels,['Приглашения и изменения встреч','Напоминания о встречах','Готовность записи','Email']);
  const switches=await execute("[...document.querySelectorAll('.preferences-form input[type=checkbox]')].map(e=>({role:e.getAttribute('role'),appearance:getComputedStyle(e).appearance,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))");
  assert.equal(switches.length,5);
  assert.ok(switches.every(s=>s.role==='switch' && s.appearance==='none' && s.width===34 && s.height===20),'All notification choices use the shared switch style');
  await execute("document.querySelector('.preferences-fieldset input[role=switch]').focus();void 0");
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
  await until(()=>execute("document.querySelector('.preferences-fieldset input').checked===false"),'Space toggles the invitation switch');
  await clickText('Сохранить настройки');await visible('Настройки сохранены.');
  assert.deepEqual(fixture.product.controls.savedNotificationPreferences,{invitation:false,reminder:true,recording:true,summary:true,email:true,push:true});
  await click('.preferences-fieldset:nth-of-type(2) input');
  assert.equal(await execute("[...document.querySelectorAll('.preferences-fieldset:nth-of-type(2) button')].find(e=>e.textContent.includes('Проверить звук')).disabled"),true);
  checks.push('Notification event/email/sound choices use consistent accessible switches; Space toggles the invitation setting; HTTPS save preserves hidden summary/push preferences; sound-off disables the test');
  for(const theme of ['light','dark']) {
    await clickText('Внешний вид'); await click(`input[value=${theme}][type=radio]`);
    for(const width of [1440,1024]) {
      window.setContentSize(width,1000);
      for(const tab of ['Аудио','Видео','Уведомления']) {
        await clickText(tab);
        await execute('document.fonts.ready');
        await execute('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        assert.equal(await execute("document.querySelector('.account-dialog-panel').scrollWidth > document.querySelector('.account-dialog-panel').clientWidth+1"),false,`${tab} does not overflow at ${width}`);
        if (tab==='Уведомления') {
          const rows=await execute(`(()=>{
            const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,center:r.top+r.height/2}};
            return [...document.querySelectorAll('.preference-toggle')].map(e=>({row:rect(e),input:rect(e.querySelector('input')),copy:rect(e.querySelector('.preference-copy')),clipped:e.scrollWidth>e.clientWidth+1}));
          })()`);
          assert.equal(rows.length,5);
          assert.ok(rows.every(e=>!e.clipped && e.copy.right+15<=e.input.left && Math.abs(e.input.center-e.row.center)<1),'Notification switches align right and stay centered without overlapping labels');
          assert.ok(rows.every(e=>Math.abs(e.input.right-rows[0].input.right)<1),'All switch right edges align');
        }
        await fs.writeFile(path.join(directory,`settings-${{Аудио:'audio',Видео:'video',Уведомления:'notifications'}[tab]}-${theme}-${width}.png`),(await window.webContents.capturePage()).toPNG());
      }
    }
  }
  checks.push('Audio/video/notification cards fit at 1440 and 1024 CSS pixels in light and dark themes');
  const audioLayouts=[];
  for (const theme of ['light','dark']) {
    await clickText('Внешний вид'); await click(`input[value=${theme}][type=radio]`);
    await clickText('Аудио'); await visible('Громкость микрофона');
    for (const width of [1920,1662,1440,1024]) {
      window.setContentSize(width,1000);
      for (const scale of [1,1.25]) {
        await execute(`document.documentElement.style.setProperty('--text-scale',${JSON.stringify(String(scale))});void 0`);
        await execute('document.fonts.ready');
        await execute('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        const layout=await execute(`(()=>{
          const panel=document.querySelector('.reference-audio');
          const grid=panel.querySelector('.settings-audio-cards');
          const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
          const cards=[...grid.children];
          return {width:innerWidth,panelWidth:panel.clientWidth,grid:rect(grid),cards:cards.map(rect),overflow:cards.some(e=>e.scrollWidth>e.clientWidth+1),clippedControls:[...grid.querySelectorAll('button,input,select')].filter(e=>e.getClientRects().length&&e.tagName!=='SELECT'&&(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)).map(e=>e.getAttribute('aria-label')||e.textContent)};
        })()`);
        assert.equal(layout.cards.length,3);
        assert.equal(layout.overflow,false,'Audio card must not overflow');
        assert.deepEqual(layout.clippedControls,[],'Audio controls must not clip');
        if (layout.panelWidth>=840) {
          assert.ok(layout.cards.every(c=>Math.abs(c.top-layout.cards[0].top)<1),'All three audio cards share one row');
          assert.ok(layout.cards.every(c=>Math.abs(c.width-layout.cards[0].width)<1),'Audio cards have equal widths');
          assert.ok(layout.cards.every(c=>Math.abs(c.bottom-layout.cards[0].bottom)<1),'Audio card bottoms align');
          assert.ok(layout.cards[0].right+17<=layout.cards[1].left && layout.cards[1].right+17<=layout.cards[2].left,'Audio cards keep their gaps');
        } else {
          assert.ok(layout.cards[0].bottom+17<=layout.cards[1].top && layout.cards[1].bottom+17<=layout.cards[2].top,'Narrow audio panel stacks cards without overlap');
        }
        if (width===1920) assert.ok(layout.panelWidth>=840,'Wide desktop must show the requested single row');
        audioLayouts.push({theme,scale,...layout});
        await fs.writeFile(path.join(directory,`audio-row-${theme}-${width}-${scale}.png`),(await window.webContents.capturePage()).toPNG());
      }
    }
  }
  await execute("document.documentElement.style.removeProperty('--text-scale');void 0");
  await fs.writeFile(path.join(directory,'audio-row-layout.json'),JSON.stringify(audioLayouts,null,2)+'\n');
  checks.push('Shared Audio layout: three equal cards in a single row when content fits; narrow panels stack; light/dark at 1024/1440/1662/1920 with 100%/125% text; no clipped controls');
  await clickText('Внешний вид'); await click('input[value=light][type=radio]');
  return checks;
};
