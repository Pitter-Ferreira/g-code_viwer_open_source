const { launch, devices, serve, fx, out, PAGE, PAGE_PATH } = require('./common');
(async () => {
  const b = await launch();
  for (const dark of [true, false]) {
    const p = await b.newPage({ viewport: { width: 1400, height: 860 }, colorScheme: dark ? 'dark' : 'light' });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(PAGE);
    await p.setInputFiles('#fileIn', fx('cores.tap')); await p.waitForTimeout(700);
    await p.evaluate(() => { const c = document.getElementById('code'); c.scrollTop = 0; c.dispatchEvent(new Event('scroll')); });
    await p.waitForTimeout(200);
    for (const id of ['infoPanel', 'editPanel', 'viewPanel', 'layerPanel']) await p.evaluate(id => { const e = document.getElementById(id); if (e && !e.hidden && !e.classList.contains('collapsed')) e.querySelector('h3').click(); }, id);
    await p.waitForTimeout(200);
    await p.locator('#codePanel').screenshot({ path: out(`hl-${dark ? 'dark' : 'light'}.png`) });
    console.log(dark ? 'escuro' : 'claro', await p.$eval('.ln[data-l="5"] .tx', e => [...e.children].map(c => c.textContent + '=' + c.className).join(' ')), errs.join(' ') || 'sem erros');
  }
  await b.close();
})();
