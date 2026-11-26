'use strict';
/* =====================================================================
   NÚCLEO DO CAM 2D (aba "Gerar G-code")
   DXF/SVG -> contornos em mm -> peças e furos -> caminhos da fresa -> G-code (Mach3)
   Usa as bibliotecas abertas ClipperLib (compensação da fresa e rebaixo) e DxfParser.
   Não mexe na página: pode ser testado sozinho (node) e é usado pela interface (cam.js).
   ===================================================================== */
(function (root) {
  const SC = 1000;          // Clipper trabalha com inteiros: 1 unidade = 0,001 mm
  const TOL = 0.01;         // tolerância de curvas (mm)
  const JOIN = 0.05;        // distância para juntar pontas de linhas soltas (mm)

  /* ---------------- geometria básica ---------------- */
  const dist = (a, b) => Math.sqrt((a[0]-b[0])*(a[0]-b[0]) + (a[1]-b[1])*(a[1]-b[1]));
  function area(p){ // área com sinal (positiva = anti-horário, Y para cima)
    let s = 0;
    for (let i = 0, n = p.length, j = n - 1; i < n; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
    return -s / 2;
  }
  function bboxOf(list, b){
    b = b || [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < list.length; i++){ const p = list[i]; if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }
    return b;
  }
  function pathLen(p, closed){
    let L = 0;
    for (let i = 1; i < p.length; i++) L += dist(p[i-1], p[i]);
    if (closed && p.length > 1) L += dist(p[p.length-1], p[0]);
    return L;
  }
  function inside(x, y, p){
    let c = false;
    for (let i = 0, n = p.length, j = n - 1; i < n; j = i++){
      const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  const inBox = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  function arcPts(cx, cy, r, a0, sweep, tolUnits){ // pontos de um arco (inclui o inicial e o final)
    const t = Math.min(Math.max(tolUnits, 1e-9), r * 0.5);
    const step = r > 0 ? 2 * Math.acos(1 - t / r) : Math.PI;
    const n = Math.max(1, Math.min(4096, Math.ceil(Math.abs(sweep) / Math.max(step, 1e-4))));
    const out = [];
    for (let i = 0; i <= n; i++){ const a = a0 + sweep * i / n; out.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]); }
    return out;
  }
  function dedupe(p, closed){
    const out = [];
    for (let i = 0; i < p.length; i++) if (!out.length || dist(out[out.length-1], p[i]) > 1e-9) out.push(p[i]);
    if (closed && out.length > 1 && dist(out[0], out[out.length-1]) < 1e-9) out.pop();
    return out;
  }
  // matriz afim [a,b,c,d,e,f]: x' = a*x + c*y + e ; y' = b*x + d*y + f
  const I = [1, 0, 0, 1, 0, 0];
  const mul = (m, n) => [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3], m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]];
  const app = (m, p) => [m[0]*p[0] + m[2]*p[1] + m[4], m[1]*p[0] + m[3]*p[1] + m[5]];
  const mScale = m => Math.sqrt(Math.abs(m[0]*m[3] - m[1]*m[2])) || 1;
  const isSimilar = m => Math.abs(m[0] - m[3]) < 1e-9 * (1 + Math.abs(m[0])) && Math.abs(m[1] + m[2]) < 1e-9 * (1 + Math.abs(m[1])) ||
    Math.abs(m[0] + m[3]) < 1e-9 * (1 + Math.abs(m[0])) && Math.abs(m[1] - m[2]) < 1e-9 * (1 + Math.abs(m[1])); // escala uniforme (com ou sem espelho)
  const hex2 = n => (n < 16 ? '0' : '') + n.toString(16);
  const rgbHex = n => '#' + hex2((n >> 16) & 255) + hex2((n >> 8) & 255) + hex2(n & 255);

  /* ---------------- leitura de DXF ---------------- */
  const DXF_UNITS = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4 };
  function readDXF(text){
    const P = root.DxfParser;
    if (!P) throw new Error('leitor de DXF não carregado');
    let dxf;
    try { dxf = new P().parseSync(text); } catch (e) { throw new Error('arquivo DXF inválido ou corrompido (' + (e && e.message || e) + ')'); }
    if (!dxf || !dxf.entities) throw new Error('arquivo DXF sem desenho');
    const ins = dxf.header && dxf.header.$INSUNITS;
    const unit = DXF_UNITS[ins] || 1;
    const tol = TOL / unit;
    const layers = (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) || {};
    const out = [], skipped = {};
    const skip = t => { skipped[t] = (skipped[t] || 0) + 1; };
    function colorOf(e, layer, parentColor){
      if (e.colorIndex === 0) return parentColor || '#ffffff';            // BYBLOCK
      if (e.color !== undefined && e.colorIndex !== 256) return rgbHex(e.color);
      const L = layers[layer];
      return L && L.color !== undefined ? rgbHex(L.color) : '#ffffff';    // BYLAYER
    }
    function push(pts, closed, m, layer, color, extra){
      const q = [];
      for (let i = 0; i < pts.length; i++) q.push(app(m, pts[i]));
      const s = { pts: dedupe(q, closed), closed: closed, layer: layer, color: color };
      if (extra) for (const k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) s[k] = extra[k];
      if (s.pts.length >= (s.kind === 'point' ? 1 : 2)) out.push(s);
    }
    const ocs = z => (z !== undefined && z < 0) ? [-1, 0, 0, 1, 0, 0] : I; // extrusão (0,0,-1): espelha X
    function bulgePts(vs, closed){
      const pts = [], n = vs.length, m = closed ? n : n - 1;
      if (!n) return pts;
      pts.push([vs[0].x, vs[0].y]);
      for (let i = 0; i < m; i++){
        const a = vs[i], b = vs[(i + 1) % n], bu = a.bulge || 0;
        if (Math.abs(bu) > 1e-9){
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx*dx + dy*dy);
          if (d > 1e-12){
            const th = 4 * Math.atan(bu), r = d / (2 * Math.sin(th / 2)), h = r * Math.cos(th / 2);
            const cx = (a.x + b.x) / 2 - h * dy / d, cy = (a.y + b.y) / 2 + h * dx / d;
            const a0 = Math.atan2(a.y - cy, a.x - cx);
            const ap = arcPts(cx, cy, Math.abs(r), a0, th, tol);
            for (let k = 1; k < ap.length; k++) pts.push(ap[k]);
            continue;
          }
        }
        pts.push([b.x, b.y]);
      }
      if (closed) pts.pop();
      return pts;
    }
    function spline(e){
      const P = e.controlPoints || [], U = e.knotValues || [], p = e.degreeOfSplineCurve || 3, n = P.length;
      if (n < 2 || U.length !== n + p + 1){
        const F = e.fitPoints && e.fitPoints.length > 1 ? e.fitPoints : P;
        return F.map(v => [v.x, v.y]);
      }
      let L = 0; for (let i = 1; i < n; i++) L += Math.sqrt(Math.pow(P[i].x - P[i-1].x, 2) + Math.pow(P[i].y - P[i-1].y, 2));
      const steps = Math.max(n * 8, Math.min(4000, Math.ceil(L / Math.max(tol * 40, 1e-9))));
      const t0 = U[p], t1 = U[n], out = [];
      for (let s = 0; s <= steps; s++){
        const t = s === steps ? t1 - 1e-12 * (t1 - t0) : t0 + (t1 - t0) * s / steps;
        let k = p; while (k < n - 1 && t >= U[k + 1]) k++;
        const d = [];
        for (let j = 0; j <= p; j++){ const c = P[k - p + j]; d.push([c.x, c.y]); }
        for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--){
          const i = k - p + j, den = U[i + p - r + 1] - U[i], al = den ? (t - U[i]) / den : 0;
          d[j] = [(1 - al) * d[j-1][0] + al * d[j][0], (1 - al) * d[j-1][1] + al * d[j][1]];
        }
        out.push(d[p]);
      }
      return out;
    }
    function walk(list, m, parentLayer, parentColor, depth){
      for (let i = 0; i < list.length; i++){
        const e = list[i];
        const layer = (e.layer === '0' || e.layer === undefined) && parentLayer ? parentLayer : (e.layer || '0');
        const color = colorOf(e, layer, parentColor);
        switch (e.type){
          case 'LINE': push([[e.vertices[0].x, e.vertices[0].y], [e.vertices[1].x, e.vertices[1].y]], false, m, layer, color); break;
          case 'ARC': {
            let sw = e.endAngle - e.startAngle; while (sw <= 0) sw += Math.PI * 2;
            push(arcPts(e.center.x, e.center.y, e.radius, e.startAngle, sw, tol), false, mul(m, ocs(e.extrusionDirectionZ)), layer, color);
            break;
          }
          case 'CIRCLE': {
            const mm = mul(m, ocs(e.extrusionDirectionZ)), pts = arcPts(e.center.x, e.center.y, e.radius, 0, Math.PI * 2, tol);
            pts.pop();
            const c = app(mm, [e.center.x, e.center.y]);
            push(pts, true, mm, layer, color, isSimilar(mm) ? { kind: 'circle', cx: c[0], cy: c[1], r: e.radius * mScale(mm) } : null);
            break;
          }
          case 'LWPOLYLINE':
            push(bulgePts(e.vertices || [], !!e.shape), !!e.shape, mul(m, ocs(e.extrusionDirectionZ)), layer, color); break;
          case 'POLYLINE':
            if (e.isPolyfaceMesh || e.is3dPolygonMesh){ skip('malha 3D'); break; }
            push(bulgePts((e.vertices || []).filter(v => !v.splineControlPoint), !!e.shape), !!e.shape, mul(m, ocs(e.extrusionDirection && e.extrusionDirection.z)), layer, color); break;
          case 'SPLINE': {
            const pts = spline(e);
            const cl = !!e.closed || (pts.length > 2 && Math.abs(pts[0][0] - pts[pts.length-1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[pts.length-1][1]) < 1e-9);
            push(pts, cl, m, layer, color); break;
          }
          case 'ELLIPSE': {
            const a = e.majorAxisEndPoint, k = e.axisRatio, c = e.center;
            let t0 = e.startAngle || 0, sw = (e.endAngle === undefined ? Math.PI * 2 : e.endAngle) - t0;
            while (sw <= 0) sw += Math.PI * 2;
            const full = Math.abs(sw - Math.PI * 2) < 1e-6, R = Math.sqrt(a.x*a.x + a.y*a.y);
            const n = Math.max(16, Math.min(4096, Math.ceil(Math.abs(sw) / (2 * Math.acos(1 - Math.min(tol / Math.max(R, 1e-9), 0.5))))));
            const pts = [];
            for (let s = 0; s <= n; s++){ const t = t0 + sw * s / n; pts.push([c.x + a.x*Math.cos(t) - k*a.y*Math.sin(t), c.y + a.y*Math.cos(t) + k*a.x*Math.sin(t)]); }
            if (full) pts.pop();
            push(pts, full, m, layer, color); break;
          }
          case 'POINT': push([[e.position.x, e.position.y]], false, m, layer, color, { kind: 'point' }); break;
          case 'INSERT': {
            const b = dxf.blocks && dxf.blocks[e.name];
            if (!b || !b.entities || depth > 8){ skip('bloco'); break; }
            const bp = b.position || { x: 0, y: 0 }, rot = (e.rotation || 0) * Math.PI / 180;
            const sx = e.xScale === undefined ? 1 : e.xScale, sy = e.yScale === undefined ? 1 : e.yScale;
            const nc = Math.max(1, e.columnCount || 1), nr = Math.max(1, e.rowCount || 1);
            for (let r = 0; r < nr; r++) for (let c2 = 0; c2 < nc; c2++){
              const px = e.position.x + c2 * (e.columnSpacing || 0) * Math.cos(rot) - r * (e.rowSpacing || 0) * Math.sin(rot);
              const py = e.position.y + c2 * (e.columnSpacing || 0) * Math.sin(rot) + r * (e.rowSpacing || 0) * Math.cos(rot);
              let bm = [Math.cos(rot) * sx, Math.sin(rot) * sx, -Math.sin(rot) * sy, Math.cos(rot) * sy, px, py];
              bm = mul(bm, [1, 0, 0, 1, -bp.x, -bp.y]);
              walk(b.entities, mul(mul(m, ocs(e.extrusionDirection && e.extrusionDirection.z)), bm), layer, color, depth + 1);
            }
            break;
          }
          case 'TEXT': case 'MTEXT': skip('texto'); break;
          case 'DIMENSION': skip('cota'); break;
          case 'HATCH': skip('hachura'); break;
          default: skip(String(e.type || '?').toLowerCase());
        }
      }
    }
    walk(dxf.entities, I, null, null, 0);
    return { shapes: out, unit: unit, unitNote: ins && DXF_UNITS[ins] ? 'do arquivo' : 'não informada (usando mm)', skipped: skipped, flipY: false };
  }

  /* ---------------- leitura de SVG ---------------- */
  const CSSN = { black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
    cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', orange: '#ffa500',
    purple: '#800080', maroon: '#800000', navy: '#000080', olive: '#808000', teal: '#008080', silver: '#c0c0c0', brown: '#a52a2a', pink: '#ffc0cb' };
  function normColor(c){
    if (!c) return null;
    c = String(c).replace(/\s+/g, '').toLowerCase();
    if (c === 'none' || c === 'transparent' || c.indexOf('url(') === 0) return null;
    if (CSSN[c]) return CSSN[c];
    let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
    if (m) return '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
    if (/^#[0-9a-f]{6}$/.test(c)) return c;
    m = /^rgba?\((\d+)%?,(\d+)%?,(\d+)%?/.exec(c);
    if (m) return '#' + hex2(Math.min(255, +m[1])) + hex2(Math.min(255, +m[2])) + hex2(Math.min(255, +m[3]));
    return c;
  }
  const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
  function lenMM(s){
    const m = /^\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px|%)?\s*$/i.exec(s || '');
    if (!m || m[2] === '%') return null;
    return parseFloat(m[1]) * UNIT_MM[(m[2] || '').toLowerCase()];
  }
  function parseTransform(s){
    let m = I;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    let r;
    while ((r = re.exec(s || ''))){
      const v = (r[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []).map(parseFloat);
      let t = I;
      switch (r[1]){
        case 'matrix': if (v.length === 6) t = v; break;
        case 'translate': t = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
        case 'scale': t = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0]; break;
        case 'rotate': {
          const a = (v[0] || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
          t = [c, sn, -sn, c, 0, 0];
          if (v.length >= 3) t = mul(mul([1, 0, 0, 1, v[1], v[2]], t), [1, 0, 0, 1, -v[1], -v[2]]);
          break;
        }
        case 'skewX': t = [1, 0, Math.tan((v[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
        case 'skewY': t = [1, Math.tan((v[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break;
      }
      m = mul(m, t);
    }
    return m;
  }
  // caminho SVG (atributo d) -> lista de { pts, closed } em unidades do usuário
  function parsePathD(d, tol){
    const subs = [];
    let i = 0, cmd = '', cur = [0, 0], start = [0, 0], pts = null, lastC = null, lastQ = null;
    const s = d || '';
    const ws = () => { while (i < s.length && /[\s,]/.test(s.charAt(i))) i++; };
    function num(){
      ws();
      const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(s.slice(i, i + 40));
      if (!m) return null;
      i += m[0].length; return parseFloat(m[0]);
    }
    function flag(){ ws(); const c = s.charAt(i); if (c === '0' || c === '1'){ i++; return c === '1'; } return null; }
    const begin = p => { if (pts && pts.length > 1) subs.push({ pts: pts, closed: false }); pts = [p]; };
    function cubic(p0, p1, p2, p3){
      const n = Math.max(2, Math.min(256, Math.ceil(Math.sqrt((dist(p0, p1) + dist(p1, p2) + dist(p2, p3)) / Math.max(tol, 1e-9)) * 0.6)));
      for (let k = 1; k <= n; k++){
        const t = k / n, a = (1-t)*(1-t)*(1-t), b = 3*(1-t)*(1-t)*t, c = 3*(1-t)*t*t, e = t*t*t;
        pts.push([a*p0[0] + b*p1[0] + c*p2[0] + e*p3[0], a*p0[1] + b*p1[1] + c*p2[1] + e*p3[1]]);
      }
    }
    function arcTo(rx, ry, phi, fa, fs, p){
      const p0 = cur;
      if (dist(p0, p) < 1e-12) return;
      rx = Math.abs(rx); ry = Math.abs(ry);
      if (!rx || !ry){ pts.push(p); return; }
      const c = Math.cos(phi * Math.PI / 180), sn = Math.sin(phi * Math.PI / 180);
      const dx = (p0[0] - p[0]) / 2, dy = (p0[1] - p[1]) / 2;
      const x1 = c*dx + sn*dy, y1 = -sn*dx + c*dy;
      let L = x1*x1/(rx*rx) + y1*y1/(ry*ry);
      if (L > 1){ L = Math.sqrt(L); rx *= L; ry *= L; }
      let k = (rx*rx*ry*ry - rx*rx*y1*y1 - ry*ry*x1*x1) / (rx*rx*y1*y1 + ry*ry*x1*x1);
      k = Math.sqrt(Math.max(0, k)) * (fa === fs ? -1 : 1);
      const cxp = k * rx * y1 / ry, cyp = -k * ry * x1 / rx;
      const cx = c*cxp - sn*cyp + (p0[0] + p[0]) / 2, cy = sn*cxp + c*cyp + (p0[1] + p[1]) / 2;
      const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux*vy - uy*vx, ux*vx + uy*vy); return a; };
      const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
      let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
      if (!fs && dt > 0) dt -= Math.PI * 2; else if (fs && dt < 0) dt += Math.PI * 2;
      const R = Math.max(rx, ry), st = 2 * Math.acos(1 - Math.min(tol / R, 0.5));
      const n = Math.max(2, Math.min(1024, Math.ceil(Math.abs(dt) / st)));
      for (let q = 1; q <= n; q++){
        const t = t1 + dt * q / n, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
        pts.push(q === n ? p : [c*ex - sn*ey + cx, sn*ex + c*ey + cy]);
      }
    }
    while (i < s.length){
      ws(); if (i >= s.length) break;
      const ch = s.charAt(i);
      if (/[MmZzLlHhVvCcSsQqTtAa]/.test(ch)){ cmd = ch; i++; }
      else if (!cmd) break;
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      if (C === 'Z'){
        if (pts && pts.length > 1) subs.push({ pts: pts, closed: true });
        pts = null; cur = start; lastC = lastQ = null;
        cmd = ''; continue;
      }
      const before = i;
      const ox = rel ? cur[0] : 0, oy = rel ? cur[1] : 0;
      if (!pts) pts = [cur];
      let ok = true;
      switch (C){
        case 'M': {
          const x = num(), y = num(); if (y === null){ ok = false; break; }
          cur = [ox + x, oy + y]; start = cur; begin(cur);
          cmd = rel ? 'l' : 'L'; lastC = lastQ = null; break;
        }
        case 'L': { const x = num(), y = num(); if (y === null){ ok = false; break; } cur = [ox + x, oy + y]; pts.push(cur); lastC = lastQ = null; break; }
        case 'H': { const x = num(); if (x === null){ ok = false; break; } cur = [ox + x, cur[1]]; pts.push(cur); lastC = lastQ = null; break; }
        case 'V': { const y = num(); if (y === null){ ok = false; break; } cur = [cur[0], (rel ? cur[1] : 0) + y]; pts.push(cur); lastC = lastQ = null; break; }
        case 'C': case 'S': {
          let p1;
          if (C === 'C'){ const a = num(), b = num(); if (b === null){ ok = false; break; } p1 = [ox + a, oy + b]; }
          else p1 = lastC ? [2*cur[0] - lastC[0], 2*cur[1] - lastC[1]] : cur;
          const c1 = num(), c2 = num(), x = num(), y = num(); if (y === null){ ok = false; break; }
          const p2 = [ox + c1, oy + c2], p3 = [ox + x, oy + y];
          cubic(cur, p1, p2, p3); lastC = p2; lastQ = null; cur = p3; break;
        }
        case 'Q': case 'T': {
          let q1;
          if (C === 'Q'){ const a = num(), b = num(); if (b === null){ ok = false; break; } q1 = [ox + a, oy + b]; }
          else q1 = lastQ ? [2*cur[0] - lastQ[0], 2*cur[1] - lastQ[1]] : cur;
          const x = num(), y = num(); if (y === null){ ok = false; break; }
          const p3 = [ox + x, oy + y];
          cubic(cur, [cur[0] + 2/3*(q1[0] - cur[0]), cur[1] + 2/3*(q1[1] - cur[1])], [p3[0] + 2/3*(q1[0] - p3[0]), p3[1] + 2/3*(q1[1] - p3[1])], p3);
          lastQ = q1; lastC = null; cur = p3; break;
        }
        case 'A': {
          const rx = num(), ry = num(), ph = num(), fa = flag(), fs = flag(), x = num(), y = num();
          if (y === null || fa === null || fs === null){ ok = false; break; }
          const p = [ox + x, oy + y]; arcTo(rx, ry, ph, fa, fs, p); cur = p; lastC = lastQ = null; break;
        }
        default: ok = false;
      }
      if (!ok || i === before){ if (i === before) i++; }
    }
    if (pts && pts.length > 1) subs.push({ pts: pts, closed: false });
    return subs;
  }
  function readSVG(text){
    const DP = root.DOMParser;
    if (!DP) throw new Error('este navegador não lê SVG');
    const doc = new DP().parseFromString(text, 'image/svg+xml');
    const svg = doc && doc.documentElement;
    if (!svg || String(svg.nodeName).toLowerCase().replace(/^.*:/, '') !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('arquivo SVG inválido');
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
    const hasVB = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
    const wmm = lenMM(svg.getAttribute('width')), hmm = lenMM(svg.getAttribute('height'));
    let unit = 25.4 / 96, unitNote = 'px a 96 ppp (padrão)';
    if (hasVB && wmm) { unit = wmm / vb[2]; unitNote = 'do arquivo'; }
    else if (hasVB && hmm) { unit = hmm / vb[3]; unitNote = 'do arquivo'; }
    else if (!hasVB && /(mm|cm|in|pt|pc)\s*$/i.test(svg.getAttribute('width') || '')){ unit = wmm / (parseFloat(svg.getAttribute('width')) || 1); unitNote = 'do arquivo'; }
    const tol = TOL / unit;
    const out = [], skipped = {};
    const skip = t => { skipped[t] = (skipped[t] || 0) + 1; };
    const SKIPTAG = { defs: 1, clippath: 1, mask: 1, pattern: 1, marker: 1, symbol: 1, title: 1, desc: 1, metadata: 1, style: 1, script: 1,
      lineargradient: 1, radialgradient: 1, filter: 1, foreignobject: 1, namedview: 1 };
    function styleOf(el, k){
      const st = el.getAttribute('style') || '';
      const m = new RegExp('(?:^|;)\\s*' + k + '\\s*:\\s*([^;]+)').exec(st);
      if (m) return m[1].replace(/\s*!important\s*$/, '');
      return el.getAttribute(k);
    }
    const byId = id => { const all = doc.getElementsByTagName('*'); for (let k = 0; k < all.length; k++) if (all[k].getAttribute('id') === id) return all[k]; return null; };
    const fa = (el, k) => parseFloat(el.getAttribute(k)) || 0;
    function add(list, m, color, extra){
      const sc = mScale(m);
      for (let k = 0; k < list.length; k++){
        const p = list[k].pts.map(q => app(m, q)), closed = list[k].closed;
        const s = { pts: dedupe(p, closed), closed: closed, layer: null, color: color };
        if (extra && sc){ s.kind = extra.kind; const c = app(m, [extra.cx, extra.cy]); s.cx = c[0]; s.cy = c[1]; s.r = extra.r * sc; }
        if (s.pts.length >= 2) out.push(s);
      }
    }
    function walk(el, m, stroke, fill, depth){
      if (el.nodeType !== 1 || depth > 30) return;
      const tag = String(el.nodeName).toLowerCase().replace(/^.*:/, '');
      if (SKIPTAG[tag]) return;
      const disp = styleOf(el, 'display'), vis = styleOf(el, 'visibility');
      if (disp === 'none' || vis === 'hidden') return;
      const tr = el.getAttribute('transform');
      let mm = tr ? mul(m, parseTransform(tr)) : m;
      const sAttr = styleOf(el, 'stroke'), fAttr = styleOf(el, 'fill');
      if (sAttr !== null && sAttr !== undefined && sAttr !== 'inherit') stroke = sAttr;
      if (fAttr !== null && fAttr !== undefined && fAttr !== 'inherit') fill = fAttr;
      const color = normColor(stroke) || normColor(fill) || '#000000';
      const loc = tol / (mScale(mm) || 1);   // tolerância nas unidades locais do elemento
      switch (tag){
        case 'svg': case 'g': case 'a': case 'switch': {
          if (tag === 'svg' && depth > 0) mm = mul(mm, [1, 0, 0, 1, fa(el, 'x'), fa(el, 'y')]);
          const ch = el.childNodes;
          for (let k = 0; k < ch.length; k++) walk(ch[k], mm, stroke, fill, depth + 1);
          return;
        }
        case 'use': {
          const h = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || el.getAttribute('xlink:href');
          const ref = h && h.charAt(0) === '#' ? byId(h.slice(1)) : null;
          if (!ref){ skip('use'); return; }
          const um = mul(mm, [1, 0, 0, 1, fa(el, 'x'), fa(el, 'y')]);
          if (String(ref.nodeName).toLowerCase().replace(/^.*:/, '') === 'symbol'){
            const ch = ref.childNodes; for (let k = 0; k < ch.length; k++) walk(ch[k], um, stroke, fill, depth + 1);
          } else walk(ref, um, stroke, fill, depth + 1);
          return;
        }
        case 'path': add(parsePathD(el.getAttribute('d'), loc), mm, color); return;
        case 'line': add([{ pts: [[fa(el, 'x1'), fa(el, 'y1')], [fa(el, 'x2'), fa(el, 'y2')]], closed: false }], mm, color); return;
        case 'polyline': case 'polygon': {
          const v = (el.getAttribute('points') || '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
          const p = []; for (let k = 0; k + 1 < v.length; k += 2) p.push([parseFloat(v[k]), parseFloat(v[k+1])]);
          add([{ pts: p, closed: tag === 'polygon' }], mm, color); return;
        }
        case 'rect': {
          const x = fa(el, 'x'), y = fa(el, 'y'), w = fa(el, 'width'), h = fa(el, 'height');
          if (!(w > 0 && h > 0)) return;
          let rx = parseFloat(el.getAttribute('rx')), ry = parseFloat(el.getAttribute('ry'));
          if (!(rx > 0)) rx = ry > 0 ? ry : 0; if (!(ry > 0)) ry = rx;
          rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
          let p;
          if (rx > 0){
            p = [];
            const corner = (cx, cy, a0) => { const n = Math.max(2, Math.ceil(Math.PI / 2 / (2 * Math.acos(1 - Math.min(loc / Math.max(rx, ry), 0.5))))); for (let k = 0; k <= n; k++){ const a = a0 + Math.PI / 2 * k / n; p.push([cx + rx*Math.cos(a), cy + ry*Math.sin(a)]); } };
            corner(x + w - rx, y + ry, -Math.PI / 2); corner(x + w - rx, y + h - ry, 0); corner(x + rx, y + h - ry, Math.PI / 2); corner(x + rx, y + ry, Math.PI);
          } else p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
          add([{ pts: p, closed: true }], mm, color); return;
        }
        case 'circle': case 'ellipse': {
          const cx = fa(el, 'cx'), cy = fa(el, 'cy');
          const rx = tag === 'circle' ? fa(el, 'r') : fa(el, 'rx'), ry = tag === 'circle' ? rx : fa(el, 'ry');
          if (!(rx > 0 && ry > 0)) return;
          const R = Math.max(rx, ry), n = Math.max(16, Math.min(4096, Math.ceil(Math.PI * 2 / (2 * Math.acos(1 - Math.min(loc / R, 0.5))))));
          const p = []; for (let k = 0; k < n; k++){ const a = Math.PI * 2 * k / n; p.push([cx + rx*Math.cos(a), cy + ry*Math.sin(a)]); }
          add([{ pts: p, closed: true }], mm, color, Math.abs(rx - ry) < 1e-9 && isSimilar(mm) ? { kind: 'circle', cx: cx, cy: cy, r: rx } : null);
          return;
        }
        case 'text': case 'tspan': case 'image': skip(tag === 'image' ? 'imagem' : 'texto'); return;
        default: {
          const ch = el.childNodes;
          for (let k = 0; k < ch.length; k++) walk(ch[k], mm, stroke, fill, depth + 1);
        }
      }
    }
    const m0 = hasVB ? [1, 0, 0, 1, -vb[0], -vb[1]] : I;
    walk(svg, m0, null, null, 0);
    // Y do SVG cresce para baixo: inverte (origem no canto inferior esquerdo da página)
    const H = hasVB ? vb[3] : (hmm ? hmm / unit : 0);
    out.forEach(s => { s.pts = s.pts.map(p => [p[0], H - p[1]]); s.pts.reverse(); if (s.kind === 'circle') s.cy = H - s.cy; });
    return { shapes: out, unit: unit, unitNote: unitNote, skipped: skipped, flipY: true };
  }

  /* ---------------- organizar o desenho ---------------- */
  // junta linhas soltas que se encostam (DXF costuma ter cada lado da peça como uma linha separada)
  function joinChains(shapes, tol){
    const open = [], done = [];
    shapes.forEach(s => { if (!s.closed && s.kind !== 'point' && s.pts.length > 1) open.push(s); else done.push(s); });
    const key = (p, dx, dy) => Math.round(p[0] / tol + dx) + ',' + Math.round(p[1] / tol + dy);
    const grid = {};
    const addEnd = (s, end) => { const p = end ? s.pts[s.pts.length-1] : s.pts[0], k = key(p, 0, 0); (grid[k] || (grid[k] = [])).push({ s: s, end: end }); };
    open.forEach(s => { s.used = false; addEnd(s, false); addEnd(s, true); });
    function find(p, group){
      let best = null, bd = tol;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){
        const L = grid[key(p, dx, dy)]; if (!L) continue;
        for (let k = 0; k < L.length; k++){
          const c = L[k]; if (c.s.used || c.s.group !== group) continue;
          const q = c.end ? c.s.pts[c.s.pts.length-1] : c.s.pts[0], d = dist(p, q);
          if (d <= bd){ bd = d; best = c; }
        }
      }
      return best;
    }
    open.forEach(s0 => {
      if (s0.used) return;
      s0.used = true;
      let pts = s0.pts.slice();
      for (let guard = 0; guard < 100000; guard++){
        const c = find(pts[pts.length-1], s0.group); if (!c) break;
        c.s.used = true;
        const q = c.end ? c.s.pts.slice().reverse() : c.s.pts;
        for (let k = 1; k < q.length; k++) pts.push(q[k]);
      }
      for (let guard = 0; guard < 100000; guard++){
        const c = find(pts[0], s0.group); if (!c) break;
        c.s.used = true;
        const q = c.end ? c.s.pts : c.s.pts.slice().reverse();
        pts = q.slice(0, q.length - 1).concat(pts);
      }
      const closed = pts.length > 2 && dist(pts[0], pts[pts.length-1]) <= tol;
      if (closed) pts.pop();
      done.push({ pts: pts, closed: closed, layer: s0.layer, color: s0.color, group: s0.group, label: s0.label, key: s0.key, partKey: s0.partKey });
    });
    return done;
  }
  // unit = mm por unidade do arquivo. Retorna o modelo: contornos, hierarquia (peça/furo) e grupos (camadas/cores)
  // opts.prefix: identifica o arquivo (várias peças de vários desenhos); opts.keepGroups: mantém grupo/camada já definidos
  function buildModel(imp, unit, opts){
    opts = opts || {};
    const raw = imp.shapes.map(s => {
      const o = { pts: s.pts.map(p => [p[0] * unit, p[1] * unit]), closed: s.closed, layer: s.layer, color: s.color || '#000000', kind: s.kind };
      if (s.kind === 'circle'){ o.cx = s.cx * unit; o.cy = s.cy * unit; o.r = s.r * unit; }
      if (opts.keepGroups){ o.group = s.group; o.label = s.label; o.key = s.key; o.partKey = s.partKey; }
      return o;
    });
    // grupo: camada do DXF (separada por cor quando a camada tem várias) ou cor do SVG
    const colorsPerLayer = {};
    raw.forEach(s => { if (s.layer !== null && s.layer !== undefined){ const c = colorsPerLayer[s.layer] || (colorsPerLayer[s.layer] = {}); c[s.color] = 1; } });
    raw.forEach(s => {
      if (opts.keepGroups && s.group !== undefined) return;
      if (s.layer !== null && s.layer !== undefined){
        const multi = Object.keys(colorsPerLayer[s.layer]).length > 1;
        s.group = multi ? s.layer + ' ' + s.color : s.layer;
        s.label = multi ? s.layer + ' (cor ' + s.color + ')' : s.layer;
      } else { s.group = s.color; s.label = 'Cor ' + s.color; }
    });
    const shapes = joinChains(raw, JOIN).concat([]);
    // restaura dados de círculo (joinChains não mexe em fechados)
    const list = [];
    shapes.forEach(s => {
      if (s.closed && s.pts.length < 3) s.closed = false;
      if (s.kind !== 'point' && s.pts.length < 2) return;
      list.push(s);
    });
    list.forEach((s, i) => {
      s.id = i;
      if (!opts.keepGroups || s.key === undefined) s.key = (opts.prefix ? opts.prefix + ':' : '') + i;
      s.bb = bboxOf(s.pts);
      if (s.closed){ s.sa = area(s.pts); s.area = Math.abs(s.sa); }
      s.len = s.kind === 'point' ? 0 : pathLen(s.pts, s.closed);
      s.parent = null; s.depth = 0;
    });
    // hierarquia: o pai de um contorno é o menor contorno fechado que o contém
    const closed = list.filter(s => s.closed).sort((a, b) => b.area - a.area);
    for (let i = 0; i < closed.length; i++){
      const s = closed[i], p = s.pts[0];
      for (let j = i - 1; j >= 0; j--){
        const c = closed[j];
        if (c.area <= s.area || !inBox(c.bb, p[0], p[1]) || s.bb[0] < c.bb[0] - 1e-9 || s.bb[2] > c.bb[2] + 1e-9 || s.bb[1] < c.bb[1] - 1e-9 || s.bb[3] > c.bb[3] + 1e-9) continue;
        if (inside(p[0], p[1], c.pts) || inside(s.pts[Math.floor(s.pts.length / 2)][0], s.pts[Math.floor(s.pts.length / 2)][1], c.pts)){ s.parent = c; break; }
      }
      s.depth = s.parent ? s.parent.depth + 1 : 0;
    }
    closed.forEach(s => { s.part = s.depth % 2 === 0 ? s : s.parent; });
    list.forEach(s => {
      if (s.closed) return;
      const p = s.kind === 'point' ? s.pts[0] : s.pts[Math.floor(s.pts.length / 2)];
      let best = null;
      for (let j = closed.length - 1; j >= 0; j--){ const c = closed[j]; if (inBox(c.bb, p[0], p[1]) && inside(p[0], p[1], c.pts)){ best = c; break; } }
      s.container = best;
      s.part = best ? best.part : null;
      s.depth = best ? best.depth + 1 : 0;
    });
    list.forEach(s => { s.role = s.kind === 'point' ? 'drill' : !s.closed ? 'engrave' : s.depth % 2 === 0 ? 'out' : 'in'; });
    const groups = [], gi = {};
    list.forEach(s => {
      let g = gi[s.group];
      if (!g){ g = gi[s.group] = { key: s.group, label: s.label, color: s.color, n: 0, nClosed: 0, nOpen: 0, nPoint: 0, nCircle: 0 }; groups.push(g); }
      g.n++;
      if (s.kind === 'point') g.nPoint++; else if (s.closed) g.nClosed++; else g.nOpen++;
      if (s.kind === 'circle') g.nCircle++;
    });
    groups.sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
    const bb = bboxOf([]);
    list.forEach(s => bboxOf([[s.bb[0], s.bb[1]], [s.bb[2], s.bb[3]]], bb));
    return { shapes: list, closed: closed, groups: groups, bb: bb, skipped: imp.skipped || {}, nParts: closed.filter(s => s.depth % 2 === 0).length };
  }

  // operação escolhida (sem "automático"): da linha (clique) ou da camada
  function explicitOp(s, cfg){
    const ov = cfg.overrides && cfg.overrides[s.key];
    if (ov) return ov;
    const L = cfg.layers && cfg.layers[s.group];
    return (L && L.op) || 'auto';
  }
  // peça/furo "de verdade": contornos marcados como Ignorar (ex.: moldura em volta do desenho) não contam
  function resolve(model, cfg){
    const off = s => explicitOp(s, cfg) === 'off';
    model.closed.forEach(s => { // do maior para o menor: o pai vem antes
      let p = s.parent; while (p && off(p)) p = p.parent;
      s.eParent = p; s.eDepth = p ? p.eDepth + 1 : 0;
      s.ePart = s.eDepth % 2 === 0 ? s : p.ePart;
    });
    model.shapes.forEach(s => {
      if (s.closed) return;
      let c = s.container; while (c && off(c)) c = c.parent;
      s.eParent = c; s.ePart = c ? c.ePart : null; s.eDepth = c ? c.eDepth + 1 : 0;
    });
    model.shapes.forEach(s => { s.role = s.kind === 'point' ? 'drill' : !s.closed ? 'engrave' : s.eDepth % 2 === 0 ? 'out' : 'in'; s.off = off(s); });
  }
  // peças que podem ir para o aproveitamento: contorno externo + tudo o que está dentro dele
  function partsOf(model, cfg){
    resolve(model, cfg);
    const parts = [], byKey = {}, loose = [];
    model.shapes.forEach(s => { if (s.closed && !s.off && s.ePart === s){ const p = { outer: s, members: [], area: s.area, bb: s.bb.slice() }; parts.push(p); byKey[s.key] = p; } });
    model.shapes.forEach(s => {
      if (s.off) return;
      const p = s.ePart && byKey[s.ePart.key];
      if (p) p.members.push(s); else loose.push(s);
    });
    parts.sort((a, b) => b.area - a.area);
    return { parts: parts, loose: loose };
  }

  /* ---------------- caminhos da fresa ---------------- */
  const CL = () => root.ClipperLib;
  const toCL = p => p.map(q => ({ X: Math.round(q[0] * SC), Y: Math.round(q[1] * SC) }));
  const fromCL = p => p.map(q => [q.X / SC, q.Y / SC]);
  function offsetCL(paths, delta){
    const C = CL(), co = new C.ClipperOffset(2, 0.005 * SC);
    co.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon);
    const sol = new C.Paths();
    co.Execute(sol, delta * SC);
    return sol.filter(p => p.length > 2);
  }
  function rotateTo(p, pt){ // fechado: começa no vértice mais perto de pt
    let bi = 0, bd = Infinity;
    for (let i = 0; i < p.length; i++){ const d = dist(p[i], pt); if (d < bd){ bd = d; bi = i; } }
    return bi ? p.slice(bi).concat(p.slice(0, bi)) : p.slice();
  }
  function orient(p, ccw){ const a = area(p); return (a > 0) === ccw ? p : p.slice().reverse(); }
  const OPS = { out: 'Recorte por fora', in: 'Recorte por dentro', pocket: 'Rebaixo', drill: 'Furação', engrave: 'Gravar na linha' };
  function effOp(s, cfg){
    let op = explicitOp(s, cfg);
    if (op === 'auto') op = s.role;
    return op;
  }
  function depthOf(op, L, cfg){
    const thru = cfg.sheet.t + cfg.overcut;
    const v = parseFloat(L && L.depth);
    if (v > 0) return { d: Math.min(v, thru), through: v >= cfg.sheet.t - 1e-9, clamped: v > thru };
    if (op === 'engrave') return { d: Math.min(1, thru), through: false };
    if (op === 'pocket') return { d: Math.min(3, thru), through: false };
    return { d: thru, through: true };
  }
  function toolFor(L, tools, cfg){
    const id = L && L.tool;
    for (let i = 0; i < tools.length; i++) if (tools[i].id === id) return tools[i];
    for (let i = 0; i < tools.length; i++) if (tools[i].id === cfg.defaultTool) return tools[i];
    return tools[0];
  }
  // planeja todas as operações; retorna features (na ordem de corte), avisos e caixa
  function plan(model, cfg, tools){
    const warn = [], feats = [];
    const warnOnce = {};
    const W = (k, msg) => { if (warnOnce[k]){ warnOnce[k].n++; return; } warnOnce[k] = { n: 1, msg: msg }; };
    if (!tools || !tools.length) return { feats: [], warn: ['Cadastre pelo menos uma fresa.'], bb: null, dx: 0, dy: 0 };
    const climb = cfg.dir !== 'conv';
    resolve(model, cfg);
    model.shapes.forEach(s => {
      const L = (cfg.layers && cfg.layers[s.group]) || {};
      let op = effOp(s, cfg);
      if (op === 'off') return;
      const tool = toolFor(L, tools, cfg), r = tool.d / 2;
      if ((op === 'out' || op === 'in' || op === 'pocket') && !s.closed){
        if (s.kind === 'point'){ op = 'drill'; }
        else { W('open-' + op, 'linhas abertas não podem ter "' + OPS[op] + '" (o contorno precisa ser fechado): foram gravadas na linha'); op = 'engrave'; }
      }
      if (op === 'engrave' && s.kind === 'point'){ op = 'drill'; }
      const dep = depthOf(op, L, cfg);
      if (dep.clamped) W('deep', 'profundidade maior que a chapa: limitada a ' + fmt(cfg.sheet.t + cfg.overcut) + ' mm');
      const f = { op: op, tool: tool, shape: s, depth: dep.d, through: dep.through, paths: [], tabs: [], level: s.eDepth };
      if (op === 'out' || op === 'in'){
        const res = offsetCL([toCL(s.pts)], op === 'out' ? r : -r).map(fromCL);
        if (!res.length){ W('small-' + op, 'recortes internos menores que a fresa ' + tool.name + ' (Ø ' + fmt(tool.d) + ') foram ignorados'); return; }
        res.forEach(p => {
          const isHole = area(p) < 0 && res.length > 1;
          // concordante (fresa girando horária): por fora = horário, por dentro = anti-horário
          const ccw = (op === 'in') === climb;
          f.paths.push({ pts: orient(p, isHole ? !ccw : ccw), closed: true });
        });
        f.tabsOn = cfg.tabs && cfg.tabs.on && f.through && (op === 'out' || cfg.tabs.inner);
      } else if (op === 'pocket'){
        const C = CL(), c = new C.Clipper();
        c.AddPath(toCL(s.pts), C.PolyType.ptSubject, true);
        model.shapes.forEach(ch => { if (ch.closed && !ch.off && ch.eParent === s) c.AddPath(toCL(ch.pts), C.PolyType.ptClip, true); });
        const region = new C.Paths();
        c.Execute(C.ClipType.ctDifference, region, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
        const step = Math.max(0.05, tool.d * Math.min(Math.max((tool.over || 40) / 100, 0.05), 0.95));
        let lev = offsetCL(region, -r);
        if (!lev.length){ W('small-pocket', 'rebaixos menores que a fresa ' + tool.name + ' (Ø ' + fmt(tool.d) + ') foram ignorados'); return; }
        const levels = [];
        for (let g = 0; lev.length && g < 2000; g++){ levels.push(lev); lev = offsetCL(lev, -step); }
        // de dentro para fora; concordante = sentido do Clipper (contorno externo anti-horário, ilhas horário)
        for (let li = levels.length - 1; li >= 0; li--) levels[li].forEach(p => {
          const q = fromCL(p);
          f.paths.push({ pts: climb ? q : q.slice().reverse(), closed: true, link: step * 1.6 });
        });
      } else if (op === 'drill'){
        let pt;
        if (s.kind === 'point') pt = s.pts[0];
        else if (s.kind === 'circle'){
          pt = [s.cx, s.cy];
          if (s.r * 2 > tool.d + 0.5) W('drill-big', 'furos maiores que a broca ' + tool.name + ' (Ø ' + fmt(tool.d) + '): foi furado só o centro (use "Recorte por dentro" para abrir o furo no diâmetro)');
        } else if (s.closed) pt = [(s.bb[0] + s.bb[2]) / 2, (s.bb[1] + s.bb[3]) / 2];
        else { W('drill-line', 'linhas abertas não podem ser furadas: ignoradas'); return; }
        f.paths.push({ pts: [pt], closed: false, drill: true });
      } else if (op === 'engrave'){
        f.paths.push({ pts: s.pts.slice(), closed: s.closed });
      }
      if (f.paths.length) feats.push(f);
    });
    // ordem: operações que não atravessam -> recortes, dos mais internos para os externos; agrupa por fresa; vizinho mais próximo
    const maxLevel = feats.reduce((m, f) => Math.max(m, f.level), 0);
    const cls = f => f.through && (f.op === 'out' || f.op === 'in') ? 1 + (maxLevel - f.level) : f.through && f.op === 'drill' ? 0 : 0;
    const groups = {};
    const toolOrder = [];
    feats.forEach(f => {
      const k = cls(f) + '|' + f.tool.id;
      if (!groups[k]){ groups[k] = []; if (toolOrder.indexOf(f.tool.id) < 0) toolOrder.push(f.tool.id); }
      groups[k].push(f);
    });
    // dentro de cada etapa: primeiro a fresa que já está na máquina, por último a que será usada na etapa seguinte
    const clsOf = k => +k.split('|')[0], toolOf = k => k.split('|').slice(1).join('|');
    const allKeys = Object.keys(groups), classes = [];
    allKeys.forEach(k => { if (classes.indexOf(clsOf(k)) < 0) classes.push(clsOf(k)); });
    classes.sort((a, b) => a - b);
    const keys = [];
    let mounted = null;
    classes.forEach(c => {
      const later = {};
      allKeys.forEach(k => { if (clsOf(k) > c) later[toolOf(k)] = 1; });
      const score = k => toolOf(k) === mounted ? 0 : later[toolOf(k)] ? 2 : 1;
      const ks = allKeys.filter(k => clsOf(k) === c).sort((a, b) => (score(a) - score(b)) || (toolOrder.indexOf(toolOf(a)) - toolOrder.indexOf(toolOf(b))));
      ks.forEach(k => keys.push(k));
      if (ks.length) mounted = toolOf(ks[ks.length - 1]);
    });
    const ordered = [];
    let cur = [0, 0];
    keys.forEach(k => {
      const g = groups[k].slice();
      while (g.length){
        let bi = 0, bd = Infinity;
        for (let i = 0; i < g.length; i++){
          const f = g[i], p0 = f.paths[0];
          let d = Infinity;
          if (p0.closed && !f.paths[0].link){ for (let j = 0; j < p0.pts.length; j += Math.max(1, Math.floor(p0.pts.length / 64))) d = Math.min(d, dist(cur, p0.pts[j])); }
          else d = Math.min(dist(cur, p0.pts[0]), f.op === 'engrave' && !p0.closed ? dist(cur, p0.pts[p0.pts.length-1]) : Infinity);
          if (d < bd){ bd = d; bi = i; }
        }
        const f = g.splice(bi, 1)[0];
        // ajusta o ponto de entrada
        f.paths = f.paths.map((p, idx) => {
          if (p.closed && (!p.link || idx === 0)) return { pts: rotateTo(p.pts, cur), closed: true, link: p.link };
          if (!p.closed && !p.drill && dist(cur, p.pts[p.pts.length-1]) < dist(cur, p.pts[0])) return { pts: p.pts.slice().reverse(), closed: false };
          return p;
        });
        if (f.paths[0].link){ // rebaixo: cada anel começa perto do fim do anterior
          let at = f.paths[0].pts[0];
          for (let i = 1; i < f.paths.length; i++){ f.paths[i] = { pts: rotateTo(f.paths[i].pts, at), closed: true, link: f.paths[i].link }; at = f.paths[i].pts[0]; }
        }
        ordered.push(f);
        const lp = f.paths[f.paths.length - 1];
        cur = lp.closed ? lp.pts[0] : lp.pts[lp.pts.length - 1];
      }
    });
    // pontes (tabs)
    ordered.forEach(f => {
      if (!f.tabsOn) return;
      f.paths.forEach(p => {
        const L = pathLen(p.pts, true), w = cfg.tabs.width + f.tool.d;
        let n = Math.max(1, Math.round(cfg.tabs.count || 4));
        while (n > 1 && n * w * 2.5 > L) n--;
        if (w * 2 > L){ W('tab-small', 'algumas peças são pequenas demais para pontes: foram cortadas sem pontes'); return; }
        p.tabs = [];
        for (let i = 0; i < n; i++){ const c = (i + 0.5) * L / n; p.tabs.push([c - w / 2, c + w / 2]); }
      });
    });
    // posição na chapa
    const bb = bboxOf([]);
    ordered.forEach(f => f.paths.forEach(p => bboxOf(p.pts, bb)));
    model.shapes.forEach(s => { if (effOp(s, cfg) !== 'off') bboxOf([[s.bb[0], s.bb[1]], [s.bb[2], s.bb[3]]], bb); });
    let dx = 0, dy = 0;
    if (isFinite(bb[0]) && cfg.place !== 'asis'){ dx = cfg.margin - bb[0]; dy = cfg.margin - bb[1]; }
    const pb = isFinite(bb[0]) ? [bb[0] + dx, bb[1] + dy, bb[2] + dx, bb[3] + dy] : null;
    if (pb && (pb[0] < -1e-6 || pb[1] < -1e-6 || pb[2] > cfg.sheet.w + 1e-6 || pb[3] > cfg.sheet.h + 1e-6))
      W('sheet', 'o desenho (contando a fresa) passa da chapa: ocupa ' + fmt(pb[2] - Math.min(pb[0], 0)) + ' × ' + fmt(pb[3] - Math.min(pb[1], 0)) + ' mm');
    for (const k in warnOnce) if (Object.prototype.hasOwnProperty.call(warnOnce, k)) warn.push(warnOnce[k].msg + (warnOnce[k].n > 1 ? ' (' + warnOnce[k].n + '×)' : ''));
    return { feats: ordered, warn: warn, bb: pb, dx: dx, dy: dy };
  }

  /* ---------------- G-code ---------------- */
  function fmt(v){ let s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, ''); if (s === '-0') s = '0'; return s; }
  const ACC = { 'á':'a','à':'a','â':'a','ã':'a','ä':'a','é':'e','è':'e','ê':'e','ë':'e','í':'i','ì':'i','î':'i','ï':'i','ó':'o','ò':'o','ô':'o','õ':'o','ö':'o',
    'ú':'u','ù':'u','û':'u','ü':'u','ç':'c','ñ':'n','Á':'A','À':'A','Â':'A','Ã':'A','É':'E','Ê':'E','Í':'I','Ó':'O','Ô':'O','Õ':'O','Ú':'U','Ç':'C','Ø':'D','×':'x','º':'o','ª':'a' };
  const ascii = s => String(s).replace(/[^\x20-\x7e]/g, c => ACC[c] || '').replace(/[()]/g, c => c === '(' ? '[' : ']');
  // divide um caminho fechado em trechos dentro/fora das pontes
  function splitTabs(pts, tabs){
    const out = []; // { pts:[...], tab:bool }
    const n = pts.length, all = pts.concat([pts[0]]);
    let s = 0, cur = { pts: [all[0]], tab: false }, ci = 0;
    const isTab = d => { for (let i = 0; i < tabs.length; i++) if (d > tabs[i][0] && d < tabs[i][1]) return true; return false; };
    const cuts = [];
    tabs.forEach(t => { cuts.push(t[0]); cuts.push(t[1]); });
    cuts.sort((a, b) => a - b);
    for (let i = 1; i <= n; i++){
      const a = all[i-1], b = all[i], L = dist(a, b), s1 = s + L;
      while (ci < cuts.length && cuts[ci] <= s + 1e-9 && s > 0) ci++;
      while (ci < cuts.length && cuts[ci] < s1 - 1e-9){
        const t = L > 0 ? (cuts[ci] - s) / L : 0, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        cur.pts.push(p); out.push(cur); cur = { pts: [p], tab: false }; ci++;
      }
      cur.pts.push(b);
      if (ci < cuts.length && Math.abs(cuts[ci] - s1) <= 1e-9 && i < n){ out.push(cur); cur = { pts: [b], tab: false }; ci++; }
      s = s1;
    }
    out.push(cur);
    // marca cada trecho (ponte ou não) pelo ponto do meio
    let acc = 0;
    const res = [];
    out.forEach(sg => { const L = pathLen(sg.pts, false); if (sg.pts.length > 1 && L > 1e-9){ sg.tab = isTab(acc + L / 2); res.push(sg); } acc += L; });
    return res;
  }
  function gcode(pl, cfg, tools, meta){
    const L = [], dx = pl.dx, dy = pl.dy;
    const top = cfg.zRef !== 'table';
    const Z = z => top ? z : cfg.sheet.t + z;               // z relativo ao topo da chapa
    const safe = Z(cfg.safeZ), clear = Z(1);
    const tabZ = -(cfg.sheet.t - (cfg.tabs ? cfg.tabs.height : 0));
    let x = null, y = null, z = null, F = null, len = 0, rlen = 0, tCut = 0;
    const X = v => 'X' + fmt(v + dx), Y = v => 'Y' + fmt(v + dy);
    function g0(px, py, pz){
      let s = 'G0';
      if (px !== undefined && (x === null || Math.abs(px - x) > 1e-6)) s += ' ' + X(px);
      if (py !== undefined && (y === null || Math.abs(py - y) > 1e-6)) s += ' ' + Y(py);
      if (pz !== undefined && (z === null || Math.abs(pz - z) > 1e-6)) s += ' Z' + fmt(pz);
      if (s === 'G0') return;
      if (x !== null && px !== undefined) rlen += Math.sqrt(Math.pow(px - x, 2) + Math.pow((py === undefined ? y : py) - y, 2));
      if (z !== null && pz !== undefined) rlen += Math.abs(pz - z);
      if (px !== undefined) x = px; if (py !== undefined) y = py; if (pz !== undefined) z = pz;
      L.push(s);
    }
    function g1(px, py, pz, f){
      let s = 'G1', d = 0;
      const nx = px === undefined ? x : px, ny = py === undefined ? y : py, nz = pz === undefined ? z : pz;
      if (nx !== null && (x === null || Math.abs(nx - x) > 1e-6)) s += ' ' + X(nx);
      if (ny !== null && (y === null || Math.abs(ny - y) > 1e-6)) s += ' ' + Y(ny);
      if (nz !== null && (z === null || Math.abs(nz - z) > 1e-6)) s += ' Z' + fmt(nz);
      if (s === 'G1') return;
      if (x !== null && y !== null && z !== null) d = Math.sqrt(Math.pow(nx - x, 2) + Math.pow(ny - y, 2) + Math.pow(nz - z, 2));
      if (f !== F){ s += ' F' + fmt(f); F = f; }
      len += d; tCut += d / Math.max(f, 1);
      x = nx; y = ny; z = nz;
      L.push(s);
    }
    const used = [];
    pl.feats.forEach(f => { if (used.indexOf(f.tool) < 0) used.push(f.tool); });
    const tnum = t => tools.indexOf(t) + 1;
    const d = new Date();
    L.push('(G-code Viewer v' + ascii(meta.version || '') + ' - gerado em ' + d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear() + ')');
    if (meta.name) L.push('(Desenho: ' + ascii(meta.name) + ')');
    if (meta.sheet) L.push('(Chapa ' + ascii(meta.sheet) + ')');
    L.push('(Chapa: ' + fmt(cfg.sheet.w) + ' x ' + fmt(cfg.sheet.h) + ' x ' + fmt(cfg.sheet.t) + ' mm)');
    L.push('(Origem: X0 Y0 no canto inferior esquerdo da chapa, Z0 ' + (top ? 'no topo da chapa' : 'na mesa') + ')');
    used.forEach(t => L.push('(T' + tnum(t) + ': ' + ascii(t.name) + ' - D' + fmt(t.d) + ' - S' + fmt(t.s) + ' - F' + fmt(t.f) + ' - mergulho F' + fmt(t.fz) + ' - passada ' + fmt(t.step) + ')'));
    L.push('G90 G94 G17 G21 G40 G49 G80');
    g0(undefined, undefined, safe);
    let tool = null;
    pl.feats.forEach(f => {
      const t = f.tool;
      if (t !== tool){
        if (tool){
          g0(undefined, undefined, safe);
          L.push('M5');
          L.push('(Trocar para T' + tnum(t) + ': ' + ascii(t.name) + ' - D' + fmt(t.d) + ')');
          L.push(cfg.toolChange === 'm0' ? 'M0' : 'T' + tnum(t) + ' M6');
        } else {
          L.push('(Fresa: T' + tnum(t) + ' ' + ascii(t.name) + ')');
          if (cfg.toolChange !== 'm0') L.push('T' + tnum(t) + ' M6');
        }
        L.push('M3 S' + fmt(t.s));
        tool = t;
      }
      const n = Math.max(1, Math.ceil(f.depth / Math.max(t.step, 0.01) - 1e-6));
      const zs = []; for (let k = 1; k <= n; k++) zs.push(-f.depth * k / n);
      L.push('(' + OPS[f.op] + (f.through ? ' - atravessa' : ' - prof. ' + fmt(f.depth)) + ' - ' + n + (n > 1 ? ' passadas' : ' passada') + ')');
      const enter = p => { g0(undefined, undefined, safe); g0(p[0], p[1]); g0(undefined, undefined, clear); };
      if (f.op === 'drill'){
        const p = f.paths[0].pts[0];
        enter(p);
        zs.forEach((zz, k) => {
          g1(undefined, undefined, Z(zz), t.fz);
          if (k < zs.length - 1){ g0(undefined, undefined, clear); g0(undefined, undefined, Z(zz + 0.5)); }
        });
        g0(undefined, undefined, safe);
        return;
      }
      if (f.op === 'engrave' && !f.paths[0].closed){
        let pts = f.paths[0].pts;
        enter(pts[0]);
        zs.forEach((zz, k) => {
          if (k) pts = pts.slice().reverse();
          g1(undefined, undefined, Z(zz), t.fz);
          for (let i = 1; i < pts.length; i++) g1(pts[i][0], pts[i][1], Z(zz), t.f);
        });
        g0(undefined, undefined, safe);
        return;
      }
      if (f.paths[0].link){ // rebaixo: anéis de dentro para fora, ligados sem subir quando estão perto
        zs.forEach(zz => {
          f.paths.forEach((p, i) => {
            const s0 = p.pts[0];
            if (i > 0 && dist([x, y], s0) <= p.link) g1(s0[0], s0[1], Z(zz), t.f);   // anel vizinho: liga cortando
            else {
              if (z !== null && z < clear) g0(undefined, undefined, clear);
              g0(s0[0], s0[1]);
              if (z > clear) g0(undefined, undefined, clear);
              g1(undefined, undefined, Z(zz), t.fz);
            }
            for (let k = 1; k < p.pts.length; k++) g1(p.pts[k][0], p.pts[k][1], Z(zz), t.f);
            g1(s0[0], s0[1], Z(zz), t.f);
          });
        });
        g0(undefined, undefined, safe);
        return;
      }
      // contornos fechados (recorte por fora/dentro, gravação de contorno fechado)
      f.paths.forEach(p => {
        const pts = p.pts;
        enter(pts[0]);
        const segs = p.tabs && p.tabs.length ? splitTabs(pts, p.tabs) : null;
        zs.forEach(zz => {
          g1(undefined, undefined, Z(zz), t.fz);
          if (segs && zz < tabZ - 1e-9){
            segs.forEach(sg => {
              if (sg.tab){ g1(undefined, undefined, Z(tabZ), t.fz); for (let i = 1; i < sg.pts.length; i++) g1(sg.pts[i][0], sg.pts[i][1], Z(tabZ), t.f); g1(undefined, undefined, Z(zz), t.fz); }
              else for (let i = 1; i < sg.pts.length; i++) g1(sg.pts[i][0], sg.pts[i][1], Z(zz), t.f);
            });
          } else {
            for (let i = 1; i < pts.length; i++) g1(pts[i][0], pts[i][1], Z(zz), t.f);
            g1(pts[0][0], pts[0][1], Z(zz), t.f);
          }
        });
        g0(undefined, undefined, safe);
      });
    });
    g0(undefined, undefined, safe);
    if (tool) L.push('M5');
    if (cfg.park !== false){ x = null; y = null; L.push('G0 X0 Y0'); }
    L.push('M30');
    return { text: L.join('\n') + '\n', cutLen: len, rapidLen: rlen, minutes: tCut + rlen / Math.max(cfg.rapid || 3000, 1), tools: used };
  }

  root.CAMCore = { readDXF: readDXF, readSVG: readSVG, buildModel: buildModel, plan: plan, gcode: gcode, splitTabs: splitTabs, parsePathD: parsePathD,
    area: area, pathLen: pathLen, bboxOf: bboxOf, dist: dist, effOp: effOp, explicitOp: explicitOp, resolve: resolve, partsOf: partsOf, OPS: OPS, fmt: fmt, inside: inside };
})(typeof window !== 'undefined' ? window : this);
