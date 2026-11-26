// Aba "Gerar G-code": DXF/SVG -> operações -> caminho da fresa -> G-code.
// Este teste confere a geometria de verdade (distância do caminho da fresa até o desenho),
// as pontes, profundidades, a ordem das fresas, o SVG, unidades, fresas, salvar na pasta e o modo PC antigo.
const { launch, serve, fx, out, PAGE, PAGE_PATH } = require('./common');
const fs = require('fs');
let fails = 0;
const check = (ok, msg, extra) => { console.log('   ' + (ok ? 'ok ' : 'FALHOU ') + msg + (extra !== undefined ? ' — ' + extra : '')); if (!ok){ fails++; process.exitCode = 1; } };

// distância de cada ponto do caminho até o contorno original (no navegador)
const GEOM = `(function(){
  const K = CAM.state, P = K.plan, C = CAMCore;
  function segDist(p, a, b){ const vx = b[0]-a[0], vy = b[1]-a[1], L = vx*vx+vy*vy; let t = L ? ((p[0]-a[0])*vx + (p[1]-a[1])*vy)/L : 0; t = Math.max(0, Math.min(1, t)); const x = a[0]+vx*t-p[0], y = a[1]+vy*t-p[1]; return Math.sqrt(x*x+y*y); }
  function dmin(p, pts){ let d = Infinity; for (let i = 0; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i], pts[(i+1) % pts.length])); return d; }
  return P.feats.map(f => {
    const r = f.tool.d / 2, src = f.shape.pts;
    let lo = Infinity, hi = 0, inside = true, n = 0;
    f.paths.forEach(p => p.pts.forEach(q => { const d = dmin(q, src); lo = Math.min(lo, d); hi = Math.max(hi, d); n++; if (!C.inside(q[0], q[1], src)) inside = false; }));
    return { op: f.op, r: r, lo: lo, hi: hi, inside: inside, n: n, tabs: f.paths[0].tabs ? f.paths[0].tabs.length : 0, depth: f.depth, tool: f.tool.id, through: f.through };
  });
})()`;

(async () => {
  const b = await launch();
  const srv = await serve(8767);

  /* ---------------- DXF ---------------- */
  console.log('== DXF (tests/fixtures/cam/peca.dxf)');
  let p = await b.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  p.on('dialog', d => d.accept());
  await p.goto(PAGE);
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload();
  await p.click('#modeTabs button[data-m="cam"]');
  check(await p.isVisible('#camEmpty'), 'aba Gerar G-code abre com o cartão vazio');
  await p.setInputFiles('#camFileIn', fx('cam/peca.dxf'));
  await p.waitForTimeout(600);
  const info = await p.$eval('#camInfo', e => e.innerText.replace(/\s+/g, ' '));
  check(/Tamanho 260 × 100 mm/.test(info), 'tamanho do desenho', info);
  check(/Peças 2/.test(info), 'linhas soltas viram peças fechadas (2 peças)', info);
  const layers = await p.$$eval('#camLayers .lrow', rs => rs.map(r => r.querySelector('b').textContent + '=' + r.querySelector('.lop').value + '/' + r.querySelector('.ltool').value));
  check(layers.join(' ') === 'CORTE=auto/t1 FURO=drill/t3 GRAVAR=engrave/t1 REBAIXO=pocket/t1', 'operação e fresa adivinhadas pelo nome da camada', layers.join(' '));
  await p.fill('#camLayers .lrow:nth-child(4) .ldep', '5');
  await p.selectOption('#camLayers .lrow:nth-child(3) .ltool', 't2');
  await p.waitForTimeout(400);
  let g = await p.evaluate(GEOM);
  const by = op => g.filter(f => f.op === op);
  by('out').forEach(f => check(Math.abs(f.lo - f.r) < 0.02 && Math.abs(f.hi - f.r) < 0.02, 'recorte por fora a 1 raio da peça (r=' + f.r + ')', 'min ' + f.lo.toFixed(4) + ' máx ' + f.hi.toFixed(4)));
  by('in').forEach(f => check(Math.abs(f.lo - f.r) < 0.02 && Math.abs(f.hi - f.r) < 0.02 && f.inside, 'recorte por dentro a 1 raio, por dentro do furo', 'min ' + f.lo.toFixed(4) + ' máx ' + f.hi.toFixed(4)));
  by('pocket').forEach(f => check(f.inside && f.lo >= f.r - 0.02 && f.depth === 5, 'rebaixo dentro da área, sem encostar na parede, prof. 5', 'menor distância ' + f.lo.toFixed(4)));
  check(by('drill').length === 2 && by('drill').every(f => f.tool === 't3' && f.through), 'furação com a broca, atravessando');
  check(by('engrave').length === 1 && by('engrave')[0].tool === 't2' && by('engrave')[0].depth === 1, 'gravação com a fresa 3 mm a 1 mm');
  check(by('out').map(f => f.tabs).sort().join(',') === '3,4', 'pontes: 4 na peça grande e 3 na pequena', by('out').map(f => f.tabs).join(','));
  const order = await p.evaluate(() => CAM.state.plan.feats.map(f => f.op).join(','));
  check(/^(drill|engrave|pocket)(,(drill|engrave|pocket))*,in,in,out,out$/.test(order), 'ordem: furos/gravação/rebaixo, depois recortes internos, por último os externos', order);
  const stats = await p.$eval('#camStats', e => e.innerText.replace(/\s+/g, ' '));
  check(/Fresas T3, T2, T1 \(2 trocas\)/.test(stats), 'menos trocas de fresa: T3 → T2 → T1', stats);
  await p.screenshot({ path: out('cam-dxf.png') });
  await p.click('#camGen'); await p.waitForTimeout(900);
  const vw = await p.evaluate(() => {
    const L = S.text.split('\n');
    let zmin = 1e9; L.forEach(l => { const m = /Z(-?[\d.]+)/.exec(l); if (m) zmin = Math.min(zmin, +m[1]); });
    return { tab: document.querySelector('#modeTabs .on').getAttribute('data-m'), name: S.file.name, n: S.M.n, zmin: zmin, tabLines: L.filter(l => /^G1 Z-13( |$)/.test(l)).length,
      m6: L.filter(l => / M6$/.test(l)).join(';'), first: L.slice(0, 3).join(' / '), last: L.slice(-4).join(' / ') };
  });
  check(vw.tab === 'view' && vw.name === 'peca.nc' && vw.n > 100, 'G-code aberto na aba Visualizar', vw.name + ', ' + vw.n + ' movimentos');
  check(Math.abs(vw.zmin + 15.3) < 1e-6, 'profundidade máxima = espessura + 0,3', vw.zmin);
  check(vw.tabLines === 7, 'sobe para Z-13 nas 7 pontes (deixa 2 mm)', vw.tabLines);
  check(vw.m6 === 'T2 M6;T3 M6;T1 M6' || vw.m6 === 'T3 M6;T2 M6;T1 M6', 'comandos de troca de fresa', vw.m6);
  check(/M5 \/ G0 X0 Y0 \/ M30/.test(vw.last), 'termina desligando o motor e voltando a X0 Y0', vw.last);
  await p.click('#modeTabs button[data-m="cam"]');

  /* ---------------- unidades ---------------- */
  await p.selectOption('#camUnit', 'cm'); await p.waitForTimeout(300);
  check(/Tamanho 2.600 × 1.000 mm|Tamanho 2600 × 1000 mm/.test(await p.$eval('#camInfo', e => e.innerText.replace(/\s+/g, ' '))), 'trocar a unidade para cm multiplica por 10');
  check((await p.$eval('#camWarn', e => e.innerText)).indexOf('passa da chapa') >= 0, 'avisa quando o desenho não cabe na chapa');
  await p.selectOption('#camUnit', 'auto'); await p.waitForTimeout(300);

  /* ---------------- fresas ---------------- */
  await p.click('#camToolNew'); await p.fill('#ctName', 'Fresa 4 mm'); await p.fill('#ctD', '4'); await p.waitForTimeout(400);
  check((await p.$$eval('#camLayers .lrow:first-child .ltool option', o => o.map(x => x.textContent))).indexOf('T4 Ø4 · Fresa 4 mm') >= 0, 'fresa nova aparece nas camadas');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#camToolExp')]);
  const exp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check(exp.fresas.length === 4 && exp.fresas[3].d === 4, 'exportar fresas', exp.fresas.length + ' fresas');
  await p.click('#camToolDel'); await p.waitForTimeout(300);
  check((await p.$$eval('#camToolList .trow', r => r.length)) === 3, 'excluir fresa');
  const tmp = out('fresas-teste.json'); fs.writeFileSync(tmp, JSON.stringify(exp));
  await p.setInputFiles('#camToolFile', tmp); await p.waitForTimeout(400);
  check((await p.$$eval('#camToolList .trow', r => r.length)) === 4, 'importar fresas');
  await p.reload(); await p.waitForTimeout(300);
  check(await p.evaluate(() => CAM.active() && CAM.tools().length === 4), 'fresas e aba ficam salvas ao reabrir a página');
  await p.close();

  /* ---------------- SVG ---------------- */
  console.log('== SVG (tests/fixtures/cam/placa.svg)');
  p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('dialog', d => d.accept());
  await p.goto(PAGE);
  await p.click('#modeTabs button[data-m="cam"]');
  await p.setInputFiles('#camFileIn', fx('cam/placa.svg'));
  await p.waitForTimeout(600);
  const sinfo = await p.$eval('#camInfo', e => e.innerText.replace(/\s+/g, ' '));
  check(/Tamanho 278,28 × 120 mm/.test(sinfo), 'tamanho do SVG em mm (viewBox + width em mm, grupo girado)', sinfo);
  check(/Peças 2/.test(sinfo) && /1 texto/.test(sinfo), 'peças e texto ignorado', sinfo);
  const sl = await p.$$eval('#camLayers .lrow b', r => r.map(x => x.textContent).join(' | '));
  check(sl === 'Cor #0000ff | Cor #00aa00 | Cor #ff0000 | Cor #ff00ff', 'grupos por cor (inclusive cor herdada no <use>)', sl);
  const sq = await p.evaluate(() => { const s = CAM.state.model.shapes.filter(x => x.closed && x.depth === 0 && x.area < 2000)[0]; return s ? [s.bb[0], s.bb[1], s.bb[2], s.bb[3]].map(v => v.toFixed(2)).join(',') : 'nada'; });
  check(sq === '231.72,111.72,288.28,168.28', 'quadrado girado 45° no lugar certo (Y invertido)', sq);
  const holes = await p.evaluate(() => CAM.state.model.shapes.filter(s => s.kind === 'circle').map(s => (s.r * 2).toFixed(2) + '@' + s.cx.toFixed(1) + ',' + s.cy.toFixed(1)).sort().join(' '));
  check(holes === '30.00@60.0,130.0 8.00@195.0,175.0 8.00@195.0,85.0', 'círculos (inclusive <use>) com centro e diâmetro', holes);
  await p.selectOption('#camLayers .lrow:nth-child(1) .lop', 'pocket');
  await p.selectOption('#camLayers .lrow:nth-child(4) .lop', 'drill');
  await p.waitForTimeout(400);
  g = await p.evaluate(GEOM);
  check(g.filter(f => f.op === 'pocket').length === 1 && g.filter(f => f.op === 'pocket')[0].inside, 'rebaixo no caminho com arco e curva');
  check(g.filter(f => f.op === 'out').every(f => Math.abs(f.lo - f.r) < 0.02 && Math.abs(f.hi - f.r) < 0.02), 'recorte por fora do SVG a 1 raio (cantos arredondados e girado)');
  check(g.filter(f => f.op === 'engrave').length === 1, 'gravação da curva aberta');
  await p.screenshot({ path: out('cam-svg.png') });
  // clicar numa linha e mudar só ela
  const pos = await p.evaluate(() => { const K = CAM.state, s = K.model.shapes.filter(x => x.kind === 'circle' && x.r > 10)[0]; return [K.v.ox + (s.cx + s.r + K.plan.dx) * K.v.s, K.v.oy - (s.cy + K.plan.dy) * K.v.s]; });
  const box = await p.$eval('#camCv', e => { const r = e.getBoundingClientRect(); return [r.left, r.top]; });
  await p.mouse.click(box[0] + pos[0], box[1] + pos[1]); await p.waitForTimeout(200);
  check(/Círculo Ø 30 mm/.test(await p.$eval('#camSel', e => e.innerText)), 'clicar seleciona o círculo');
  await p.selectOption('#camSelOp', 'off'); await p.waitForTimeout(400);
  check((await p.evaluate(GEOM)).filter(f => f.op === 'in').length === 0, 'ignorar só a linha selecionada');
  await p.keyboard.press('Escape');
  check(await p.$eval('#camSel', e => e.hidden), 'Esc fecha a seleção');
  await p.close();

  /* ---------------- salvar na pasta do desenho ---------------- */
  console.log('== Salvar na pasta (File System Access, Chrome/Edge)');
  p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('dialog', d => d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined));
  await p.goto('http://127.0.0.1:8767/');
  const dxf = fs.readFileSync(fx('cam/peca.dxf'), 'latin1');
  await p.evaluate(async dxf => {
    const root = await navigator.storage.getDirectory();
    for await (const k of root.keys()) await root.removeEntry(k, { recursive: true });
    const top = await root.getDirectoryHandle('Projetos', { create: true });
    const w = await (await top.getFileHandle('peca.dxf', { create: true })).createWritable(); await w.write(dxf); await w.close();
    window.showDirectoryPicker = async () => top;
  }, dxf);
  await p.click('#btnOpen'); await p.click('#menuOpen button[data-o="folder"]'); await p.waitForTimeout(500);
  check((await p.$$eval('#tree .tr.cad', r => r.map(x => x.textContent.trim()))).join() .indexOf('peca.dxf') >= 0, 'desenho aparece na árvore de arquivos');
  await p.click('#tree .tr.cad >> text=peca.dxf'); await p.waitForTimeout(700);
  check(await p.evaluate(() => CAM.active() && CAM.state.file.name === 'peca.dxf'), 'clicar no desenho abre na aba Gerar G-code');
  await p.click('#camSaveG'); await p.waitForTimeout(1200);
  const saved = await p.evaluate(async () => {
    const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('Projetos');
    try { const f = await (await top.getFileHandle('peca.nc')).getFile(); return await f.text(); } catch (e) { return ''; }
  });
  check(saved.indexOf('M30') > 0 && saved.indexOf('(Desenho: peca.dxf)') > 0, 'peca.nc gravado na mesma pasta do desenho', saved.length + ' bytes');
  check(await p.evaluate(() => !CAM.active() && S.file.name === 'peca.nc' && !!S.file.handle), 'G-code salvo abre no Visualizador ligado ao arquivo');
  check((await p.$$eval('#tree .tr', r => r.map(x => x.textContent.trim()).join('|'))).indexOf('peca.nc') >= 0, 'árvore atualizada com o peca.nc');
  await p.close();

  /* ---------------- PC antigo (sem WebGL, ResizeObserver, Object.assign...) ---------------- */
  console.log('== PC antigo (simulado)');
  p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('dialog', d => d.accept());
  await p.addInitScript(`(function(){
    var og = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(t, o){ if (t === 'webgl2' || t === 'webgl') return null; return og.call(this, t, o); };
    window.PointerEvent = undefined; window.ResizeObserver = undefined; window.showOpenFilePicker = undefined; window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined;
    Element.prototype.closest = undefined; String.prototype.includes = undefined; Array.prototype.includes = undefined; Array.prototype.find = undefined;
    String.prototype.startsWith = undefined; Math.hypot = undefined; Math.sign = undefined; Object.assign = undefined; Array.from = undefined; Number.isFinite = undefined;
  })();`);
  await p.goto(PAGE);
  await p.click('#modeTabs button[data-m="cam"]');
  await p.click('#camSample'); await p.waitForTimeout(600);
  check(await p.evaluate(() => CAM.state.plan && CAM.state.plan.feats.length > 5), 'exemplo calculado no modo PC antigo');
  await p.screenshot({ path: out('cam-antigo.png') });
  await p.click('#camGen'); await p.waitForTimeout(900);
  check(await p.evaluate(() => S.M && S.M.n > 100), 'G-code gerado e desenhado no modo compatível');
  await p.close();

  srv.close();
  await b.close();
  console.log(fails ? fails + ' verificação(ões) falharam' : 'tudo certo');
})();
