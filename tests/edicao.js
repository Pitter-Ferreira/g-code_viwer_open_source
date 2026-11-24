const { launch, devices, serve, fx, out, PAGE, PAGE_PATH } = require('./common');
(async () => {
  const b = await launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  p.on('dialog', d => { console.log('   [dialog]', d.type(), d.message().split('\n')[0]); d.accept(d.type()==='prompt' ? d.defaultValue() : undefined); });
  await p.addInitScript(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; });
  await p.goto(PAGE);
  await p.click('#empty button[data-act="cnc"]'); await p.waitForTimeout(700);
  const tab = await p.evaluate(() => ['Z','F','S'].map(L => L + ': ' + ED.groups[L].map(g => g.key.replace(/\.?0+$/,'') + '×' + g.count + (g.cut?'c':'') + (g.drill?'d':'') + (g.rapid?'r':'')).join(' ')).join('\n'));
  console.log(tab);
  // editar: Z -3 -> -3.5 ; F 900 -> 1200 ; S 12000 -> 15000 ; e somar -0.1 aos cortes? não
  await p.fill('#tabZ input[data-k="-3.0000"]', '-3,5');
  await p.fill('#tabF input[data-k="900.0000"]', '1200');
  await p.fill('#tabS input[data-k="12000.0000"]', '15000');
  await p.screenshot({ path: out('edit-before.png') });
  await p.click('#btnApply'); await p.waitForTimeout(800);
  const diff = await p.evaluate(() => { const a = S.history[0].split('\n'), b = S.text.split('\n'); const d = []; a.forEach((l, i) => { if (l !== b[i]) d.push(l + '  =>  ' + b[i]); }); return d; });
  console.log('linhas alteradas:', diff.length); diff.forEach(d => console.log('   ', d));
  console.log('nome:', await p.$eval('#fileName', e => e.textContent), '| undo habilitado:', await p.$eval('#btnUndo', e => !e.disabled));
  await p.screenshot({ path: out('edit-after.png') });
  // destacar nível
  await p.click('#tabZ .zv[data-v="-2"]'); await p.waitForTimeout(300);
  console.log('destaque:', await p.$eval('#layerLbl', e => e.textContent));
  await p.screenshot({ path: out('edit-level.png') });
  // percentual de avanço e deslocamento
  await p.fill('#fPct', '50'); await p.fill('#zShift', '-0,2'); await p.press('#zShift', 'Enter'); await p.waitForTimeout(800);
  const t2 = await p.evaluate(() => S.text.split('\n').filter(l => /Z-|F/.test(l)).slice(0, 8));
  console.log('após 50% e -0,2:', t2.join(' | '));
  console.log('Z grupos agora:', await p.evaluate(() => ED.groups.Z.map(g => g.key.replace(/\.?0+$/,'')).join(' ')));
  // desfazer 2x
  await p.click('#btnUndo'); await p.waitForTimeout(600); await p.click('#btnUndo'); await p.waitForTimeout(600);
  console.log('após desfazer tudo, igual ao original:', await p.evaluate(() => S.text === S.file.origText));
  // salvar (download) após uma edição
  await p.fill('#tabZ input[data-k="-1.0000"]', '-1.2'); await p.click('#btnApply'); await p.waitForTimeout(700);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btnSave')]);
  const path = await dl.path(); const fs = require('fs'); const saved = fs.readFileSync(path, 'utf8');
  console.log('download:', dl.suggestedFilename(), '| contém Z-1.2:', saved.includes('Z-1.2'), '| sujo depois de salvar:', await p.evaluate(() => isDirty()));
  // valor inválido
  await p.fill('#tabF input[data-k="300.0000"]', 'abc'); await p.click('#btnApply'); await p.waitForTimeout(200);
  console.log('inválido marcado:', await p.$eval('#tabF input[data-k="300.0000"]', e => e.className));
  console.log(errs.join('\n') || 'sem erros');
  await b.close();
})();
