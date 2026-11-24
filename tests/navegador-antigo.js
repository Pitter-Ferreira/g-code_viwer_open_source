const { launch, devices, serve, fx, out, PAGE, PAGE_PATH } = require('./common');
const OLD = `
  (function(){
    var og = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(t, o){ if (t === 'webgl2' || t === 'webgl' || t === 'experimental-webgl') return null; return og.call(this, t, o); };
    window.PointerEvent = undefined; window.ResizeObserver = undefined;
    HTMLCanvasElement.prototype.toBlob = undefined;
    try { delete NodeList.prototype.forEach; } catch(e){}
    Element.prototype.closest = undefined; String.prototype.padStart = undefined; String.prototype.includes = undefined;
    Array.prototype.includes = undefined; Blob.prototype.text = undefined;
    Math.hypot = undefined; Math.log10 = undefined; Object.assign = undefined; Array.from = undefined;

    Object.defineProperty(KeyboardEvent.prototype, 'key', { get: function(){ return undefined; } });
    window.HTMLDialogElement = undefined;
  })();`;
(async () => {
  const b = await launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  for (const mode of ['moderno', 'antigo']) {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const errs = [];
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('dialog', d => d.accept()); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    if (mode === 'antigo') await p.addInitScript(OLD);
    await p.goto(PAGE);
    await p.waitForTimeout(400);
    console.log('==', mode, '| render:', await p.$eval('#renderInfo', e => e.textContent), '| ready:', await p.evaluate(() => !!window.__gcvReady));
    for (const s of ['cnc', '3d', 'laser']) {
      await p.evaluate(s => loadSample(s), s);
      await p.waitForTimeout(700);
      await p.screenshot({ path: out(`${mode}-${s}.png`) });
    }
    // interação: arrastar, roda, simulação, camada, teclado, cores, colar, png
    await p.mouse.move(500, 400); await p.mouse.down(); await p.mouse.move(580, 430, { steps: 4 }); await p.mouse.up();
    await p.mouse.wheel(0, -200);
    await p.evaluate(() => loadSample('3d')); await p.waitForTimeout(600);
    await p.$eval('#layerSl', e => { e.value = 25; e.dispatchEvent(new Event('input')); });
    await p.check('#chkSingle'); await p.waitForTimeout(200);
    await p.screenshot({ path: out(`${mode}-layer.png`) });
    await p.uncheck('#chkSingle');
    await p.$eval('#layerSl', e => { e.value = e.max; e.dispatchEvent(new Event('input')); });
    await p.selectOption('#selColor', '1'); await p.waitForTimeout(300);
    await p.screenshot({ path: out(`${mode}-zcolor.png`) });
    await p.selectOption('#selColor', '0');
    await p.click('#btnStart'); await p.click('#btnPlay'); await p.waitForTimeout(1200); await p.keyboard.press('Space');
    console.log('   sim:', await p.$eval('#segInfo', e => e.textContent));
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
    console.log('   após 2x →:', await p.$eval('#segInfo', e => e.textContent));
    await p.screenshot({ path: out(`${mode}-sim.png`) });
    await p.click('#btnPaste'); await p.fill('#pasteTa', 'G0 X0 Y0\nG1 X10 F100\nG2 X20 Y0 I5 J0\nG1 Y-10'); await p.click('#pasteOk');
    await p.waitForFunction(() => S.text.indexOf('G2 X20 Y0 I5 J0') >= 0);
    console.log('   colado n =', await p.evaluate(() => S.M.n));
    await p.setInputFiles('#fileIn', fx('misc.nc'));
    await p.waitForFunction(() => S.file && S.file.name === 'misc.nc');
    console.log('   misc n =', await p.evaluate(() => S.M.n));
    console.log('   erros:', errs.length ? errs.join(' | ') : 'nenhum', '| errbar visível:', await p.$eval('#errbar', e => getComputedStyle(e).display));
    await p.close();
  }
  await b.close();
})();
