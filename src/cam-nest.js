'use strict';
/* =====================================================================
   APROVEITAMENTO DA CHAPA (nesting) pelo formato real das peças
   Mesmo método do SVGnest / Deepnest (licença MIT): cada peça vai para o ponto livre mais à
   esquerda e embaixo da chapa, usando o "no-fit polygon" (NFP = região onde ela bateria nas
   peças já colocadas), calculado com a soma de Minkowski do Clipper. Depois a ordem das
   peças é melhorada aos poucos (algoritmo genético simples), sem travar a tela.
   Escrito para este projeto (ES5 no final, roda em PC antigo). Sem tela: pode ser testado no node.
   ===================================================================== */
(function (root) {
  const SC = 100;                 // inteiros do Clipper: 1 unidade = 0,01 mm
  const CL = () => root.ClipperLib;
  const toCL = pts => pts.map(p => ({ X: Math.round(p[0] * SC), Y: Math.round(p[1] * SC) }));

  function bnd(p){
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i++){ const q = p[i]; if (q.X < x0) x0 = q.X; if (q.Y < y0) y0 = q.Y; if (q.X > x1) x1 = q.X; if (q.Y > y1) y1 = q.Y; }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function rotCL(p, deg){
    const a = deg * Math.PI / 180;
    const c = Math.round(Math.cos(a) * 1e12) / 1e12, s = Math.round(Math.sin(a) * 1e12) / 1e12;
    return p.map(q => ({ X: Math.round(q.X * c - q.Y * s), Y: Math.round(q.X * s + q.Y * c) }));
  }
  function hull(pts){ // casco convexo (cadeia monótona), pontos [x,y]
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (P.length < 3) return P;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (let i = 0; i < P.length; i++){ while (lo.length >= 2 && cross(lo[lo.length-2], lo[lo.length-1], P[i]) <= 0) lo.pop(); lo.push(P[i]); }
    for (let i = P.length - 1; i >= 0; i--){ while (up.length >= 2 && cross(up[up.length-2], up[up.length-1], P[i]) <= 0) up.pop(); up.push(P[i]); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  function largest(paths){
    let best = null, ba = 0;
    for (let i = 0; i < paths.length; i++){ const a = Math.abs(CL().Clipper.Area(paths[i])); if (a > ba){ ba = a; best = paths[i]; } }
    return best;
  }
  // polígono usado no encaixe: contorno da peça aumentado em metade da distância entre peças
  function nestPoly(polys, gap, tol){
    const C = CL();
    let base = polys;
    if (polys.length > 1){ let all = []; polys.forEach(p => { all = all.concat(p); }); base = [hull(all)]; }
    // os arcos do contorno aumentado viram segmentos retos que ficam até "at" por dentro do arco
    // verdadeiro, e a simplificação tira até "tol": soma os dois para a folga nunca ficar menor
    const at = 0.1;
    const co = new C.ClipperOffset(2, at * SC);
    co.AddPaths(base.map(toCL), C.JoinType.jtRound, C.EndType.etClosedPolygon);
    const sol = new C.Paths();
    co.Execute(sol, (gap / 2 + at + tol) * SC);
    let p = largest(sol);
    if (!p) return null;
    p = C.Clipper.CleanPolygon(p, tol * SC);
    if (!C.Clipper.Orientation(p)) p.reverse();
    return p;
  }

  /* items: [{ polys: [[[x,y],...], ...], area, qty }]   (mm, coordenadas do próprio desenho)
     opts:  { bin: [x0, y0, x1, y1] (mm, onde o polígono de encaixe pode ficar), gap, rots: [0, 90, ...], tol } */
  function Nester(items, opts){
    const C = CL(), N = this;
    const tol = opts.tol || 0.15;
    N.opts = opts;
    N.items = items.map((it, i) => ({ i: i, qty: Math.max(0, Math.round(it.qty || 0)), area: it.area || 0, poly: nestPoly(it.polys, opts.gap || 0, tol), rots: {}, ok: [] }));
    const B = { x0: Math.round(opts.bin[0] * SC), y0: Math.round(opts.bin[1] * SC), x1: Math.round(opts.bin[2] * SC), y1: Math.round(opts.bin[3] * SC) };
    N.B = B;
    N.rotList = (opts.rots && opts.rots.length) ? opts.rots : [0];
    N.cache = {};
    N.items.forEach(it => {
      if (!it.poly) return;
      N.rotList.forEach(r => {
        const p = rotCL(it.poly, r), b = bnd(p);
        it.rots[r] = { p: p, b: b, neg: p.map(q => ({ X: -q.X, Y: -q.Y })) };
        if (b.x1 - b.x0 <= B.x1 - B.x0 + 2 && b.y1 - b.y0 <= B.y1 - B.y0 + 2) it.ok.push(r);
      });
    });
    N.instances = [];
    N.tooBig = [];
    N.items.forEach(it => { for (let k = 0; k < it.qty; k++){ if (it.ok.length) N.instances.push({ item: it.i, copy: k }); else N.tooBig.push({ item: it.i, copy: k }); } });
    N.nfp = (a, ra, b, rb) => {
      const key = a + '|' + ra + '|' + b + '|' + rb;
      let v = N.cache[key];
      if (v === undefined){
        const A = N.items[a].rots[ra].p, Bn = N.items[b].rots[rb].neg;
        v = largest(C.Clipper.MinkowskiSum(A, Bn, true)) || [];
        N.cache[key] = v;
      }
      return v;
    };
  }
  // ordem inicial: maiores primeiro
  Nester.prototype.greedyOrder = function (){
    const it = this.items;
    return this.instances.slice().sort((a, b) => (it[b.item].area - it[a.item].area) || (a.item - b.item) || (a.copy - b.copy));
  };
  // encaixe de uma ordem de peças; step() coloca uma peça por vez (para não travar a tela)
  Nester.prototype.placement = function (order){
    const N = this, C = CL(), B = N.B;
    const st = { queue: order.slice(), next: [], sheets: [], cur: null, done: false, unplaced: [] };
    function newSheet(){ st.cur = { items: [], bb: null, area: 0 }; }
    function tryPlace(inst){
      const it = N.items[inst.item];
      let best = null;
      for (let ri = 0; ri < it.ok.length; ri++){
        const r = it.ok[ri], R = it.rots[r], b = R.b;
        // região onde a referência da peça pode ficar dentro da chapa (com 0,01 mm de folga numérica)
        const ix0 = B.x0 - b.x0 - 1, iy0 = B.y0 - b.y0 - 1, ix1 = B.x1 - b.x1 + 1, iy1 = B.y1 - b.y1 + 1;
        if (ix0 > ix1 || iy0 > iy1) continue;
        let cand;
        if (!st.cur.items.length) cand = [{ X: ix0 + 1, Y: iy0 + 1 }];
        else {
          const c = new C.Clipper();
          c.AddPath([{ X: ix0, Y: iy0 }, { X: ix1, Y: iy0 }, { X: ix1, Y: iy1 }, { X: ix0, Y: iy1 }], C.PolyType.ptSubject, true);
          st.cur.items.forEach(pl => {
            const nf = N.nfp(pl.item, pl.rot, inst.item, r);
            if (nf.length) c.AddPath(nf.map(q => ({ X: q.X + pl.tx, Y: q.Y + pl.ty })), C.PolyType.ptClip, true);
          });
          const sol = new C.Paths();
          c.Execute(C.ClipType.ctDifference, sol, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
          cand = [];
          sol.forEach(p => { if (Math.abs(C.Clipper.Area(p)) > 0) p.forEach(q => cand.push(q)); });
        }
        for (let k = 0; k < cand.length; k++){
          const t = cand[k];
          let x0 = b.x0 + t.X, y0 = b.y0 + t.Y, x1 = b.x1 + t.X, y1 = b.y1 + t.Y;
          const bb = st.cur.bb;
          if (bb){ x0 = Math.min(x0, bb.x0); y0 = Math.min(y0, bb.y0); x1 = Math.max(x1, bb.x1); y1 = Math.max(y1, bb.y1); }
          // "gravidade" para a esquerda: chapa mais estreita possível, sobra fica inteira à direita
          const score = (x1 - x0) * 2 + (y1 - y0);
          if (!best || score < best.score - 1e-6 || (Math.abs(score - best.score) <= 1e-6 && (t.X < best.tx || (t.X === best.tx && t.Y < best.ty))))
            best = { score: score, rot: r, tx: t.X, ty: t.Y, bb: { x0: b.x0 + t.X, y0: b.y0 + t.Y, x1: b.x1 + t.X, y1: b.y1 + t.Y } };
        }
      }
      if (!best) return false;
      st.cur.items.push({ item: inst.item, copy: inst.copy, rot: best.rot, tx: best.tx, ty: best.ty });
      const bb = st.cur.bb;
      st.cur.bb = bb ? { x0: Math.min(bb.x0, best.bb.x0), y0: Math.min(bb.y0, best.bb.y0), x1: Math.max(bb.x1, best.bb.x1), y1: Math.max(bb.y1, best.bb.y1) } : best.bb;
      st.cur.area += N.items[inst.item].area;
      return true;
    }
    st.step = function (){
      if (st.done) return true;
      if (!st.cur) newSheet();
      if (!st.queue.length){
        if (st.cur.items.length) st.sheets.push(st.cur);
        if (!st.next.length || !st.cur.items.length){ st.unplaced = st.next.slice(); st.done = true; return true; }
        st.queue = st.next; st.next = []; newSheet();
        if (st.sheets.length >= 200){ st.unplaced = st.queue.slice(); st.done = true; return true; }
      }
      const inst = st.queue.shift();
      if (!tryPlace(inst)) st.next.push(inst);
      return false;
    };
    st.result = function (){
      const sheets = st.sheets.map(s => ({
        items: s.items.map(p => ({ item: p.item, copy: p.copy, rot: p.rot, x: p.tx / SC, y: p.ty / SC })),
        bb: s.bb ? [s.bb.x0 / SC, s.bb.y0 / SC, s.bb.x1 / SC, s.bb.y1 / SC] : null, area: s.area
      }));
      const last = st.sheets.length ? st.sheets[st.sheets.length - 1] : null;
      const unplaced = st.unplaced.concat(N.tooBig);
      // nota: menos peças de fora, menos chapas, e a última chapa mais estreita
      const fitness = unplaced.length * 1e12 + st.sheets.length * 1e8 + (last && last.bb ? (last.bb.x1 - last.bb.x0) * 2 + (last.bb.y1 - last.bb.y0) : 0) / SC;
      return { sheets: sheets, unplaced: unplaced, fitness: fitness };
    };
    return st;
  };
  // encaixe completo de uma vez (para testes e trabalhos pequenos)
  Nester.prototype.placeSync = function (order){
    const st = this.placement(order || this.greedyOrder());
    while (!st.step()){ /* continua */ }
    return st.result();
  };
  // roda aos poucos: primeiro a ordem "maiores primeiro"; com improveMs > 0 tenta outras ordens
  // (algoritmo genético simples). onProgress(melhor, avaliados, fração); onDone(melhor). Retorna { stop() }.
  Nester.prototype.run = function (improveMs, onProgress, onDone, sliceMs){
    const N = this, slice = sliceMs || 30;
    const now = () => (root.performance && root.performance.now) ? root.performance.now() : Date.now();
    const t0 = now();
    let stopped = false, best = null, evals = 0, pop = [], cur = null, curOrder = null, gen = [];
    const rnd = (n) => Math.floor(Math.random() * n);
    function mutate(o){
      const c = o.slice();
      for (let i = 0; i < c.length; i++) if (Math.random() < 0.15){ const j = Math.min(c.length - 1, i + 1 + rnd(3)); const t = c[i]; c[i] = c[j]; c[j] = t; }
      return c;
    }
    function mate(a, b){ // cruzamento por ordem: começo de um, o resto na ordem do outro
      const cut = 1 + rnd(Math.max(1, a.length - 1)), child = a.slice(0, cut), seen = {};
      child.forEach(x => { seen[x.item + ':' + x.copy] = 1; });
      b.forEach(x => { if (!seen[x.item + ':' + x.copy]) child.push(x); });
      return child;
    }
    function nextOrder(){
      if (!gen.length){
        if (!pop.length){ const g = N.greedyOrder(); gen = [g]; }
        else {
          pop.sort((a, b) => a.fit - b.fit);
          pop = pop.slice(0, 6);
          gen = [];
          for (let i = 0; i < 6; i++){
            const a = pop[Math.min(pop.length - 1, rnd(3))].order, b = pop[rnd(pop.length)].order;
            gen.push(mutate(Math.random() < 0.7 ? mate(a, b) : a));
          }
        }
      }
      return gen.shift();
    }
    function tick(){
      if (stopped) return;
      const ts = now();
      while (now() - ts < slice){
        if (!cur){
          if (best && (improveMs <= 0 || now() - t0 > improveMs || N.instances.length < 2)){ stopped = true; if (onDone) onDone(best); return; }
          curOrder = nextOrder(); cur = N.placement(curOrder);
        }
        if (cur.step()){
          const r = cur.result(); evals++;
          pop.push({ order: curOrder, fit: r.fitness });
          if (!best || r.fitness < best.fitness - 1e-9){ best = r; }
          cur = null;
          if (onProgress) onProgress(best, evals, improveMs > 0 ? Math.min(1, (now() - t0) / improveMs) : 1);
        }
      }
      setTimeout(tick, 0);
    }
    setTimeout(tick, 0);
    return { stop: () => { if (!stopped){ stopped = true; if (onDone && best) onDone(best); } } };
  };

  root.CAMNest = { Nester: Nester, hull: hull, SC: SC };
})(typeof window !== 'undefined' ? window : this);
