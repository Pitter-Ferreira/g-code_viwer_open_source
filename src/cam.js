'use strict';
/* =====================================================================
   INTERFACE DA ABA "GERAR G-CODE"
   Lista de desenhos (DXF/SVG) com peças e quantidades na barra esquerda,
   aproveitamento automático da chapa (CAMNest), operações por camada,
   biblioteca de fresas, prévia de cada chapa e G-code pronto para o Mach3.
   Usa as funções do visualizador ($, on, store, toast, loadText...), o CAMCore e o CAMNest.
   ===================================================================== */
window.CAM = (function () {
  const C = window.CAMCore, NEST = window.CAMNest;
  const VERSION = '__VERSION__';
  const app = document.querySelector('.app');
  const view = $('#camView'), cv = $('#camCv'), ctx = cv.getContext('2d');

  /* ---------- configurações (guardadas no navegador) ---------- */
  const DEF = {
    sheet: { w: 1000, h: 600, t: 15 }, margin: 10, place: 'nest', zRef: 'top', overcut: 0.3, safeZ: 10, dir: 'climb',
    tabs: { on: true, count: 4, width: 8, height: 2, inner: false }, nest: { gap: 10, rot: '4' },
    toolChange: 'm6', park: true, defaultTool: 't1'
  };
  const DEF_TOOLS = [
    { id: 't1', name: 'Fresa reta 6 mm', d: 6, s: 18000, f: 2000, fz: 600, step: 3, over: 45 },
    { id: 't2', name: 'Fresa reta 3 mm', d: 3, s: 18000, f: 1200, fz: 400, step: 1.5, over: 40 },
    { id: 't3', name: 'Broca 8 mm', d: 8, s: 12000, f: 800, fz: 400, step: 5, over: 40 }
  ];
  function readJSON(k, def){ try { const v = store(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function merge(def, v){
    const o = {};
    for (const k in def) if (Object.prototype.hasOwnProperty.call(def, k)){
      const d = def[k], x = v && v[k];
      o[k] = d && typeof d === 'object' ? merge(d, x) : (x === undefined || x === null || typeof x !== typeof d ? d : x);
    }
    return o;
  }
  const cfg = merge(DEF, readJSON('gcv-cam', {}));
  let tools = readJSON('gcv-fresas', null);
  if (!tools || !tools.length || typeof tools[0] !== 'object') tools = DEF_TOOLS.map(t => assign({}, t));
  const layerMem = readJSON('gcv-cam-camadas', {});
  const saveCfg = () => store('gcv-cam', JSON.stringify(cfg));
  const saveTools = () => store('gcv-fresas', JSON.stringify(tools));
  const saveLayers = () => store('gcv-cam-camadas', JSON.stringify(layerMem));

  const K = {
    mode: 'view', files: [], fsel: -1, nextId: 1, keyIdx: {}, layers: {}, ov: {}, qty: {}, keep: {}, sel: null, toolSel: 0,
    nesting: false, nest: null, nestItems: null, nestSig: '', nestId: 0, runner: null, improving: false, nestNote: '',
    sheets: [], sheet: 0, model: null, plan: null, stats: null, jobSig: '',
    v: { s: 1, ox: 0, oy: 0, w: 0, h: 0, fitted: false }, timer: 0, ttimer: 0
  };
  const UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4, px96: 25.4 / 96, px72: 25.4 / 72 };
  const OPS = [['auto', 'Automático'], ['out', 'Recorte por fora'], ['in', 'Recorte por dentro'], ['pocket', 'Rebaixo'], ['drill', 'Furação'], ['engrave', 'Gravar na linha'], ['off', 'Ignorar']];
  const OPNAME = {}; OPS.forEach(o => { OPNAME[o[0]] = o[1]; });
  const num = s => { const v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? v : NaN; };
  const nf = (v, d) => { const s = (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d).replace(/\.?0+$/, ''); return (s === '-0' ? '0' : s).replace('.', ','); };
  const getK = (o, path) => path.split('.').reduce((a, k) => a && a[k], o);
  const setK = (o, path, v) => { const p = path.split('.'), last = p.pop(); p.reduce((a, k) => a[k], o)[last] = v; };
  const baseName = n => { const i = (n || '').lastIndexOf('.'); return i > 0 ? n.slice(0, i) : (n || 'desenho'); };
  const toolById = id => { for (let i = 0; i < tools.length; i++) if (tools[i].id === id) return tools[i]; return null; };
  const hasCls = (el, c) => (' ' + el.className + ' ').indexOf(' ' + c + ' ') >= 0;
  function newToolId(){ let i = tools.length + 1; while (toolById('t' + i)) i++; return 't' + i; }
  const curFile = () => K.files[K.fsel] || null;

  /* ---------- trocar de aba ---------- */
  function setMode(m){
    K.mode = m;
    setCls(app, 'mode-cam', m === 'cam');
    showEl(view, m === 'cam');
    each(document.querySelectorAll('#modeTabs button'), b => setCls(b, 'on', b.getAttribute('data-m') === m));
    store('gcv-aba', m);
    closeMenus();
    if (m === 'cam'){ resize(); if (!K.v.fitted) fit(); draw(); }
    else { try { window.resize(); req(); } catch (e) {} }
  }
  each(document.querySelectorAll('#modeTabs button'), b => on(b, 'click', () => setMode(b.getAttribute('data-m'))));

  /* ---------- abrir desenhos (vários) ---------- */
  function openDialog(){
    if (typeof window.showOpenFilePicker === 'function'){
      window.showOpenFilePicker({ id: 'desenho', multiple: true, types: [{ description: 'Desenho DXF ou SVG', accept: { 'application/dxf': ['.dxf'], 'image/svg+xml': ['.svg'] } }] })
        .then(hs => { hs.forEach(h => h.getFile().then(f => openFile(f, { handle: h }))); })
        .catch(err => { if (!err || err.name !== 'AbortError') $('#camFileIn').click(); });
    } else $('#camFileIn').click();
  }
  on($('#camFileIn'), 'change', e => {
    const fs = e.target.files;
    if (fs) for (let i = 0; i < fs.length; i++) openFile(fs[i]);
    try { e.target.value = ''; } catch (err) {}
  });
  on($('#camOpenBtn'), 'click', openDialog);
  on($('#camAdd'), 'click', openDialog);
  function openFile(file, extra){
    if (file.size > 60 * 1048576 && !window.confirm('Desenho muito grande (' + Math.round(file.size / 1048576) + ' MB). Abrir mesmo assim?')) return;
    readFileText(file, (err, text) => {
      if (err){ toast('Não foi possível ler o desenho.'); return; }
      addDrawing(text, assign({ name: file.name, handle: null, parent: null, path: null }, extra || {}));
    });
  }
  function addDrawing(text, meta){
    setMode('cam');
    for (let i = 0; i < K.files.length; i++){
      const f = K.files[i];
      if ((meta.path && f.meta.path === meta.path) || (f.meta.name === meta.name && f.text === text)){
        K.fsel = i; renderJob(true); updateInfo(); toast(meta.name + ' já está na lista: mude a quantidade das peças.'); return f;
      }
    }
    let imp;
    try { imp = /\.svg$/i.test(meta.name) || /^\s*(<\?xml|<svg|<!DOCTYPE svg)/i.test(text) ? C.readSVG(text) : C.readDXF(text); }
    catch (e) { toast('Erro ao ler ' + meta.name + ': ' + (e && e.message || e)); return null; }
    const f = { id: 'f' + (K.nextId++), name: meta.name, meta: meta, text: text, imp: imp, unit: 'auto', model: null, parts: [], loose: [] };
    K.files.push(f);
    K.fsel = K.files.length - 1;
    buildFile(f);
    if (!f.model.shapes.length) toast('Nenhuma linha encontrada em ' + meta.name + '.');
    if (app.classList.contains('nofiles')){ setCls(app, 'nofiles', false); store('gcv-files', '1'); }
    showEl($('#camEmpty'), false);
    K.v.fitted = false;
    afterJobChange();
    return f;
  }
  function fileUnit(f){ return f.unit === 'auto' ? f.imp.unit : UNITS[f.unit] || 1; }
  function guessOp(label){
    const n = (label || '').toUpperCase();
    if (/FUR|DRILL|BROCA|HOLE/.test(n)) return 'drill';
    if (/REBAIX|POCKET|CAVA|ESVAZ/.test(n)) return 'pocket';
    if (/GRAV|ENGRAV|VINCO|MARCA|ESCRIT/.test(n)) return 'engrave';
    if (/COTA|DIM|TEXT|IGNOR|DEFPOINTS|MOLDURA|BORDA|CHAPA|FRAME/.test(n)) return 'off';
    if (/INTERN|DENTRO|INSIDE/.test(n)) return 'in';
    if (/EXTERN|FORA|OUTSIDE|CONTORNO|PERFIL/.test(n)) return 'out';
    return 'auto';
  }
  function drillTool(f, g){
    const ds = f.model.shapes.filter(s => s.group === g.key && s.kind === 'circle').map(s => s.r * 2).sort((a, b) => a - b);
    let best = null, bd = Infinity;
    tools.forEach(t => {
      const d = ds.length ? Math.abs(t.d - ds[Math.floor(ds.length / 2)]) : (/broca|drill/i.test(t.name) ? 0 : Infinity);
      if (d < bd){ bd = d; best = t; }
    });
    return best ? best.id : cfg.defaultTool;
  }
  function buildFile(f){
    f.model = C.buildModel(f.imp, fileUnit(f), { prefix: f.id });
    f.model.shapes.forEach(s => { K.keyIdx[s.key] = s; });
    f.model.groups.forEach(g => {
      if (K.layers[g.key]) return;
      const mem = layerMem[g.key];
      if (mem && toolById(mem.tool)) K.layers[g.key] = assign({}, mem);
      else { const op = guessOp(g.label); K.layers[g.key] = { op: op, tool: op === 'drill' ? drillTool(f, g) : cfg.defaultTool, depth: mem ? mem.depth : '' }; }
      if (!toolById(K.layers[g.key].tool)) K.layers[g.key].tool = tools[0].id;
    });
  }
  function removeFile(i){
    const f = K.files[i]; if (!f) return;
    K.files.splice(i, 1);
    f.model.shapes.forEach(s => { delete K.keyIdx[s.key]; delete K.ov[s.key]; });
    if (K.fsel >= K.files.length) K.fsel = K.files.length - 1;
    if (K.sel && !K.keyIdx[K.sel]) select(null);
    K.v.fitted = false;
    afterJobChange();
  }
  on($('#camClear'), 'click', () => {
    if (!K.files.length) return;
    if (!window.confirm('Tirar os ' + K.files.length + ' desenhos da lista?')) return;
    K.files = []; K.fsel = -1; K.keyIdx = {}; K.ov = {}; K.qty = {}; K.keep = {}; select(null);
    afterJobChange();
  });
  function afterJobChange(){
    renderLayers();
    updateInfo();
    showEl($('#camEmpty'), !K.files.length);
    replan(true);
  }

  /* ---------- painel Desenho (o desenho escolhido na lista) ---------- */
  function updateInfo(){
    const f = curFile();
    $('#camFileName').textContent = f ? f.name : '';
    showEl($('#camUnitRow'), !!f);
    if (!f){ $('#camInfo').innerHTML = '<div class="kv"><span class="k">Nenhum desenho aberto</span></div>'; return; }
    const M = f.model;
    const nClosed = M.shapes.filter(s => s.closed).length, nOpen = M.shapes.filter(s => !s.closed && s.kind !== 'point').length, nPt = M.shapes.filter(s => s.kind === 'point').length;
    const skipped = [];
    for (const k in M.skipped) if (Object.prototype.hasOwnProperty.call(M.skipped, k)) skipped.push(M.skipped[k] + ' ' + k);
    const w = isFinite(M.bb[0]) ? M.bb[2] - M.bb[0] : 0, h = isFinite(M.bb[0]) ? M.bb[3] - M.bb[1] : 0;
    const row = (k, v, t) => '<div class="kv"' + (t ? ' title="' + esc(t) + '"' : '') + '><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
    $('#camInfo').innerHTML =
      row('Tamanho', '<b>' + nf(w, 2) + ' × ' + nf(h, 2) + ' mm</b>', 'Se o tamanho estiver errado, troque a unidade do desenho abaixo') +
      row('Peças', fmtInt(f.parts.length || M.nParts)) +
      row('Contornos fechados', fmtInt(nClosed)) +
      (nOpen ? row('Linhas abertas', fmtInt(nOpen)) : '') +
      (nPt ? row('Pontos', fmtInt(nPt)) : '') +
      row('Unidade', f.unit === 'auto' ? (f.imp.unitNote || '') : $('#camUnit').options[$('#camUnit').selectedIndex].text) +
      (skipped.length ? row('Ignorado', esc(skipped.join(', ')), 'Textos, cotas e hachuras não viram caminho de fresa') : '');
    $('#camUnit').value = f.unit;
  }
  on($('#camUnit'), 'change', e => {
    const f = curFile(); if (!f) return;
    f.model.shapes.forEach(s => { delete K.keyIdx[s.key]; });
    f.unit = e.target.value; buildFile(f); K.v.fitted = false; afterJobChange();
  });

  /* ---------- lista de peças (barra esquerda) ---------- */
  const qtyOf = k => (K.qty[k] === undefined ? 1 : K.qty[k]);
  function jobStructure(){
    return K.fsel + '|' + K.files.map(f => f.id + (K.keep[f.id] ? 'J' : '') + ':' + f.parts.map(p => p.outer.key).join(',') + ':' + f.loose.length).join(';');
  }
  function renderJob(force){
    const sig = jobStructure();
    if (!force && sig === K.jobSig) return;
    K.jobSig = sig;
    const el = $('#camJobList');
    let total = 0;
    if (!K.files.length){ el.innerHTML = '<div class="tempty">Nenhum desenho ainda.<br>Clique em <b>+</b> ou arraste arquivos DXF/SVG para a janela.</div>'; $('#camJobCount').textContent = ''; return; }
    let html = '';
    const prow = (key, name, w, h) => {
      const q = qtyOf(key); total += q;
      return '<div class="jp' + (q ? '' : ' zero') + (K.sel === key ? ' on' : '') + '" data-key="' + esc(key) + '"><canvas width="88" height="60"></canvas>' +
        '<div class="jn"><b>' + esc(name) + '</b><small>' + nf(w, 1) + ' × ' + nf(h, 1) + ' mm</small></div>' +
        '<div class="jq"><button data-d="-1" title="Menos uma">−</button><input type="text" inputmode="numeric" value="' + q + '" title="Quantidade"><button data-d="1" title="Mais uma">+</button></div></div>';
    };
    K.files.forEach((f, fi) => {
      html += '<div class="jf' + (fi === K.fsel ? ' on' : '') + '" data-f="' + fi + '"><div class="jfh" title="' + esc(f.name) + '"><span>' + esc(f.name) + '</span><button class="x" data-rm="' + fi + '" title="Tirar da lista">×</button></div>';
      if (f.parts.length > 1 || f.loose.length) html += '<label class="jkeep" title="Para placas e letreiros: o desenho inteiro é encaixado como uma peça só, sem separar"><input type="checkbox" data-keep="' + fi + '"' + (K.keep[f.id] ? ' checked' : '') + '><span>Manter o desenho junto</span></label>';
      if (K.keep[f.id]){ const b = f.model.bb; html += prow('file:' + f.id, 'Desenho inteiro', b[2] - b[0], b[3] - b[1]); }
      else if (!f.parts.length) html += '<div class="jp" style="cursor:default"><div class="jn"><small>Nenhuma peça fechada' + (f.loose.length ? ' (marque “Manter o desenho junto” para cortar as linhas soltas)' : '') + '</small></div></div>';
      else f.parts.forEach((p, pi) => { html += prow(p.outer.key, 'Peça ' + (pi + 1), p.bb[2] - p.bb[0], p.bb[3] - p.bb[1]); });
      html += '</div>';
    });
    el.innerHTML = html;
    $('#camJobCount').textContent = '';
    each(el.querySelectorAll('.jp[data-key]'), row => drawThumb(row.querySelector('canvas'), row.getAttribute('data-key')));
    updateJobCount();
  }
  function updateJobCount(){
    let n = 0;
    K.files.forEach(f => { if (K.keep[f.id]) n += qtyOf('file:' + f.id); else f.parts.forEach(p => { n += qtyOf(p.outer.key); }); });
    $('#camJobCount').textContent = K.files.length ? n + (n === 1 ? ' peça' : ' peças') : '';
  }
  function membersOfKey(key){
    if (key.indexOf('file:') === 0){
      const id = key.slice(5);
      for (let i = 0; i < K.files.length; i++) if (K.files[i].id === id){ const f = K.files[i]; let m = []; f.parts.forEach(p => { m = m.concat(p.members); }); return m.concat(f.loose); }
      return [];
    }
    for (let i = 0; i < K.files.length; i++){ const ps = K.files[i].parts; for (let j = 0; j < ps.length; j++) if (ps[j].outer.key === key) return ps[j].members; }
    return [];
  }
  function drawThumb(c, key){
    if (!c || !c.getContext) return;
    const g = c.getContext('2d'), ms = membersOfKey(key);
    const b = C.bboxOf([]); ms.forEach(s => C.bboxOf(s.pts, b));
    g.clearRect(0, 0, c.width, c.height);
    if (!isFinite(b[0])) return;
    const s = Math.min((c.width - 8) / Math.max(b[2] - b[0], 1e-6), (c.height - 8) / Math.max(b[3] - b[1], 1e-6));
    const ox = (c.width - (b[2] - b[0]) * s) / 2, oy = (c.height + (b[3] - b[1]) * s) / 2;
    g.lineWidth = 1.5; g.strokeStyle = col('c-feed', '#0369a1'); g.fillStyle = 'rgba(37,99,235,.10)';
    ms.forEach(m => {
      if (m.kind === 'point') return;
      g.beginPath();
      m.pts.forEach((p, i) => { const x = ox + (p[0] - b[0]) * s, y = oy - (p[1] - b[1]) * s; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      if (m.closed){ g.closePath(); if (m === ms[0]) g.fill(); }
      g.stroke();
    });
  }
  on($('#camJobList'), 'click', e => {
    const rm = closest(e.target, '[data-rm]');
    if (rm){ e.stopPropagation(); removeFile(+rm.getAttribute('data-rm')); return; }
    const d = closest(e.target, '.jq button');
    const row = closest(e.target, '.jp[data-key]');
    if (d && row){
      const k = row.getAttribute('data-key'), q = Math.max(0, Math.min(999, qtyOf(k) + +d.getAttribute('data-d')));
      K.qty[k] = q; row.querySelector('input').value = q; setCls(row, 'zero', !q); updateJobCount(); replan();
      return;
    }
    if (closest(e.target, '.jq') || closest(e.target, '.jkeep')) return;
    const fb = closest(e.target, '.jf');
    if (fb){
      const fi = +fb.getAttribute('data-f');
      if (fi !== K.fsel){ K.fsel = fi; each($('#camJobList').querySelectorAll('.jf'), x => setCls(x, 'on', +x.getAttribute('data-f') === fi)); updateInfo(); }
    }
    if (row){ const k = row.getAttribute('data-key'); select(k.indexOf('file:') === 0 ? null : k); }
  });
  on($('#camJobList'), 'input', e => {
    const row = closest(e.target, '.jp[data-key]'); if (!row || e.target.tagName.toLowerCase() !== 'input') return;
    const v = parseInt(e.target.value, 10), bad = !(v >= 0 && v <= 999);
    setCls(e.target, 'bad', bad); if (bad) return;
    K.qty[row.getAttribute('data-key')] = v; setCls(row, 'zero', !v); updateJobCount(); replan();
  });
  on($('#camJobList'), 'change', e => {
    const k = e.target.getAttribute && e.target.getAttribute('data-keep');
    if (k === null || k === undefined) return;
    const f = K.files[+k]; if (!f) return;
    K.keep[f.id] = e.target.checked; replan(true);
  });

  /* ---------- operações por camada (todas as camadas de todos os desenhos) ---------- */
  function allGroups(){
    const list = [], idx = {};
    K.files.forEach(f => f.model.groups.forEach(g => {
      let x = idx[g.key];
      if (!x){ x = idx[g.key] = { key: g.key, label: g.label, color: g.color, nClosed: 0, nOpen: 0, nPoint: 0 }; list.push(x); }
      x.nClosed += g.nClosed; x.nOpen += g.nOpen; x.nPoint += g.nPoint;
    }));
    list.sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
    return list;
  }
  function toolOptions(sel){
    return tools.map((t, i) => '<option value="' + esc(t.id) + '"' + (t.id === sel ? ' selected' : '') + '>T' + (i + 1) + ' Ø' + nf(t.d, 3) + ' · ' + esc(t.name) + '</option>').join('');
  }
  function depthPh(op){ return op === 'pocket' ? '3' : op === 'engrave' ? '1' : op === 'off' ? '' : 'atravessar'; }
  function renderLayers(){
    const el = $('#camLayers'), gs = allGroups();
    K.groups = gs;
    if (!gs.length){ el.innerHTML = '<div class="note" style="margin-left:0">Abra um desenho para escolher as operações.</div>'; return; }
    let html = '';
    gs.forEach((g, i) => {
      const L = K.layers[g.key];
      const what = [];
      if (g.nClosed) what.push(g.nClosed + (g.nClosed > 1 ? ' contornos' : ' contorno'));
      if (g.nOpen) what.push(g.nOpen + (g.nOpen > 1 ? ' linhas' : ' linha'));
      if (g.nPoint) what.push(g.nPoint + (g.nPoint > 1 ? ' pontos' : ' ponto'));
      const dc = g.color === '#ffffff' || g.color === '#000000' ? 'var(--text)' : esc(g.color);
      html += '<div class="lrow" data-i="' + i + '"><div class="lhead"><span class="dot" style="background:' + dc + '"></span><b title="' + esc(g.label) + '">' + esc(g.label) + '</b><small>' + what.join(', ') + '</small></div>' +
        '<div class="lctl"><select class="lop" title="Operação">' + OPS.map(o => '<option value="' + o[0] + '"' + (o[0] === L.op ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
        '<select class="ltool" title="Fresa">' + toolOptions(L.tool) + '</select>' +
        '<input type="text" class="ldep" title="Profundidade em mm (vazio = ' + depthPh(L.op) + ')" placeholder="' + depthPh(L.op) + '" value="' + esc(String(L.depth === undefined ? '' : L.depth).replace('.', ',')) + '"></div></div>';
    });
    el.innerHTML = html;
  }
  function layerChanged(e){
    const row = closest(e.target, '.lrow'); if (!row || !K.groups) return;
    const g = K.groups[+row.getAttribute('data-i')], L = K.layers[g.key];
    if (hasCls(e.target, 'lop')){ L.op = e.target.value; const inp = row.querySelector('.ldep'); inp.placeholder = depthPh(L.op); inp.title = 'Profundidade em mm (vazio = ' + depthPh(L.op) + ')'; }
    else if (hasCls(e.target, 'ltool')) L.tool = e.target.value;
    else if (hasCls(e.target, 'ldep')){
      const raw = e.target.value.replace(/^\s+|\s+$/g, ''), v = num(raw);
      const bad = raw !== '' && !(v > 0);
      setCls(e.target, 'bad', bad);
      if (bad) return;
      L.depth = raw === '' ? '' : v;
    }
    layerMem[g.key] = assign({}, L); saveLayers();
    replan();
  }
  on($('#camLayers'), 'change', layerChanged);
  on($('#camLayers'), 'input', e => { if (hasCls(e.target, 'ldep')) layerChanged(e); });

  /* ---------- chapa, máquina, pontes e aproveitamento ---------- */
  const PANELS = '#camSheetPanel, #camTabsPanel, #camNestPanel';
  function fillSettings(){
    each(document.querySelectorAll('#camSheetPanel [data-k], #camTabsPanel [data-k], #camNestPanel [data-k]'), el => {
      const v = getK(cfg, el.getAttribute('data-k'));
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.tagName.toLowerCase() === 'select') el.value = v;
      else el.value = String(v).replace('.', ',');
    });
  }
  function settingChanged(e){
    const el = e.target, k = el.getAttribute('data-k'); if (!k) return;
    if (el.type === 'checkbox') setK(cfg, k, el.checked);
    else if (el.tagName.toLowerCase() === 'select') setK(cfg, k, el.value);
    else {
      const v = num(el.value);
      const min = k === 'margin' || k === 'overcut' || k === 'nest.gap' ? 0 : k === 'tabs.count' ? 1 : 0.001;
      const bad = !(v >= min) || (k === 'tabs.height' && v >= cfg.sheet.t);
      setCls(el, 'bad', bad);
      if (bad) return;
      setK(cfg, k, k === 'tabs.count' ? Math.round(v) : v);
    }
    saveCfg();
    if (k.indexOf('sheet.') === 0) K.v.fitted = false;
    replan();
  }
  each(document.querySelectorAll(PANELS), p => { on(p, 'change', settingChanged); on(p, 'input', e => { if (e.target.type === 'text') settingChanged(e); }); });

  /* ---------- biblioteca de fresas ---------- */
  function renderTools(){
    if (K.toolSel >= tools.length) K.toolSel = tools.length - 1;
    $('#camToolList').innerHTML = tools.map((t, i) => '<div class="trow' + (i === K.toolSel ? ' on' : '') + '" data-i="' + i + '"><b>T' + (i + 1) + '</b><span>' + esc(t.name) + '</span><small>Ø ' + nf(t.d, 3) + '</small></div>').join('');
    $('#camToolCount').textContent = tools.length + (tools.length > 1 ? ' fresas' : ' fresa');
    const t = tools[K.toolSel];
    each(document.querySelectorAll('#camToolForm [data-t]'), el => { const k = el.getAttribute('data-t'); el.value = k === 'name' ? t[k] : String(t[k]).replace('.', ','); setCls(el, 'bad', false); });
    $('#camToolDel').disabled = tools.length < 2;
  }
  function toolsChanged(){
    saveTools();
    each(document.querySelectorAll('#camLayers .ltool'), sel => { const v = sel.value; sel.innerHTML = toolOptions(toolById(v) ? v : tools[0].id); });
    for (const k in K.layers) if (Object.prototype.hasOwnProperty.call(K.layers, k) && !toolById(K.layers[k].tool)) K.layers[k].tool = tools[0].id;
    if (!toolById(cfg.defaultTool)){ cfg.defaultTool = tools[0].id; saveCfg(); }
    replan();
  }
  on($('#camToolList'), 'click', e => { const r = closest(e.target, '.trow'); if (!r) return; K.toolSel = +r.getAttribute('data-i'); renderTools(); });
  on($('#camToolForm'), 'input', e => {
    const el = e.target, k = el.getAttribute('data-t'); if (!k) return;
    const t = tools[K.toolSel];
    if (k === 'name'){ t.name = el.value || 'Fresa'; }
    else {
      const v = num(el.value);
      const bad = !(v > 0) || (k === 'over' && v > 95);
      setCls(el, 'bad', bad);
      if (bad) return;
      t[k] = v;
    }
    const row = $('#camToolList').children[K.toolSel];
    if (row) row.innerHTML = '<b>T' + (K.toolSel + 1) + '</b><span>' + esc(t.name) + '</span><small>Ø ' + nf(t.d, 3) + '</small>';
    clearTimeout(K.ttimer); K.ttimer = setTimeout(toolsChanged, 250);
  });
  on($('#camToolNew'), 'click', () => { tools.push({ id: newToolId(), name: 'Fresa nova', d: 6, s: 18000, f: 1500, fz: 500, step: 2, over: 40 }); K.toolSel = tools.length - 1; renderTools(); toolsChanged(); $('#ctName').focus(); });
  on($('#camToolDup'), 'click', () => { const t = assign({}, tools[K.toolSel]); t.id = newToolId(); t.name += ' (cópia)'; tools.splice(K.toolSel + 1, 0, t); K.toolSel++; renderTools(); toolsChanged(); });
  on($('#camToolDel'), 'click', () => {
    if (tools.length < 2) return;
    if (!window.confirm('Excluir a fresa "' + tools[K.toolSel].name + '"?')) return;
    tools.splice(K.toolSel, 1); renderTools(); toolsChanged();
  });
  on($('#camToolExp'), 'click', () => downloadBlob(new Blob([JSON.stringify({ tipo: 'fresas-g-code-viewer', fresas: tools }, null, 2)], { type: 'application/json' }), 'fresas.json'));
  on($('#camToolImp'), 'click', () => $('#camToolFile').click());
  on($('#camToolFile'), 'change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    readFileText(f, (err, text) => {
      try { e.target.value = ''; } catch (x) {}
      let list = null;
      try { const j = JSON.parse(text); list = j && j.fresas ? j.fresas : j; } catch (x) {}
      if (!list || !list.length || typeof list[0] !== 'object'){ toast('Arquivo de fresas inválido.'); return; }
      const ok = [];
      list.forEach(t => { if (t && t.d > 0 && t.f > 0) ok.push({ id: String(t.id || ''), name: String(t.name || 'Fresa'), d: +t.d, s: +t.s || 18000, f: +t.f, fz: +t.fz || +t.f / 3, step: +t.step || +t.d / 2, over: +t.over || 40 }); });
      if (!ok.length){ toast('Nenhuma fresa válida no arquivo.'); return; }
      if (!window.confirm('Substituir as ' + tools.length + ' fresas atuais pelas ' + ok.length + ' do arquivo?')) return;
      const seen = {};
      ok.forEach((t, i) => { if (!t.id || seen[t.id]) t.id = 't' + (i + 1) + 'i'; seen[t.id] = 1; });
      tools = ok; K.toolSel = 0; renderTools(); toolsChanged(); toast(ok.length + ' fresas importadas.');
    });
  });

  /* ---------- cálculo: peças -> aproveitamento -> chapas -> caminho da fresa ---------- */
  function fullCfg(){ return assign(assign({}, cfg), { layers: K.layers, overrides: K.ov, rapid: (S && S.rapid) || 3000 }); }
  function replan(now){
    clearTimeout(K.timer);
    if (now){ K.pending = false; compute(); }
    else { K.pending = true; K.timer = setTimeout(() => { K.pending = false; compute(); }, 150); }
  }
  function usedToolMax(){ // maior fresa usada nas camadas que têm alguma linha
    let d = 0;
    (K.groups || []).forEach(g => { const L = K.layers[g.key], t = L && L.op !== 'off' && toolById(L.tool); if (t && t.d > d) d = t.d; });
    return d || (toolById(cfg.defaultTool) || tools[0]).d;
  }
  function compute(){
    const cf = fullCfg();
    if (!K.files.length){ stopNest(); K.nest = null; K.sheets = []; K.nesting = false; renderJob(); finishSheets(); return; }
    K.files.forEach(f => { const r = C.partsOf(f.model, cf); f.parts = r.parts; f.loose = r.loose; });
    renderJob();
    updateInfo();
    let multi = K.files.length > 1;
    K.files.forEach(f => {
      if (K.keep[f.id]){ if (qtyOf('file:' + f.id) !== 1) multi = true; }
      else f.parts.forEach(p => { if (qtyOf(p.outer.key) !== 1) multi = true; });
    });
    K.nesting = cfg.place === 'nest' || multi;
    K.nestNote = cfg.place !== 'nest' && multi ? 'Com mais de um desenho ou quantidade diferente de 1, as peças são encaixadas automaticamente.' : '';
    if (!K.nesting){
      stopNest(); K.nest = null;
      const f = K.files[0];
      let plan = null;
      try { plan = C.plan(f.model, cf, tools); } catch (e) { toast('Erro ao calcular o caminho: ' + (e && e.message || e)); if (window.console) console.error(e); }
      K.sheets = plan ? [{ model: f.model, plan: plan }] : [];
      finishSheets();
      return;
    }
    // itens do aproveitamento
    const items = [], loose = [];
    K.files.forEach(f => {
      if (K.keep[f.id]){
        let members = []; f.parts.forEach(p => { members = members.concat(p.members); }); members = members.concat(f.loose);
        const polys = []; members.forEach(m => { if (m.pts.length) polys.push(m.pts); });
        let a = 0; f.parts.forEach(p => { a += p.area; });
        if (polys.length) items.push({ key: 'file:' + f.id, file: f, name: f.name, polys: polys, area: a, qty: qtyOf('file:' + f.id), members: members, sig: f.id + 'J' + f.unit });
      } else {
        if (f.loose.length) loose.push(f.name);
        f.parts.forEach((p, pi) => items.push({ key: p.outer.key, file: f, name: f.name + ' · peça ' + (pi + 1), polys: [p.outer.pts], area: p.area, qty: qtyOf(p.outer.key), members: p.members, sig: p.outer.key + f.unit }));
      }
    });
    K.looseNote = loose.length ? 'Linhas soltas (fora de qualquer peça) de ' + loose.join(', ') + ' ficaram de fora. Para cortar junto, marque “Manter o desenho junto”.' : '';
    const D = usedToolMax(), r = D / 2;
    let gap = cfg.nest.gap;
    K.gapNote = '';
    if (!(gap >= D + 0.5)){ K.gapNote = 'A distância entre peças precisa ser maior que a fresa (Ø ' + nf(D, 2) + '): usei ' + nf(D + 0.5, 2) + ' mm.'; gap = D + 0.5; }
    const m = cfg.margin + r - gap / 2;
    const geo = { gap: gap, bin: [m, m, cfg.sheet.w - m, cfg.sheet.h - m], rots: cfg.nest.rot === '1' ? [0] : cfg.nest.rot === '2' ? [0, 180] : [0, 90, 180, 270] };
    const sig = JSON.stringify([items.map(it => it.sig + 'x' + it.qty), geo]);
    if (sig !== K.nestSig || !K.nest){ startNest(items, geo, sig, 0); }
    else { K.nestItems = items; buildSheets(); }
  }
  function stopNest(){ K.nestId++; if (K.runner){ const r = K.runner; K.runner = null; r.stop(); } K.improving = false; setBusy(''); updateImproveBtn(); }
  function startNest(items, geo, sig, improveMs){
    stopNest();
    const id = K.nestId, total = items.reduce((a, it) => a + it.qty, 0);
    if (!total){ K.nest = { sheets: [], unplaced: [], fitness: 0 }; K.nestItems = items; K.nestSig = sig; buildSheets(); return; }
    let N;
    try { N = new NEST.Nester(items.map(it => ({ polys: it.polys, area: it.area, qty: it.qty })), { bin: geo.bin, gap: geo.gap, rots: geo.rots, tol: 0.15 }); }
    catch (e) { toast('Erro no aproveitamento: ' + (e && e.message || e)); if (window.console) console.error(e); return; }
    K.improving = improveMs > 0;
    setBusy(K.improving ? 'Melhorando o aproveitamento…' : 'Encaixando ' + total + (total > 1 ? ' peças…' : ' peça…'));
    updateImproveBtn();
    const bar = $('#camNestBar');
    showEl(bar, K.improving);
    const startFit = K.nest ? K.nest.fitness : Infinity;
    K.runner = N.run(improveMs, (best, evals, frac) => {
      if (id !== K.nestId) return;
      bar.firstChild.style.width = Math.round(frac * 100) + '%';
      if (K.improving) setBusy('Melhorando… ' + evals + (evals > 1 ? ' tentativas' : ' tentativa'));
    }, best => {
      if (id !== K.nestId) return;
      K.runner = null;
      const wasImproving = K.improving;
      K.improving = false; showEl(bar, false); setBusy(''); updateImproveBtn();
      if (wasImproving && K.nest && K.nestSig === sig && !(best.fitness < startFit - 1e-9)){ toast('Não achei um encaixe melhor que o atual.'); return; }
      K.nest = best; K.nestItems = items; K.nestSig = sig;
      if (wasImproving) toast('Aproveitamento melhorado.');
      buildSheets();
    });
  }
  function buildSheets(){
    const cf = fullCfg(), asis = assign(assign({}, cf), { place: 'asis' });
    const items = K.nestItems;
    K.sheets = K.nest.sheets.map(sh => {
      const shapes = [];
      sh.items.forEach(pl => {
        const it = items[pl.item]; if (!it) return;
        const a = pl.rot * Math.PI / 180, c = Math.round(Math.cos(a) * 1e12) / 1e12, s = Math.round(Math.sin(a) * 1e12) / 1e12;
        const T = p => [p[0] * c - p[1] * s + pl.x, p[0] * s + p[1] * c + pl.y];
        it.members.forEach(mb => {
          const o = { pts: mb.pts.map(T), closed: mb.closed, layer: mb.layer, color: mb.color, kind: mb.kind, group: mb.group, label: mb.label, key: mb.key, partKey: it.key + '#' + pl.copy };
          if (mb.kind === 'circle'){ const q = T([mb.cx, mb.cy]); o.cx = q[0]; o.cy = q[1]; o.r = mb.r; }
          shapes.push(o);
        });
      });
      const model = C.buildModel({ shapes: shapes, skipped: {} }, 1, { keepGroups: true });
      let plan = null;
      try { plan = C.plan(model, asis, tools); } catch (e) { if (window.console) console.error(e); }
      return { model: model, plan: plan, nest: sh };
    }).filter(x => x.plan);
    finishSheets();
  }
  function finishSheets(){
    if (K.sheet >= K.sheets.length) K.sheet = Math.max(0, K.sheets.length - 1);
    const sh = K.sheets[K.sheet];
    K.model = sh ? sh.model : null; K.plan = sh ? sh.plan : null;
    K.stats = null;
    if (K.plan && K.plan.feats.length){ try { K.stats = C.gcode(K.plan, fullCfg(), tools, { name: jobFiles(), version: VERSION }); } catch (e) { if (window.console) console.error(e); } }
    updateGen();
    updateNest();
    if (!K.v.fitted && K.sheets.length) fit(); else draw();
  }
  function setBusy(t){ const b = $('#camBusy'); b.textContent = t; showEl(b, !!t); }
  function updateImproveBtn(){
    const b = $('#camImprove');
    b.textContent = K.improving ? 'Parar' : 'Melhorar aproveitamento';
    b.disabled = !K.nesting || (!K.improving && !!K.runner) || !K.nest || !(K.nestItems && K.nestItems.length);
  }
  on($('#camImprove'), 'click', () => {
    if (K.improving){ const r = K.runner; if (r) r.stop(); return; }
    if (!K.nestItems || !K.nest) return;
    const cfgNow = K.nestSig;
    try { const p = JSON.parse(cfgNow); startNest(K.nestItems, p[1], cfgNow, 20000); } catch (e) {}
  });
  function updateNest(){
    const el = $('#camNestInfo');
    const row = (k, v) => '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
    const notes = [K.nestNote, K.gapNote, K.looseNote].filter(Boolean);
    $('#camNestNote').innerHTML = notes.map(esc).join('<br>');
    showEl($('#camNestNote'), notes.length > 0 && K.nesting);
    updateImproveBtn();
    if (!K.nesting || !K.nest){ el.innerHTML = K.nesting && K.runner ? row('Encaixando…', '') : ''; updateSheetNav(); return; }
    const A = cfg.sheet.w * cfg.sheet.h, ns = K.nest.sheets.length;
    let placed = 0; K.nest.sheets.forEach(s => { placed += s.items.length; });
    let html = row('Chapas', '<b>' + ns + '</b>') + row('Peças encaixadas', placed + (K.nest.unplaced.length ? ' de ' + (placed + K.nest.unplaced.length) : ''));
    K.nest.sheets.forEach((s, i) => { html += row('Aproveitamento chapa ' + (i + 1), nf(s.area / A * 100, 1) + '%'); });
    if (K.nest.unplaced.length){
      const names = {};
      K.nest.unplaced.forEach(u => { const it = K.nestItems[u.item]; if (it) names[it.name] = (names[it.name] || 0) + 1; });
      const list = []; for (const k in names) if (Object.prototype.hasOwnProperty.call(names, k)) list.push(k + (names[k] > 1 ? ' (' + names[k] + '×)' : ''));
      html += '<div class="ewarn">⚠ Não couberam na chapa: ' + esc(list.join(', ')) + '</div>';
    }
    el.innerHTML = html;
    updateSheetNav();
  }
  function updateSheetNav(){
    const n = K.sheets.length;
    showEl($('#camSheetNav'), n > 1);
    $('#camSheetLbl').textContent = 'Chapa ' + (K.sheet + 1) + ' de ' + n;
    $('#camPrev').disabled = K.sheet <= 0; $('#camNext').disabled = K.sheet >= n - 1;
    showEl($('#camSaveAllRow'), n > 1);
  }
  function goSheet(i){ if (i < 0 || i >= K.sheets.length || i === K.sheet) return; K.sheet = i; select(null); finishSheets(); }
  on($('#camPrev'), 'click', () => goSheet(K.sheet - 1));
  on($('#camNext'), 'click', () => goSheet(K.sheet + 1));

  function updateGen(){
    const P = K.plan, el = $('#camStats');
    const row = (k, v) => '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
    $('#camOrigin').textContent = 'Origem X0 Y0: canto inferior esquerdo da chapa · Z0: ' + (cfg.zRef === 'table' ? 'mesa (base da chapa)' : 'topo da chapa') + '.';
    if (!P){ el.innerHTML = row(K.runner ? 'Encaixando as peças…' : '—', ''); $('#camWarn').innerHTML = ''; $('#camGen').disabled = $('#camSaveG').disabled = $('#camSaveAll').disabled = true; return; }
    const cnt = {};
    P.feats.forEach(f => { cnt[f.op] = (cnt[f.op] || 0) + 1; });
    const PL = { out: ['recorte por fora', 'recortes por fora'], in: ['recorte por dentro', 'recortes por dentro'], pocket: ['rebaixo', 'rebaixos'], drill: ['furo', 'furos'], engrave: ['gravação', 'gravações'] };
    let ops = K.sheets.length > 1 ? row('Chapa', '<b>' + (K.sheet + 1) + ' de ' + K.sheets.length + '</b>') : '';
    ['out', 'in', 'pocket', 'drill', 'engrave'].forEach(o => { if (cnt[o]){ const n = cnt[o], w = PL[o][n > 1 ? 1 : 0]; ops += row(w.charAt(0).toUpperCase() + w.slice(1), fmtInt(n)); } });
    const st = K.stats;
    el.innerHTML = (ops || row('Operações', 'nenhuma')) + '<div class="sep"></div>' +
      (st ? row('Fresas', esc(st.tools.map(t => 'T' + (tools.indexOf(t) + 1)).join(', ')) + (st.tools.length > 1 ? ' (' + (st.tools.length - 1) + (st.tools.length > 2 ? ' trocas)' : ' troca)') : '')) : '') +
      (P.bb ? row('Ocupa na chapa', nf(P.bb[2] - P.bb[0], 1) + ' × ' + nf(P.bb[3] - P.bb[1], 1) + ' mm') : '') +
      (st ? row('Tempo estimado', fmtDur(st.minutes * 60)) : '');
    $('#camWarn').innerHTML = P.warn.map(w => '<div>⚠ ' + esc(w.charAt(0).toUpperCase() + w.slice(1)) + '</div>').join('');
    $('#camGen').disabled = $('#camSaveG').disabled = !(P.feats.length);
    $('#camSaveAll').disabled = !(P.feats.length);
  }

  /* ---------- gerar / salvar ---------- */
  function jobFiles(){ return K.files.map(f => f.name).join(', '); }
  function jobBase(){ return K.files.length === 1 ? baseName(K.files[0].name) : 'aproveitamento'; }
  function sheetName(i){ return jobBase() + (K.sheets.length > 1 ? '-chapa' + (i + 1) : '') + '.nc'; }
  function build(i){
    const sh = K.sheets[i];
    if (!sh || !sh.plan || !sh.plan.feats.length){ toast('Nada para cortar: abra um desenho e escolha as operações.'); return null; }
    const G = C.gcode(sh.plan, fullCfg(), tools, { name: jobFiles(), version: VERSION, sheet: K.sheets.length > 1 ? (i + 1) + ' de ' + K.sheets.length : '' });
    return { text: G.text, name: sheetName(i) };
  }
  function toViewer(G, meta){
    if (!confirmDiscard()) return false;
    setMode('view');
    loadText(G.text, assign({ name: G.name, size: G.text.length, enc: 'utf-8', bom: false, handle: null, parent: null, path: null }, meta || {}), false);
    return true;
  }
  on($('#camGen'), 'click', () => { const G = build(K.sheet); if (G) toViewer(G); });
  const fail = err => { if (!err || err.name !== 'AbortError') toast('Erro ao salvar: ' + ((err && err.message) || err)); };
  function jobFolder(){ for (let i = 0; i < K.files.length; i++){ const m = K.files[i].meta; if (m.parent && T.mode === 'fsa') return m; } return null; }
  function saveG(){
    const G = build(K.sheet); if (!G) return;
    const blob = textBlob(G.text, 'utf-8', false);
    const fm = jobFolder();
    if (fm){
      const dir = fm.parent;
      const name = askName('Nome do arquivo G-code (fica na mesma pasta do desenho):', G.name);
      if (!name) return;
      ensureWrite(dir)
        .then(() => entryExists(dir, name))
        .then(ex => { if (ex && !window.confirm('Já existe "' + name + '". Substituir?')) throw { name: 'AbortError' }; return dir.getFileHandle(name, { create: true }); })
        .then(h => writeHandle(h, blob).then(() => {
          toast('G-code salvo: ' + name);
          const path = fm.path ? fm.path.replace(/[^/]*$/, '') + name : null;
          refreshTree();
          toViewer({ text: G.text, name: name }, { handle: h, parent: dir, path: path });
        }))
        .catch(fail);
      return;
    }
    if (typeof window.showSaveFilePicker === 'function'){
      window.showSaveFilePicker({ suggestedName: G.name, id: 'gcode' })
        .then(h => writeHandle(h, blob).then(() => { toast('G-code salvo: ' + h.name); toViewer({ text: G.text, name: h.name }, { handle: h }); }))
        .catch(fail);
      return;
    }
    downloadBlob(blob, G.name);
    toast('G-code baixado: ' + G.name + ' (pasta Downloads)');
  }
  on($('#camSaveG'), 'click', saveG);
  function saveAll(){
    const list = [];
    for (let i = 0; i < K.sheets.length; i++){ const G = build(i); if (G) list.push(G); }
    if (!list.length) return;
    const fm = jobFolder();
    if (fm){
      const dir = fm.parent;
      ensureWrite(dir)
        .then(() => window.Promise.all(list.map(G => entryExists(dir, G.name))))
        .then(ex => {
          const old = list.filter((G, i) => ex[i]).map(G => G.name);
          if (old.length && !window.confirm('Já existem na pasta: ' + old.join(', ') + '. Substituir?')) throw { name: 'AbortError' };
          return list.reduce((p, G) => p.then(() => dir.getFileHandle(G.name, { create: true }).then(h => writeHandle(h, textBlob(G.text, 'utf-8', false)))), window.Promise.resolve());
        })
        .then(() => { toast(list.length + ' arquivos salvos na pasta do desenho: ' + list.map(G => G.name).join(', ')); refreshTree(); })
        .catch(fail);
      return;
    }
    list.forEach((G, i) => setTimeout(() => downloadBlob(textBlob(G.text, 'utf-8', false), G.name), i * 400));
    toast(list.length + ' arquivos G-code baixados (pasta Downloads).');
  }
  on($('#camSaveAll'), 'click', saveAll);

  /* ---------- desenho na tela ---------- */
  function resize(){
    const r = view.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === K.v.w && h === K.v.h && cv.width === Math.round(w * dpr)) return;
    const cx = K.v.w ? (K.v.w / 2 - K.v.ox) / K.v.s : null, cy = K.v.h ? (K.v.oy - K.v.h / 2) / K.v.s : null;
    K.v.w = w; K.v.h = h;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    if (cx !== null && K.v.fitted){ K.v.ox = w / 2 - cx * K.v.s; K.v.oy = h / 2 + cy * K.v.s; }
    draw();
  }
  function bounds(){
    const b = [0, 0, cfg.sheet.w, cfg.sheet.h];
    if (K.plan && K.plan.bb){ b[0] = Math.min(b[0], K.plan.bb[0]); b[1] = Math.min(b[1], K.plan.bb[1]); b[2] = Math.max(b[2], K.plan.bb[2]); b[3] = Math.max(b[3], K.plan.bb[3]); }
    return b;
  }
  function fit(){
    if (!K.v.w) return;
    const b = bounds(), pad = 36, lg = $('#camLegend');
    // embaixo fica a legenda: reserva o espaço dela
    const bot = lg && lg.offsetHeight ? lg.offsetHeight + 24 : 52, top = 52;
    const h = K.v.h - top - bot;
    const s = Math.min((K.v.w - pad * 2) / Math.max(b[2] - b[0], 1), h / Math.max(b[3] - b[1], 1));
    K.v.s = s > 0 ? s : 1;
    K.v.ox = (K.v.w - (b[2] - b[0]) * K.v.s) / 2 - b[0] * K.v.s;
    K.v.oy = top + (h + (b[3] - b[1]) * K.v.s) / 2 + b[1] * K.v.s;
    K.v.fitted = true;
    draw();
  }
  on($('#camFit'), 'click', fit);
  const sx = x => K.v.ox + x * K.v.s, sy = y => K.v.oy - y * K.v.s;
  const wx = px => (px - K.v.ox) / K.v.s, wy = py => (K.v.oy - py) / K.v.s;
  function col(k, d){ return (S.css && S.css[k]) || d; }
  function cssVar(k, d){ try { const v = window.getComputedStyle(document.documentElement).getPropertyValue('--' + k).replace(/^\s+|\s+$/g, ''); return v || d; } catch (e) { return d; } }
  function opColor(op){
    switch (op){
      case 'out': return col('c-feed', '#0369a1');
      case 'in': return col('c-y', '#16a34a');
      case 'pocket': return col('c-tool', '#ea8a00');
      case 'drill': return col('c-rapid', '#e11d48');
      case 'engrave': return col('c-arc', '#7c3aed');
      default: return col('muted', '#8b95a5');
    }
  }
  function poly(pts, closed, dx, dy){
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++){ const x = sx(pts[i][0] + dx), y = sy(pts[i][1] + dy); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    if (closed) ctx.closePath();
  }
  let rafId = 0;
  function draw(){
    if (rafId) return;
    rafId = (window.requestAnimationFrame || (f => setTimeout(f, 16)))(() => { rafId = 0; paint(); });
  }
  function paint(){
    if (K.mode !== 'cam') return;
    const dpr = window.devicePixelRatio || 1, W = K.v.w, H = K.v.h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col('canvas', '#fafbfc'); ctx.fillRect(0, 0, W, H);
    const panel2 = cssVar('panel-2', '#f5f6f8'), border = cssVar('border', '#dcdfe5'), muted = col('muted', '#5f6878');
    ctx.fillStyle = panel2; ctx.strokeStyle = border; ctx.lineWidth = 1;
    ctx.fillRect(sx(0), sy(cfg.sheet.h), cfg.sheet.w * K.v.s, cfg.sheet.h * K.v.s);
    ctx.strokeRect(sx(0) + 0.5, sy(cfg.sheet.h) + 0.5, cfg.sheet.w * K.v.s, cfg.sheet.h * K.v.s);
    if (cfg.margin > 0 && ctx.setLineDash){
      ctx.setLineDash([3, 4]); ctx.strokeStyle = border;
      ctx.strokeRect(sx(cfg.margin) + 0.5, sy(cfg.sheet.h - cfg.margin) + 0.5, (cfg.sheet.w - 2 * cfg.margin) * K.v.s, (cfg.sheet.h - 2 * cfg.margin) * K.v.s);
      ctx.setLineDash([]);
    }
    const ax = 40;
    ctx.lineWidth = 2;
    ctx.strokeStyle = col('c-x', '#dc2626'); ctx.beginPath(); ctx.moveTo(sx(0), sy(0)); ctx.lineTo(sx(0) + ax, sy(0)); ctx.stroke();
    ctx.strokeStyle = col('c-y', '#16a34a'); ctx.beginPath(); ctx.moveTo(sx(0), sy(0)); ctx.lineTo(sx(0), sy(0) - ax); ctx.stroke();
    ctx.fillStyle = muted; ctx.font = '11px system-ui, Segoe UI, Arial, sans-serif';
    ctx.fillText('X0 Y0', sx(0) + 4, sy(0) + 14);
    ctx.fillText((K.sheets.length > 1 ? 'Chapa ' + (K.sheet + 1) + ' de ' + K.sheets.length + ' · ' : '') + nf(cfg.sheet.w, 1) + ' × ' + nf(cfg.sheet.h, 1) + ' × ' + nf(cfg.sheet.t, 1) + ' mm', sx(0) + 2, sy(cfg.sheet.h) - 6);
    if (!K.model){ updateLegend({}); return; }
    const P = K.plan, dx = P ? P.dx : 0, dy = P ? P.dy : 0, used = {};
    const fz = fullCfg();
    K.model.shapes.forEach(s => {
      if (C.effOp(s, fz) !== 'pocket' || !s.closed || s.off) return;
      ctx.globalAlpha = 0.18; ctx.fillStyle = opColor('pocket'); poly(s.pts, true, dx, dy); ctx.fill(); ctx.globalAlpha = 1;
    });
    K.model.shapes.forEach(s => {
      let op = s.off ? 'off' : C.effOp(s, fz);
      if (s.kind === 'point'){
        op = op === 'off' ? 'off' : 'drill';
        used[op] = 1;
        ctx.strokeStyle = opColor(op); ctx.lineWidth = 1.5;
        const x = sx(s.pts[0][0] + dx), y = sy(s.pts[0][1] + dy);
        ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
        return;
      }
      used[op] = 1;
      ctx.strokeStyle = opColor(op); ctx.lineWidth = op === 'off' ? 1 : 1.6;
      if (op === 'off' && ctx.setLineDash) ctx.setLineDash([4, 4]);
      poly(s.pts, s.closed, dx, dy); ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
    });
    if (P && $('#camShowPaths').checked){
      const tcol = col('text', '#161a22'), tab = col('c-tool', '#ea8a00');
      P.feats.forEach(f => {
        f.paths.forEach(p => {
          if (p.drill){
            const x = sx(p.pts[0][0] + dx), y = sy(p.pts[0][1] + dy), r = Math.max(2, f.tool.d / 2 * K.v.s);
            ctx.strokeStyle = opColor('drill'); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
            return;
          }
          ctx.globalAlpha = 0.5; ctx.strokeStyle = tcol; ctx.lineWidth = 1;
          if (ctx.setLineDash) ctx.setLineDash([5, 3]);
          poly(p.pts, p.closed, dx, dy); ctx.stroke();
          if (ctx.setLineDash) ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          if (p.tabs && p.tabs.length){
            used.tab = 1;
            ctx.strokeStyle = tab; ctx.lineWidth = 5; ctx.lineCap = 'round';
            C.splitTabs(p.pts, p.tabs).forEach(sg => { if (sg.tab){ poly(sg.pts, false, dx, dy); ctx.stroke(); } });
            ctx.lineCap = 'butt';
          }
        });
      });
    }
    if (K.sel){
      ctx.strokeStyle = cssVar('accent', '#2563eb'); ctx.lineWidth = 4; ctx.globalAlpha = 0.55;
      K.model.shapes.forEach(s => {
        if (s.key !== K.sel) return;
        if (s.kind === 'point'){ ctx.beginPath(); ctx.arc(sx(s.pts[0][0] + dx), sy(s.pts[0][1] + dy), 8, 0, Math.PI * 2); ctx.stroke(); }
        else { poly(s.pts, s.closed, dx, dy); ctx.stroke(); }
      });
      ctx.globalAlpha = 1;
    }
    updateLegend(used);
  }
  function updateLegend(used){
    const el = $('#camLegend');
    const items = [];
    ['out', 'in', 'pocket', 'drill', 'engrave', 'off'].forEach(o => { if (used[o]) items.push('<div class="row"><span class="sw" style="background:' + opColor(o) + '"></span>' + (o === 'off' ? 'Ignorado' : C.OPS[o]) + '</div>'); });
    if (used.tab) items.push('<div class="row"><span class="sw" style="background:' + col('c-tool', '#ea8a00') + ';height:5px"></span>Pontes</div>');
    if (K.plan && $('#camShowPaths').checked && K.plan.feats.length) items.push('<div class="row muted"><span class="sw" style="background:' + col('text', '#161a22') + ';opacity:.5"></span>Centro da fresa</div>');
    el.innerHTML = items.join('');
    showEl(el, items.length > 0);
  }
  on($('#camShowPaths'), 'change', draw);

  /* ---------- seleção de uma linha (vale para todas as cópias da peça) ---------- */
  function segDist(px, py, a, b){
    const vx = b[0] - a[0], vy = b[1] - a[1], L = vx*vx + vy*vy;
    let t = L ? ((px - a[0]) * vx + (py - a[1]) * vy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a[0] + vx * t - px, qy = a[1] + vy * t - py;
    return Math.sqrt(qx*qx + qy*qy);
  }
  function pick(mx, my){
    if (!K.model) return null;
    const P = K.plan, x = wx(mx) - (P ? P.dx : 0), y = wy(my) - (P ? P.dy : 0), tol = 7 / K.v.s;
    let best = null, bd = tol;
    K.model.shapes.forEach(s => {
      if (x < s.bb[0] - tol || x > s.bb[2] + tol || y < s.bb[1] - tol || y > s.bb[3] + tol) return;
      const p = s.pts;
      if (s.kind === 'point'){ const d = C.dist(p[0], [x, y]); if (d < bd){ bd = d; best = s; } return; }
      for (let i = 1; i <= p.length; i++){
        if (i === p.length && !s.closed) break;
        const d = segDist(x, y, p[i-1], p[i % p.length]);
        if (d < bd){ bd = d; best = s; }
      }
    });
    return best ? best.key : null;
  }
  function select(key){
    K.sel = key || null;
    const box = $('#camSel');
    each($('#camJobList').querySelectorAll('.jp[data-key]'), r => setCls(r, 'on', r.getAttribute('data-key') === K.sel));
    const s = key && K.keyIdx[key];
    if (!s){ K.sel = null; showEl(box, false); draw(); return; }
    const g = K.layers[s.group] || {}, layerOp = g.op || 'auto';
    const autoName = { out: 'Recorte por fora', in: 'Recorte por dentro', engrave: 'Gravar na linha', drill: 'Furação' }[s.role];
    const kind = s.kind === 'point' ? 'Ponto' : s.kind === 'circle' ? 'Círculo Ø ' + nf(s.r * 2, 2) + ' mm' : s.closed ? 'Contorno fechado' : 'Linha aberta';
    const ov = K.ov[s.key] || '';
    let opts = '<option value=""' + (ov ? '' : ' selected') + '>Igual à camada (' + esc(layerOp === 'auto' ? 'Automático: ' + autoName : OPNAME[layerOp]) + ')</option>';
    OPS.forEach(o => { if (o[0] !== 'auto') opts += '<option value="' + o[0] + '"' + (o[0] === ov ? ' selected' : '') + '>' + o[1] + '</option>'; });
    let fname = '';
    K.files.forEach(f => { if (s.key.indexOf(f.id + ':') === 0) fname = f.name; });
    box.innerHTML = '<b>Linha selecionada</b>' +
      (K.files.length > 1 ? '<div class="kv"><span class="k">Desenho</span><span class="v">' + esc(fname) + '</span></div>' : '') +
      '<div class="kv"><span class="k">Camada</span><span class="v">' + esc(s.label || s.group) + '</span></div>' +
      '<div class="kv"><span class="k">Tipo</span><span class="v">' + kind + '</span></div>' +
      (s.kind !== 'point' ? '<div class="kv"><span class="k">Tamanho</span><span class="v">' + nf(s.bb[2] - s.bb[0], 2) + ' × ' + nf(s.bb[3] - s.bb[1], 2) + ' mm</span></div>' : '') +
      '<div class="field"><label for="camSelOp">Operação</label><select id="camSelOp">' + opts + '</select></div>' +
      '<div class="mh">Vale para todas as cópias desta peça · Esc fecha</div>';
    showEl(box, true);
    on($('#camSelOp'), 'change', e => { if (e.target.value) K.ov[s.key] = e.target.value; else delete K.ov[s.key]; replan(); });
    draw();
  }

  /* ---------- mouse e toque: arrastar, zoom, clicar ---------- */
  let drag = null, pinch = null;
  const relXY = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function zoomAt(mx, my, f){
    const s = Math.max(1e-4, Math.min(1e4, K.v.s * f));
    K.v.ox = mx - (mx - K.v.ox) * s / K.v.s; K.v.oy = my - (my - K.v.oy) * s / K.v.s; K.v.s = s;
    draw();
  }
  on(cv, 'mousedown', e => { if (e.button > 1) return; e.preventDefault(); const p = relXY(e); drag = { x: p[0], y: p[1], moved: false }; });
  on(window, 'mousemove', e => {
    if (K.mode !== 'cam') return;
    const p = relXY(e);
    if (drag){
      const ddx = p[0] - drag.x, ddy = p[1] - drag.y;
      if (!drag.moved && Math.abs(ddx) + Math.abs(ddy) < 4) return;
      drag.moved = true; setCls(view, 'panning', true);
      K.v.ox += ddx; K.v.oy += ddy; drag.x = p[0]; drag.y = p[1]; draw();
      return;
    }
    if (e.target === cv) $('#camCoords').textContent = 'X ' + nf(wx(p[0]), 2) + '  Y ' + nf(wy(p[1]), 2);
  });
  on(window, 'mouseup', e => {
    if (!drag) return;
    const wasClick = !drag.moved && e.target === cv;
    drag = null; setCls(view, 'panning', false);
    if (wasClick){ const p = relXY(e); select(pick(p[0], p[1])); }
  });
  on(cv, 'mouseleave', () => { $('#camCoords').textContent = ''; });
  const wheel = e => { e.preventDefault(); const p = relXY(e), d = e.deltaY || (e.wheelDelta ? -e.wheelDelta : 0) || e.detail; zoomAt(p[0], p[1], d > 0 ? 1 / 1.15 : 1.15); };
  on(cv, 'wheel', wheel); on(cv, 'mousewheel', wheel); on(cv, 'DOMMouseScroll', wheel);
  on(cv, 'dblclick', fit);
  on(cv, 'touchstart', e => {
    const t = e.touches;
    if (t.length === 1){ const p = relXY(t[0]); drag = { x: p[0], y: p[1], moved: false }; pinch = null; }
    else if (t.length === 2){ drag = null; const a = relXY(t[0]), b = relXY(t[1]); pinch = { d: C.dist(a, b), x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }; }
    e.preventDefault();
  });
  on(cv, 'touchmove', e => {
    const t = e.touches; e.preventDefault();
    if (pinch && t.length === 2){
      const a = relXY(t[0]), b = relXY(t[1]), d = C.dist(a, b), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      K.v.ox += mx - pinch.x; K.v.oy += my - pinch.y;
      if (pinch.d > 0) zoomAt(mx, my, d / pinch.d);
      pinch = { d: d, x: mx, y: my }; draw();
    } else if (drag && t.length === 1){
      const p = relXY(t[0]), ddx = p[0] - drag.x, ddy = p[1] - drag.y;
      if (!drag.moved && Math.abs(ddx) + Math.abs(ddy) < 6) return;
      drag.moved = true; K.v.ox += ddx; K.v.oy += ddy; drag.x = p[0]; drag.y = p[1]; draw();
    }
  });
  on(cv, 'touchend', e => {
    if (drag && !drag.moved && e.changedTouches && e.changedTouches[0]){ const p = relXY(e.changedTouches[0]); select(pick(p[0], p[1])); }
    if (!e.touches.length){ drag = null; pinch = null; }
  });
  if (window.ResizeObserver) new window.ResizeObserver(() => { if (K.mode === 'cam') resize(); }).observe(view);
  else { on(window, 'resize', () => { if (K.mode === 'cam') resize(); }); setInterval(() => { if (K.mode === 'cam') resize(); }, 500); }

  function key(e, kc, tag, type){
    if ((e.ctrlKey || e.metaKey) && kc === 83){ e.preventDefault(); saveG(); return; }
    if (kc === 27){ hideCtx(); closeMenus(); if (K.sel) select(null); return; }
    if (tag === 'div' && e.target.id === 'tree' && treeKey(e, kc)) return;
    if ((tag === 'input' && type !== 'checkbox') || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (kc === 70) fit();
    else if (kc === 33 || kc === 37){ e.preventDefault(); goSheet(K.sheet - 1); }
    else if (kc === 34 || kc === 39){ e.preventDefault(); goSheet(K.sheet + 1); }
  }

  /* ---------- exemplo ---------- */
  function sampleDXF(){
    const L = [];
    const g = (c, v) => { L.push(String(c)); L.push(String(v)); };
    const lw = (ly, closed, vs) => { g(0, 'LWPOLYLINE'); g(8, ly); g(90, vs.length); g(70, closed ? 1 : 0); vs.forEach(v => { g(10, v[0]); g(20, v[1]); if (v[2]) g(42, v[2]); }); };
    const circle = (ly, x, y, r) => { g(0, 'CIRCLE'); g(8, ly); g(10, x); g(20, y); g(30, 0); g(40, r); };
    const b = 0.41421356; // canto arredondado de 90°
    g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC'); g(0, 'SECTION'); g(2, 'ENTITIES');
    lw('CORTE', true, [[10, 0], [290, 0, b], [300, 10], [300, 170, b], [290, 180], [10, 180, b], [0, 170], [0, 10, b]]);
    circle('CORTE', 60, 90, 25);
    lw('CORTE', true, [[200, 60], [260, 60], [260, 120], [200, 120]]);
    lw('REBAIXO', true, [[120, 130], [180, 130], [180, 160], [120, 160]]);
    circle('FURO', 20, 20, 4); circle('FURO', 280, 20, 4); circle('FURO', 20, 160, 4); circle('FURO', 280, 160, 4);
    lw('GRAVAR', false, [[110, 40, 0.4], [190, 40]]);
    lw('CORTE', true, [[330, 0], [400, 0], [400, 70], [330, 70]]);
    circle('CORTE', 365, 35, 15);
    g(0, 'ENDSEC'); g(0, 'EOF');
    return L.join('\n');
  }
  on($('#camSample'), 'click', () => addDrawing(sampleDXF(), { name: 'exemplo.dxf', handle: null, parent: null, path: null }));

  /* ---------- início ---------- */
  fillSettings();
  renderTools();
  renderJob(true);
  updateGen();
  updateNest();
  if (store('gcv-aba') === 'cam') setMode('cam');

  return {
    active: () => K.mode === 'cam', openFile: openFile, openDialog: openDialog, key: key, setMode: setMode,
    redraw: () => { if (K.mode === 'cam') draw(); }, loadDrawing: addDrawing, addDrawing: addDrawing, state: K, cfg: cfg, tools: () => tools,
    sampleDXF: sampleDXF, busy: () => !!K.pending || !!K.runner, goSheet: goSheet
  };
})();
