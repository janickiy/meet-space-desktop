// Exercise the production renderer at exact logical viewports, including ones larger than the host display.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async ({ window, route, visible, click, tab, execute, until, output }) => {
  const sizes = [[1024,768],[1280,720],[1366,768],[1440,900],[1920,1080],[2560,1440],[3840,2160]];
  const cdp = window.webContents.debugger;
  cdp.attach("1.3");
  const dir = path.join(output, "matrix");
  await fs.mkdir(dir, { recursive: true });
  const results = [];
  const setViewport = (width,height,scale) => cdp.sendCommand("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor:scale, mobile:false, screenWidth:width, screenHeight:height,
  });
  const setOS = value => cdp.sendCommand("Emulation.setEmulatedMedia", {
    features:[{name:"prefers-color-scheme",value}],
  });
  async function check(width, height, scale, theme) {
    await setViewport(width, height, scale);
    await execute("document.fonts.ready");
    await execute("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    const view = await execute(`(()=>{
      const dimensions=e=>({client:e.clientWidth,scroll:e.scrollWidth,height:e.getBoundingClientRect().height});
      return { width:innerWidth,height:innerHeight,scale:devicePixelRatio,theme:document.documentElement.dataset.theme,
        body:dimensions(document.documentElement),content:dimensions(document.querySelector('.workspace-main')),
        rail:document.querySelector('.sidebar').getBoundingClientRect().width,
        chrome:dimensions(document.querySelector('.desktop-titlebar')).height,footer:dimensions(document.querySelector('.desktop-status')).height };
    })()`);
    assert.deepEqual([view.width,view.height,view.scale,view.theme], [width,height,scale,theme]);
    assert.ok(view.body.scroll<=view.body.client+1 && view.content.scroll<=view.content.client+1, JSON.stringify(view));
    assert.equal(view.rail,width<1200 ? 68 : 216);
    assert.equal(view.chrome,56);
    assert.equal(view.footer,28);
    if (width === 1440 && height === 900) {
      const bounds = await execute(`[".meetings-quick-primary", ".meetings-section-heading", ".tabs", ".search-field", ".conference-filters", ".meeting-results-toolbar", ".collection-view-toggle", ".dashboard-meeting-row"].map(selector => {
        const {x,y,width,height} = document.querySelector(".meetings-reference-page " + selector).getBoundingClientRect();
        return [x,y,width,height].map(Math.round);
      })`);
      assert.deepEqual(bounds, [
        [248,164,390,106], [248,327,1160,33], [248,374,430,47],
        [1088,376,320,38], [248,441,1160,96], [248,553,1160,52],
        [1312,553,96,52], [248,617,1160,105],
      ], "Meetings workspace matches the desktop design at its reference viewport");
    }
    const name = `meetings-${theme}-${width}x${height}-${scale}.jpg`;
    const {data} = await cdp.sendCommand("Page.captureScreenshot",{format:"jpeg",quality:70,captureBeyondViewport:false});
    await fs.writeFile(path.join(dir,name),Buffer.from(data,"base64"));
    results.push({...view, file:name});
  }
  try {
    await route("/app/settings"); await visible("Мой профиль"); await tab("Внешний вид");
    await click('input[type=radio][value=system]');
    for (const theme of ["dark","light"]) {
      await setOS(theme);
      await until(()=>execute(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`), "System theme follows OS");
      await route("/conferences"); await visible("Product scheduled meeting");
      for (const [width,height] of sizes) await check(width,height,1,theme);
      await route("/app/settings"); await visible("Мой профиль"); await tab("Внешний вид");
      assert.ok(await execute('document.querySelector("input[value=system]").checked'));
    }
    await click('input[type=radio][value=light]'); await setOS("dark");
    await route("/conferences"); await visible("Product scheduled meeting");
    for (const scale of [1.25,1.5,1.75,2]) await check(1280,720,scale,"light");
    await fs.writeFile(path.join(dir,"result.json"), JSON.stringify({engine:process.versions.chrome, platform:process.platform,arch:process.arch,
      method:"Electron CDP logical viewport, deviceScaleFactor, and system color scheme emulation",results},null,2));
  } finally {
    await cdp.sendCommand("Emulation.clearDeviceMetricsOverride");
    await cdp.sendCommand("Emulation.setEmulatedMedia",{features:[]});
    cdp.detach();
  }
};
