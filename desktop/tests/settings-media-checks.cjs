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
  const labels=await execute("[...document.querySelectorAll('.preference-checkbox .preference-title')].map(e=>e.textContent)");
  assert.deepEqual(labels,['Приглашения и изменения встреч','Напоминания о встречах','Готовность записи','Email']);
  await click('.preference-checkbox input');
  await clickText('Сохранить настройки');await visible('Настройки сохранены.');
  assert.deepEqual(fixture.product.controls.savedNotificationPreferences,{invitation:false,reminder:true,recording:true,summary:true,email:true,push:true});
  await click('.preferences-fieldset:nth-of-type(2) input');
  assert.equal(await execute("[...document.querySelectorAll('.preferences-fieldset:nth-of-type(2) button')].find(e=>e.textContent.includes('Проверить звук')).disabled"),true);
  checks.push('Notification event/email choices save through HTTPS and preserve hidden summary/push preferences; sound-off disables the test');
  for(const theme of ['light','dark']) {
    await clickText('Внешний вид'); await click(`input[value=${theme}][type=radio]`);
    for(const width of [1440,1024]) {
      window.setContentSize(width,1000);
      for(const tab of ['Аудио','Видео','Уведомления']) {
        await clickText(tab);
        await execute('document.fonts.ready');
        await execute('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        assert.equal(await execute("document.querySelector('.account-dialog-panel').scrollWidth > document.querySelector('.account-dialog-panel').clientWidth+1"),false,`${tab} does not overflow at ${width}`);
        await fs.writeFile(path.join(directory,`settings-${{Аудио:'audio',Видео:'video',Уведомления:'notifications'}[tab]}-${theme}-${width}.png`),(await window.webContents.capturePage()).toPNG());
      }
    }
  }
  checks.push('Audio/video/notification cards fit at 1440 and 1024 CSS pixels in light and dark themes');
  await clickText('Внешний вид'); await click('input[value=light][type=radio]');
  return checks;
};
