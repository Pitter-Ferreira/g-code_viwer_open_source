const { launch, devices, serve, fx, out, PAGE, PAGE_PATH } = require('./common');
const OLD = `(function(){ var og = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(t, o){ if (/webgl/.test(t)) return null; return og.call(this, t, o); };
  window.PointerEvent = undefined; window.CSS = undefined; })();`;
(async () => {
  const b = await launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  for (const [mode, dark] of [['moderno', true], ['antigo', false]]) {
    const p = await b.newPage({ viewport: { width: 1400, height: 860 }, colorScheme: dark ? 'dark' : 'light' });
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    if (mode === 'antigo') await p.addInitScript(OLD);
    await p.addInitScript(() => { try { localStorage.setItem('gcv-files', '1'); } catch (e) {} });
    await p.goto(PAGE);
    console.log('[' + mode + '] botão:', await p.$eval('#btnPaste', e => e.textContent.trim()));
    await p.setInputFiles('#fileIn', fx('cores.tap')); await p.waitForTimeout(700);
    await p.click('#btnPaste'); await p.waitForTimeout(200);
    const r = await p.evaluate(() => { const d = document.getElementById('pasteDlg').getBoundingClientRect(), v = document.getElementById('vp').getBoundingClientRect(); return { dlg: [d.left, d.top, d.width, d.height].map(Math.round).join(','), vp: [v.left, v.top, v.width, v.height].map(Math.round).join(','), hl: document.getElementById('ed').classList.contains('hlon'), titulo: document.getElementById('pasteTitle').textContent }; });
    console.log('   editor:', JSON.stringify(r));
    // alinhamento: o texto colorido tem que ficar exatamente embaixo do texto real
    const al = await p.evaluate(() => { const ta = document.getElementById('pasteTa'); const hlLine = document.querySelector('#edHl .hl:nth-child(6)'); if (!hlLine) return 'sem realce'; const r1 = hlLine.getBoundingClientRect(); const tr = ta.getBoundingClientRect(); return { linha6_top: Math.round(r1.top - tr.top), esperado: 8 + 5*18, left: Math.round(r1.left - tr.left) }; });
    console.log('   alinhamento:', JSON.stringify(al));
    // digitar no fim da linha 6, rolar e conferir que a roda não dá zoom no desenho
    const scale0 = await p.evaluate(() => S.cam.scale);
    await p.click('#pasteTa'); await p.keyboard.press('Control+End'); await p.keyboard.type('\nG1 X10 Y10 Z-5 F800');
    await p.mouse.move(700, 400); await p.mouse.wheel(0, 200); await p.waitForTimeout(150);
    console.log('   zoom mudou com a roda no editor?', (await p.evaluate(() => S.cam.scale)) !== scale0, '| pos:', await p.$eval('#edPos', e => e.textContent));
    await p.screenshot({ path: out(`editor-${mode}.png`) });
    await p.keyboard.press('Control+Enter'); await p.waitForTimeout(800);
    console.log('   aplicado:', await p.evaluate(() => S.text.indexOf('G1 X10 Y10 Z-5 F800') >= 0), '| editor fechado:', await p.evaluate(() => !dlgOpen), '| sujo:', await p.evaluate(() => isDirty()));
    // duplo clique em modo medida não enquadra
    await p.click('#btnMeasure'); const yaw0 = await p.evaluate(() => S.cam.scale); await p.mouse.dblclick(600, 300); await p.waitForTimeout(400);
    console.log('   duplo clique na medida enquadrou?', (await p.evaluate(() => S.cam.scale)) !== yaw0);
    console.log('  ', errs.join(' | ') || 'sem erros');
    await p.close();
  }
  await b.close();
})();
