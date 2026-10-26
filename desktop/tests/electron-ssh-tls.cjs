// Renderer/preload/IPC acceptance for the certificate choice. Cryptographic
// validation and the signed remote runner have separate tests with real PEMs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, ipcMain } = require('electron');
app.setPath('userData', process.argv[2]); app.setPath('sessionData', process.argv[2]);
const { startApp } = require('../dist/main.js');
const output = path.resolve(__dirname, '../artifacts/ssh-tls-choice-20261025');
const fullchain = '-----BEGIN CERTIFICATE-----\nUI-CERT-FIXTURE\n-----END CERTIFICATE-----\n';
const privateKey = '-----BEGIN PRIVATE KEY-----\nUI-KEY-FIXTURE\n-----END PRIVATE KEY-----\n';
const initial = () => ({ busy: false, phase: 'preflight', hasCredentials: true,
  endpoint: { host: 'vps.example.com', port: 22, user: 'root' },
  identity: { fingerprint: 'SHA256:' + 'F'.repeat(43), algorithm: 'ssh-ed25519', changed: false, trusted: true },
  preflight: { domain: 'meet.example.com', publicIpv4: '8.8.8.8', checkedAt: new Date().toISOString(), ready: true, checks: [] } });
(async () => {
  const checks = [], screenshots = [], layouts = [], calls = [];
  let window, state = initial();
  const timer = setTimeout(() => app.exit(1), 75000);
  try {
    window = await startApp({ show: false, userDataDir: process.argv[2], rendererRoot: path.resolve(__dirname, '../../frontend/dist-desktop') });
    assert.ok(window); window.setMinimumSize(0, 0);
    ipcMain.removeHandler('meetspace:ssh:state');
    ipcMain.handle('meetspace:ssh:state', () => ({ ok: true, value: structuredClone(state) }));
    ipcMain.removeHandler('meetspace:ssh:action');
    ipcMain.handle('meetspace:ssh:action', (event, action, input) => {
      assert.equal(event.sender, window.webContents); assert.equal(event.senderFrame, window.webContents.mainFrame);
      calls.push({ action, input });
      if (action === 'plan') {
        assert.equal(input.options.tlsMode, 'custom');
        assert.deepEqual(input.tlsCertificate, { fullchain, privateKey });
        assert.equal(input.options.fullchain, undefined); assert.equal(input.options.privateKey, undefined);
        state.plan = { hash: 'a'.repeat(64), version: 'v0.4.0', commit: 'b'.repeat(40),
          options: { ...input.options, publicIpv4: '8.8.8.8', certificateSha256: 'c'.repeat(64) },
          architecture: 'arm64', installDocker: false, expiresAt: Math.floor(Date.now() / 1000) + 900,
          sourceSha256: 'd'.repeat(64), installDockerPluginsOnly: false, missingDockerPlugins: [], actions: [], imageMode: 'images' };
        state.phase = 'planned';
      } else if (action === 'apply') {
        assert.equal(input.confirmedPlanHash, state.plan.hash);
        assert.equal(input.acceptAcmeTerms, false, 'Custom certificate never implies accepting ACME terms');
        assert.deepEqual(input.tlsCertificate, { fullchain, privateKey });
        state.ticket = { jobId: '592ec96c-2562-4509-95ef-fbe145f2e22f', domain: state.plan.options.domain, ...state.endpoint, planHash: state.plan.hash };
        state.phase = 'completed'; state.hasCredentials = false;
        state.status = { jobId: state.ticket.jobId, state: 'completed', phase: 'readiness',
          completedPhases: ['docker','source','images','configuration','dependencies','backup','migrations','https','services','readiness'], events: [], terminal: true };
      } else if (action === 'detach') state.hasCredentials = false;
      return { ok: true, value: structuredClone(state) };
    });
    const execute = (code) => window.webContents.executeJavaScript(code, true);
    const until = async (predicate, label) => { const end = Date.now() + 7000; while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(label); };
    const visible = (text) => until(async () => (await execute('document.body.innerText')).includes(text), 'Missing ' + text);
    const click = (selector) => execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const clickText = (text) => execute(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e||e.disabled)throw new Error('Unavailable button');e.click();})()`);
    const disabled = (text) => execute(`([...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}))?.disabled`);
    const chooseFile = (kind, content, name) => execute(`(()=>{const input=document.getElementById('desktop-ssh-tls-'+${JSON.stringify(kind)});const data=new DataTransfer();data.items.add(new File([${JSON.stringify(content)}],${JSON.stringify(name)},{type:'application/x-pem-file'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await fs.mkdir(output, { recursive: true });
    const capture = async (name, width, largeText = false, theme = 'light') => {
      window.setMinimumSize(0, 0); window.setContentSize(width, 1000);
      await execute(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.dataset.largeText=${JSON.stringify(String(largeText))};document.documentElement.style.setProperty('--text-scale',${JSON.stringify(largeText ? '1.5' : '1')});document.querySelector('.desktop-ssh-tls')?.scrollIntoView({block:'start'});document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
      const layout = await execute(`(()=>({width:innerWidth,documentWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('.desktop-ssh-tls,.desktop-ssh-tls-files,.desktop-ssh-source-options,.desktop-ssh-source-option,.desktop-ssh-tls-files input,.desktop-ssh-tls-files label,.desktop-ssh-tls-file-status')].filter(e=>e.clientWidth&&e.scrollWidth>e.clientWidth+1).map(e=>e.id||e.className)}))()`);
      assert.equal(layout.width, width); assert.ok(layout.scrollWidth <= layout.documentWidth + 1); assert.deepEqual(layout.overflow, []);
      layouts.push({ name, ...layout });
      const file = path.join(output, name + '.png'); await fs.writeFile(file, (await window.webContents.capturePage()).toPNG()); screenshots.push(file);
    };
    await visible('Начнём с подключения'); await clickText('Продолжить'); await visible('Подключиться к серверу');
    await clickText('Установить сервер по SSH'); await visible('SSL-сертификат');
    assert.equal(await execute(`document.querySelector('input[name="desktop-ssh-tls-mode"]:checked').value`), 'letsencrypt');
    assert.equal(await execute(`!!document.getElementById('desktop-ssh-acme-email')`), true);
    await click('input[name="desktop-ssh-tls-mode"][value="custom"]');
    assert.equal(await execute(`!!document.getElementById('desktop-ssh-acme-email')`), false);
    assert.equal((await execute('document.body.innerText')).includes('Для сертификата HTTPS нужны доступные порты 80 и 443.'), false);
    assert.equal(await disabled('Подготовить план установки'), true);
    await chooseFile('privateKey', 'X'.repeat(16 * 1024 + 1), 'oversize.key'); await visible('Выберите приватный PEM-ключ размером до 16 КБ.');
    assert.equal(await disabled('Подготовить план установки'), true);
    await chooseFile('fullchain', 'X'.repeat(64 * 1024 + 1), 'oversize.pem'); await visible('Выберите PEM-сертификат размером до 64 КБ.');
    assert.equal(await disabled('Подготовить план установки'), true);
    await chooseFile('privateKey', '-----BEGIN ENCRYPTED PRIVATE KEY-----\nfixture\n-----END ENCRYPTED PRIVATE KEY-----\n', 'encrypted.pem');
    await visible('Нужен соответствующий приватный PEM-ключ без пароля.');
    assert.equal(await disabled('Подготовить план установки'), true);
    checks.push('Custom mode hides ACME-only fields; incomplete, oversized and encrypted-key inputs cannot prepare a plan');
    await execute(`(()=>{window.__originalFileText=File.prototype.text;File.prototype.text=function(){return new Promise(resolve=>{window.__finishTlsRead=resolve;});};const input=document.getElementById('desktop-ssh-tls-fullchain');const data=new DataTransfer();data.items.add(new File(['fixture'],'pending.pem'));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click('input[name="desktop-ssh-tls-mode"][value="letsencrypt"]');
    await execute(`File.prototype.text=window.__originalFileText;window.__finishTlsRead(${JSON.stringify(fullchain)});delete window.__finishTlsRead;delete window.__originalFileText;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await click('input[name="desktop-ssh-tls-mode"][value="custom"]');
    assert.equal((await execute('document.body.innerText')).includes('pending.pem'), false);
    assert.equal(await disabled('Подготовить план установки'), true);
    checks.push('Switching mode invalidates pending file reads and clears previously selected material');
    await chooseFile('fullchain', fullchain, 'meeting-fullchain.pem');
    await chooseFile('privateKey', privateKey, 'meeting-private.key');
    await until(async () => !(await disabled('Подготовить план установки')), 'Both selected files enable plan');
    for (const [name, width, large, theme] of [['custom-1280-light',1280,false,'light'],['custom-800-dark-large',800,true,'dark'],['custom-480-light',480,false,'light']]) await capture(name, width, large, theme);
    const body = await execute('document.body.innerText'); assert.ok(body.includes('meeting-fullchain.pem') && body.includes('meeting-private.key'));
    assert.equal(body.includes('UI-KEY-FIXTURE'), false); assert.equal(body.includes('UI-CERT-FIXTURE'), false);
    await clickText('Подготовить план установки'); await visible('SHA-256 сертификата');
    assert.equal(await execute(`!!document.getElementById('desktop-ssh-acme-consent')`), false);
    assert.equal((await execute('document.body.innerText')).includes("Прочитать условия Let's Encrypt"), false);
    await clickText('Обновить план'); await until(() => Promise.resolve(calls.filter(c => c.action === 'plan').length === 2), 'Custom plan refresh forwards the same selected files');
    await click('#desktop-ssh-plan-consent'); await until(async () => !(await disabled('Установить MeetSpace')), 'Custom apply needs plan consent without ACME terms');
    await clickText('Установить MeetSpace'); await visible('Ваше пространство готово.');
    assert.equal(calls.filter(c => c.action === 'apply').length, 1);
    assert.equal((await execute('JSON.stringify(localStorage)')).includes('UI-KEY-FIXTURE'), false);
    assert.equal((await execute('document.body.innerText')).includes('meeting-private.key'), false);
    checks.push('Custom mode shows plan certificate fingerprint, requires no ACME consent and sends matching files only through explicit plan/apply calls; terminal view clears file selection');
    await click('.desktop-ssh-close'); await visible('Подключиться к серверу');
    state = initial(); await clickText('Установить сервер по SSH'); await visible('SSL-сертификат');
    await click('input[name="desktop-ssh-tls-mode"][value="custom"]');
    assert.equal(await disabled('Подготовить план установки'), true);
    assert.equal((await execute('document.body.innerText')).includes('meeting-private.key'), false);
    checks.push('Closing and reopening the wizard starts with no certificate material');
    await fs.writeFile(path.join(output, 'tls-ui.json'), JSON.stringify({ result: 'PASS', checks, layouts, screenshots }, null, 2));
    clearTimeout(timer); window.destroy(); app.exit(0);
  } catch (error) {
    console.error(error.message); await fs.mkdir(output, { recursive: true });
    if (window) await fs.writeFile(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG()).catch(() => {});
    await fs.writeFile(path.join(output, 'tls-ui.json'), JSON.stringify({ result: 'FAIL', error: error.message, checks, layouts, screenshots }, null, 2));
    clearTimeout(timer); app.exit(1);
  }
})();
