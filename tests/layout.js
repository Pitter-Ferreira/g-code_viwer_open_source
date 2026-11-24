const { launch, devices, serve, fx, out, PAGE, PAGE_PATH } = require('./common');
(async () => {
  const b = await launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const errs = [];
  for (const [w, h, name, dark] of [[1400, 860, 'l-1400', true], [1024, 768, 'l-1024', false]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light' });
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    await p.addInitScript(() => { try { localStorage.setItem('gcv-files', '1'); } catch (e) {} });
    await p.goto(PAGE);
    await p.setInputFiles('#dirIn', fx('pasta')); await p.waitForTimeout(300);
    await p.click('#tree .tr.dir >> text=Clientes');
    await p.evaluate(() => loadSample('cnc')); await p.waitForTimeout(800);
    const r = await p.evaluate(() => { const g = s => { const e = document.querySelector(s).getBoundingClientRect(); return [Math.round(e.left), Math.round(e.top), Math.round(e.width), Math.round(e.height)].join(','); }; return { files: g('.files'), top: g('.top'), vp: g('#vp'), player: g('.player'), side: g('.side'), views: [...document.querySelectorAll('#views button')].map(b => b.textContent).join('|'), scrollW: document.documentElement.scrollWidth }; });
    console.log(name, JSON.stringify(r));
    await p.screenshot({ path: out(name + '.png') });
    await p.close();
  }
  const m = await b.newPage({ ...devices['iPhone 13'] });
  m.on('pageerror', e => errs.push('mobile: ' + e.message));
  await m.goto(PAGE);
  await m.evaluate(() => loadSample('cnc')); await m.waitForTimeout(800);
  console.log('mobile scrollW', await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
  await m.screenshot({ path: out('l-mobile.png') });
  console.log(errs.join('\n') || 'sem erros');
  await b.close();
})();
