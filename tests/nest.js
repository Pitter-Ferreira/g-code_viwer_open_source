// Aproveitamento da chapa (nesting): lista de peças na esquerda, quantidades, várias chapas,
// girar ou não, peça maior que a chapa, "manter o desenho junto", moldura ignorada,
// um G-code por chapa e "melhorar aproveitamento". A conferência da geometria é independente
// do algoritmo: distância entre peças e margem medidas com o Clipper.
const { launch, fx, out, PAGE } = require('./common');
const fs = require('fs');
let fails = 0;
const check = (ok, msg, extra) => { console.log('   ' + (ok ? 'ok ' : 'FALHOU ') + msg + (extra !== undefined ? ' — ' + extra : '')); if (!ok){ fails++; process.exitCode = 1; } };
const idle = async p => { await p.waitForFunction(() => window.CAM && !CAM.busy(), null, { timeout: 120000 }); await p.waitForTimeout(80); };

// mede, em todas as chapas: menor distância entre contornos externos de peças diferentes,
// caminho da fresa dentro da margem, e quantas peças foram cortadas por fora
const MEASURE = `(function(){
  const K = CAM.state, cfg = CAM.cfg, CL = ClipperLib;
  const toCL = pts => pts.map(p => ({ X: Math.round(p[0]*100), Y: Math.round(p[1]*100) }));
  const grow = (pts, d) => { const co = new CL.ClipperOffset(2, 10); co.AddPath(toCL(pts), CL.JoinType.jtRound, CL.EndType.etClosedPolygon); const s = new CL.Paths(); co.Execute(s, d * 100); return s; };
  const gap = Math.max(cfg.nest.gap, 6.5);
  let overlaps = 0, outside = 0, outs = 0, parts = 0;
  K.sheets.forEach(sh => {
    const outer = sh.model.shapes.filter(s => s.closed && !s.off && s.eDepth === 0);
    parts += outer.length;
    for (let i = 0; i < outer.length; i++) for (let j = i + 1; j < outer.length; j++){
      if (outer[i].partKey === outer[j].partKey) continue;
      const c = new CL.Clipper(); c.AddPaths(grow(outer[i].pts, gap / 2 - 0.05), CL.PolyType.ptSubject, true); c.AddPaths(grow(outer[j].pts, gap / 2 - 0.05), CL.PolyType.ptClip, true);
      const sol = new CL.Paths(); c.Execute(CL.ClipType.ctIntersection, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
      if (sol.some(p => Math.abs(CL.Clipper.Area(p)) > 1)) overlaps++;
    }
    sh.plan.feats.forEach(f => {
      if (f.op === 'out') outs++;
      f.paths.forEach(p => p.pts.forEach(q => { if (q[0] < cfg.margin - 0.02 || q[1] < cfg.margin - 0.02 || q[0] > cfg.sheet.w - cfg.margin + 0.02 || q[1] > cfg.sheet.h - cfg.margin + 0.02) outside++; }));
    });
  });
  return { sheets: K.sheets.length, parts: parts, outs: outs, overlaps: overlaps, outside: outside,
    unplaced: K.nest ? K.nest.unplaced.length : -1, rots: K.nest ? K.nest.sheets.map(s => s.items.map(i => i.rot)).join('/') : '' };
})()`;

function dxfWithFrame(){
  const L = [], g = (c, v) => { L.push(String(c)); L.push(String(v)); };
  const lw = (ly, vs) => { g(0, 'LWPOLYLINE'); g(8, ly); g(90, vs.length); g(70, 1); vs.forEach(v => { g(10, v[0]); g(20, v[1]); }); };
  g(0, 'SECTION'); g(2, 'ENTITIES');
  lw('MOLDURA', [[0, 0], [600, 0], [600, 400], [0, 400]]);
  lw('CORTE', [[20, 20], [220, 20], [220, 120], [20, 120]]);
  lw('CORTE', [[60, 50], [100, 50], [100, 90], [60, 90]]);
  lw('CORTE', [[300, 50], [380, 50], [380, 200], [300, 200]]);
  g(0, 'ENDSEC'); g(0, 'EOF');
  return L.join('\n');
}

(async () => {
  const b = await launch();
  let p = await b.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  p.on('dialog', d => d.accept());
  await p.goto(PAGE);
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload();
  await p.click('#modeTabs button[data-m="cam"]');

  console.log('== Lista de peças e aproveitamento');
  await p.click('#camSample'); await idle(p);
  await p.setInputFiles('#camFileIn', [fx('cam/peca.dxf'), fx('cam/placa.svg')]); await p.waitForTimeout(300); await idle(p);
  const list = await p.$$eval('#camJobList .jf', fs => fs.map(f => f.querySelector('.jfh span').textContent + ':' + f.querySelectorAll('.jp[data-key]').length).join(' '));
  check(list === 'exemplo.dxf:2 peca.dxf:2 placa.svg:2', 'vários desenhos na lista da esquerda, com as peças de cada um', list);
  check(await p.isVisible('#camJob'), 'lista aparece na barra esquerda na aba Gerar G-code');
  await p.setInputFiles('#camFileIn', fx('cam/peca.dxf')); await p.waitForTimeout(300); await idle(p);
  check((await p.$$eval('#camJobList .jf', x => x.length)) === 3, 'o mesmo desenho não entra duas vezes');
  const plus = p.locator('#camJobList .jf:first-child .jp[data-key] .jq button[data-d="1"]').first();
  await plus.click(); await plus.click(); await p.waitForTimeout(300); await idle(p);
  check((await p.$eval('#camJobCount', e => e.textContent)) === '8 peças', 'quantidade 3 na primeira peça (total 8)');
  let m = await p.evaluate(MEASURE);
  check(m.parts === 8 && m.outs === 8 && m.unplaced === 0, 'as 8 peças foram encaixadas e recortadas por fora', JSON.stringify(m));
  check(m.overlaps === 0, 'nenhuma peça mais perto que a distância entre peças');
  check(m.outside === 0, 'caminho da fresa dentro da margem da chapa');
  const info = await p.$eval('#camNestInfo', e => e.innerText.replace(/\s+/g, ' '));
  check(/Chapas 1 Peças encaixadas 8 Aproveitamento chapa 1 \d+,\d%/.test(info), 'painel mostra chapas e aproveitamento', info);
  await p.screenshot({ path: out('nest-lista.png') });

  console.log('== Várias chapas');
  await p.fill('#camW', '500'); await p.fill('#camH', '400'); await p.waitForTimeout(300); await idle(p);
  m = await p.evaluate(MEASURE);
  check(m.sheets >= 2 && m.parts === 8 && m.overlaps === 0 && m.outside === 0, 'chapa pequena: peças divididas em várias chapas, sem encostar', JSON.stringify(m));
  check(!(await p.$eval('#camSheetNav', e => e.hidden)) && /Chapa 1 de \d/.test(await p.$eval('#camSheetLbl', e => e.textContent)), 'navegação entre chapas aparece');
  await p.click('#camNext'); await p.waitForTimeout(200);
  check(/Chapa 2 de/.test(await p.$eval('#camSheetLbl', e => e.textContent)), 'botão próxima chapa');
  await p.screenshot({ path: out('nest-chapa2.png') });
  const downloads = [];
  p.on('download', d => downloads.push(d));
  await p.click('#camSaveAll'); await p.waitForTimeout(400 * m.sheets + 1500);
  const names = downloads.map(d => d.suggestedFilename()).sort();
  check(names.length === m.sheets && names[0] === 'aproveitamento-chapa1.nc', 'salvar todas as chapas: um G-code por chapa', names.join(', '));
  const g2 = fs.readFileSync(await downloads[1].path(), 'utf8');
  check(g2.indexOf('(Chapa 2 de ' + m.sheets + ')') > 0 && g2.indexOf('M30') > 0, 'cabeçalho do G-code diz qual é a chapa');
  await p.click('#camGen'); await p.waitForTimeout(900);
  check(await p.evaluate(() => S.file && /^aproveitamento-chapa2\.nc$/.test(S.file.name) && S.M.n > 50), 'gerar e visualizar a chapa escolhida', await p.evaluate(() => S.file && S.file.name));
  await p.click('#modeTabs button[data-m="cam"]');

  console.log('== Girar, peça maior que a chapa');
  await p.selectOption('#camRot', '1'); await p.waitForTimeout(300); await idle(p);
  m = await p.evaluate(MEASURE);
  check(/^[0,\/]+$/.test(m.rots) && m.overlaps === 0, '"Não girar": todas as peças a 0°', m.rots);
  await p.selectOption('#camRot', '4');
  await p.fill('#camW', '250'); await p.fill('#camH', '150'); await p.waitForTimeout(300); await idle(p);
  const warn = await p.$eval('#camNestInfo', e => e.innerText);
  check(/Não couberam na chapa: exemplo\.dxf · peça 1 \(3×\)/.test(warn), 'avisa a peça maior que a chapa', warn.replace(/\s+/g, ' '));
  await p.fill('#camW', '1000'); await p.fill('#camH', '600'); await p.waitForTimeout(300); await idle(p);

  console.log('== Manter o desenho junto');
  const before = await p.evaluate(() => { const f = CAM.state.files[0]; const a = f.parts[0].outer, b = f.parts[1].outer; return Math.hypot((a.bb[0] + a.bb[2]) / 2 - (b.bb[0] + b.bb[2]) / 2, (a.bb[1] + a.bb[3]) / 2 - (b.bb[1] + b.bb[3]) / 2); });
  await p.check('#camJobList .jf:first-child .jkeep input'); await p.waitForTimeout(300); await idle(p);
  check((await p.$$eval('#camJobList .jf:first-child .jp[data-key] b', r => r.map(x => x.textContent).join())) === 'Desenho inteiro', 'lista mostra o desenho inteiro como uma peça');
  const after = await p.evaluate(() => {
    const keys = CAM.state.files[0].parts.map(x => x.outer.key), res = [];
    CAM.state.sheets.forEach(sh => sh.model.shapes.forEach(s => { if (keys.indexOf(s.key) >= 0 && s.closed && s.eDepth === 0) res.push(s); }));
    const a = res.filter(s => s.key === keys[0])[0], b = res.filter(s => s.key === keys[1])[0];
    const c = s => { let x = 0, y = 0; s.pts.forEach(q => { x += q[0]; y += q[1]; }); return [x / s.pts.length, y / s.pts.length]; };
    return a && b ? Math.hypot(c(a)[0] - c(b)[0], c(a)[1] - c(b)[1]) : -1;
  });
  const beforeC = await p.evaluate(() => { const f = CAM.state.files[0]; const c = s => { let x = 0, y = 0; s.pts.forEach(q => { x += q[0]; y += q[1]; }); return [x / s.pts.length, y / s.pts.length]; }; const a = c(f.parts[0].outer), b = c(f.parts[1].outer); return Math.hypot(a[0] - b[0], a[1] - b[1]); });
  check(Math.abs(after - beforeC) < 0.01, 'as peças do desenho continuam na mesma posição uma da outra', after.toFixed(3) + ' vs ' + beforeC.toFixed(3) + ' (antes ' + before.toFixed(1) + ')');
  m = await p.evaluate(MEASURE);
  check(m.overlaps === 0 && m.outside === 0, 'sem encostar com o desenho junto');
  await p.uncheck('#camJobList .jf:first-child .jkeep input'); await p.waitForTimeout(300); await idle(p);

  console.log('== Melhorar aproveitamento');
  const fit0 = await p.evaluate(() => CAM.state.nest.fitness);
  await p.click('#camImprove'); await p.waitForTimeout(500);
  check((await p.$eval('#camImprove', e => e.textContent)) === 'Parar', 'botão vira "Parar" enquanto melhora');
  await p.waitForTimeout(3000);
  await p.click('#camImprove'); await idle(p);
  const fit1 = await p.evaluate(() => CAM.state.nest.fitness);
  m = await p.evaluate(MEASURE);
  check(fit1 <= fit0 + 1e-6 && m.overlaps === 0 && m.parts === 8, 'resultado igual ou melhor, sem encostar', fit0.toFixed(1) + ' → ' + fit1.toFixed(1));

  console.log('== Moldura em volta do desenho');
  await p.click('#camClear'); await idle(p);
  check(await p.isVisible('#camEmpty'), 'limpar a lista');
  await p.evaluate(t => CAM.addDrawing(t, { name: 'moldura.dxf', handle: null, parent: null, path: null }), dxfWithFrame()); await idle(p);
  const fr = await p.evaluate(() => ({ parts: CAM.state.files[0].parts.length, op: CAM.state.layers.MOLDURA.op, ops: CAM.state.plan.feats.map(f => f.op).sort().join(',') }));
  check(fr.op === 'off' && fr.parts === 2 && fr.ops === 'in,out,out', 'camada MOLDURA ignorada sozinha: 2 peças por fora e o furo por dentro', JSON.stringify(fr));
  await p.close();

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
  await p.click('#camSample'); await idle(p);
  await p.locator('#camJobList .jp[data-key] .jq button[data-d="1"]').first().click(); await p.waitForTimeout(300); await idle(p);
  m = await p.evaluate(MEASURE.replace('Math.max(cfg.nest.gap, 6.5)', 'cfg.nest.gap'));
  check(m.parts === 3 && m.overlaps === 0, 'aproveitamento funciona no modo PC antigo', JSON.stringify(m));
  await p.close();

  await b.close();
  console.log(fails ? fails + ' verificação(ões) falharam' : 'tudo certo');
})();
