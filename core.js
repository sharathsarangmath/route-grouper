// Route Grouper core logic: screenshot parsing, address matching, parking-stop solver.
// Pure functions only, so it can be tested outside the browser.
(function (root) {
  'use strict';

  /* ---------- parsing Flex "Itinerary List" text ---------- */
  const isDeliveries = s => /\d+\s+deliver(y|ies)/i.test(s);
  const isHeader = s => s.startsWith('#') || /deliver by/i.test(s) || /next stop/i.test(s) || /^[#\s]*B\d+-\w+/i.test(s);
  const isArea = s => { const L = s.replace(/[^A-Za-z]/g, ''); return L.length >= 3 && L === L.toUpperCase(); };
  const numBefore = (re, s) => { const m = s.match(new RegExp('(\\d+)\\s+' + re, 'i')); return m ? parseInt(m[1], 10) : null; };

  /**
   * lines: [{text, minX, top, bottom}] in 0..1 screen units (top = 0)
   * pins:  [{reads: [{text, w}], top}] stop-number markers found in the left column, each read a few ways
   * Stop numbers on one screenshot always go up by one, so the readable ones vote on the first number.
   */
  function parseScreen(lines, pins) {
    const title = lines.find(l => /itinerary/i.test(l.text));
    const topCut = title ? title.bottom + 0.05 : 0.15;
    const cs = lines.find(l => /current stop/i.test(l.text));
    const bottomCut = cs ? cs.top : 0.87;
    const P = pins.filter(p => p.top > topCut && p.top < bottomCut).sort((a, b) => a.top - b.top);
    const votes = new Map();
    P.forEach((p, i) => {
      // each marker is read a few ways; every reading votes, the most reliable way counts triple
      for (const r of (p.reads || [{ text: p.text, w: 1 }])) {
        const n = parseInt(r.text, 10);
        if (n > 0 && n - i > 0) votes.set(n - i, (votes.get(n - i) || 0) + (r.w || 1));
      }
    });
    if (!votes.size) return [];
    const first = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const content = lines.filter(l => l.minX > 0.12 && l.top > topCut && l.top < bottomCut).sort((a, b) => a.top - b.top);
    const stops = [];
    P.forEach((p, i) => {
      const start = p.top - 0.03, end = i + 1 < P.length ? P[i + 1].top - 0.03 : bottomCut;
      const block = content.filter(l => l.top >= start && l.top < end);
      const d = block.findIndex(l => isDeliveries(l.text));
      if (d < 0) return;                                   // cut off at the bottom
      const deadlineLine = block.find(l => /deliver by/i.test(l.text));
      const addr = block.slice(0, d).map(l => l.text.trim()).filter(t => t && !isHeader(t));
      if (!addr.length) return;
      let area = '';
      if (addr.length > 1 && isArea(addr[addr.length - 1])) area = addr.pop();
      const dl = block[d].text;
      stops.push({
        n: first + i, lines: addr, area,
        parcels: numBefore('parcels?', dl) || numBefore('deliver(?:y|ies)', dl) || 1,
        deadline: deadlineLine ? deadlineLine.text.replace(/^.*?(deliver by)/i, 'Deliver by').trim() : ''
      });
    });
    return stops;
  }

  /* ---------- addresses ---------- */
  const ABBR = { rd: 'road', st: 'street', ave: 'avenue', av: 'avenue', dr: 'drive', ct: 'court', pk: 'park', gr: 'grove', cres: 'crescent', apt: 'apartment', hts: 'heights', lwr: 'lower', upr: 'upper', sq: 'square', pl: 'place' };
  const tokens = lines => lines.join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(t => ABBR[t] || t);
  const stopKey = s => [...new Set(tokens(s.lines))].sort().join(' ');
  const houseNumber = s => { for (const l of s.lines) for (const w of l.split(/\s+/)) { const t = w.replace(/[^\w]/g, ''); if (/^\d{1,4}[A-Za-z]?$/.test(t)) return t.toUpperCase(); } return null; };
  const tidy = s => s.split(/\s+/).map(w => /^\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const display = s => s.lines.map(tidy).join(', ');
  const query = s => [...s.lines, s.area, 'Ireland'].filter(Boolean).join(', ');
  const hasDeadline = s => !!s.deadline && /deliver by/i.test(s.deadline) && !/end of/i.test(s.deadline);

  function haversine(a, b) {
    const R = 6371e3, r = x => x * Math.PI / 180, dl = r(b.lat - a.lat), dn = r(b.lon - a.lon);
    const s = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** Merge stops into doors: same words in any order, or same house number within 12 m on the map. */
  function buildDoors(stops, geo) {
    const sorted = [...stops].sort((a, b) => a.n - b.n), byKey = new Map();
    for (const s of sorted) {
      const k = stopKey(s);
      if (byKey.has(k)) byKey.get(k).stops.push(s);
      else byKey.set(k, { key: k, stops: [s], geo: geo[k] && geo[k].lat != null ? geo[k] : null });
    }
    const out = [];
    for (const d of byKey.values()) {
      const h = houseNumber(d.stops[0]);
      const m = d.geo && h ? out.find(o => o.geo && houseNumber(o.stops[0]) === h && haversine(o.geo, d.geo) < 12) : null;
      if (m) m.stops.push(...d.stops); else out.push(d);
    }
    for (const d of out) {
      d.ns = d.stops.map(s => s.n).sort((a, b) => a - b);
      d.first = d.ns[0];
      d.parcels = d.stops.reduce((t, s) => t + s.parcels, 0);
      d.display = display(d.stops[0]);
      d.badge = d.ns.join('+');
      d.repeat = d.stops.length > 1;
      const dl = d.stops.find(hasDeadline);
      d.deadline = dl ? dl.deadline : '';
    }
    return out.sort((a, b) => a.first - b.first);
  }

  /* ---------- solver ---------- */
  function pathCost(p, T) { let c = 0; for (let i = 1; i < p.length; i++) c += T[p[i - 1]][p[i]]; return c; }

  /** 2-opt plus or-opt, first element fixed (that's where Flex starts). */
  function improve(p, T, until) {
    let best = pathCost(p, T), imp = true;
    while (imp && Date.now() < until) {
      imp = false;
      for (let i = 1; i < p.length - 1 && Date.now() < until; i++) for (let j = i + 1; j < p.length; j++) {
        const q = p.slice(0, i).concat(p.slice(i, j + 1).reverse(), p.slice(j + 1)), c = pathCost(q, T);
        if (c < best - 0.5) { p = q; best = c; imp = true; }
      }
      for (let L = 1; L <= 3; L++) for (let i = 1; i + L <= p.length && Date.now() < until; i++) {
        const seg = p.slice(i, i + L), rest = p.slice(0, i).concat(p.slice(i + L));
        for (let j = 1; j <= rest.length; j++) {
          if (j === i) continue;
          const q = rest.slice(0, j).concat(seg, rest.slice(j)), c = pathCost(q, T);
          if (c < best - 0.5) { p = q; best = c; imp = true; break; }
        }
      }
    }
    return { p, c: best };
  }

  function nearest(first, items, cost) {
    const out = [first], left = new Set(items.filter(x => x !== first));
    while (left.size) { const l = out[out.length - 1]; let b = -1, bc = Infinity; for (const j of left) if (cost(l, j) < bc) { bc = cost(l, j); b = j; } out.push(b); left.delete(b); }
    return out;
  }

  /**
   * doors: from buildDoors; stops: all stops; M: {keys, T (seconds), D (metres)}; R: walk limit in metres.
   * Groups doors into parking stops, orders them for least driving, and scores Flex's order with the same walking rule.
   */
  function solve(doors, stops, M, R) {
    const n = M.keys.length;
    const W = M.D.map((row, i) => row.map((v, j) => Math.min(v, M.D[j][i])));     // road distance, either way
    const idx = new Map(M.keys.map((k, i) => [k, i])), byKey = new Map(doors.map(d => [d.key, d]));
    const doorOf = new Map(); for (const d of doors) for (const s of d.stops) doorOf.set(s.n, d.key);
    const sorted = [...stops].sort((a, b) => a.n - b.n);
    const flexSeq = sorted.map(s => idx.get(doorOf.get(s.n))).filter(i => i !== undefined);
    const seen = new Set(), flexU = flexSeq.filter(i => !seen.has(i) && seen.add(i));
    const D = i => byKey.get(M.keys[i]);
    const mkPark = (spot, members, order) => {
      const o = order || nearest(spot, members, (a, b) => W[a][b]);
      const walk = {}; for (const j of o) walk[M.keys[j]] = W[spot][j];
      return { spot: D(spot), doors: o.map(D), walk, maxWalk: Math.max(...o.map(j => W[spot][j])) };
    };
    // Flex, scored fairly: keep walking from the van while the next door is within R
    const fg = [];
    for (const i of flexSeq) {
      const cur = fg[fg.length - 1];
      if (cur && W[cur.spot][i] <= R) { if (!cur.m.includes(i)) cur.m.push(i); } else fg.push({ spot: i, m: [i] });
    }
    const flex = fg.map(g => mkPark(g.spot, g.m, g.m));
    const flexDrive = pathCost(fg.map(g => g.spot), M.T);
    // Grouped: greedy cover, each parking spot takes every unassigned door within R
    const left = new Set(flexU), groups = [];
    while (left.size) {
      let best = -1, cov = [], worst = Infinity;
      for (const i of [...left].sort((a, b) => a - b)) {
        const c = [...left].filter(j => W[i][j] <= R), w = Math.max(...c.map(j => W[i][j]));
        if (c.length > cov.length || (c.length === cov.length && w < worst)) { best = i; cov = c; worst = w; }
      }
      groups.push({ spot: best, m: cov }); cov.forEach(j => left.delete(j));
    }
    const gi = groups.findIndex(g => g.m.includes(flexU[0]));
    if (gi > 0) groups.unshift(groups.splice(gi, 1)[0]);
    const PT = groups.map(a => groups.map(b => M.T[a.spot][b.spot]));
    const all = [...groups.keys()], until = Date.now() + 3000;
    const a = improve(all, PT, until), b = improve(nearest(0, all, (x, y) => PT[x][y]), PT, until + 1500);
    const order = a.c <= b.c ? a.p : b.p;
    const grouped = order.map(k => mkPark(groups[k].spot, groups[k].m));
    const groupedDrive = pathCost(order.map(k => groups[k].spot), M.T);
    // doors not found on the map: their own stop, right after their Flex predecessor
    for (const d of doors.filter(x => !idx.has(x.key))) {
      const prev = sorted.filter(s => s.n < d.first).reverse().map(s => doorOf.get(s.n)).find(k => idx.has(k));
      for (const list of [flex, grouped]) {
        const pos = prev ? list.findIndex(p => p.doors.some(x => x.key === prev)) : -1;
        list.splice(pos + 1, 0, { spot: d, doors: [d], walk: {}, maxWalk: 0, offMap: true });
      }
    }
    const fewer = flex.length - grouped.length, saved = flexDrive - groupedDrive;
    const worth = fewer >= Math.max(2, Math.round(flex.length * 0.05)) || saved >= Math.max(180, flexDrive * 0.05);
    return { flex, grouped, flexDrive, groupedDrive, worth, fewer, saved, stopCount: stops.length, doorCount: doors.length, n };
  }

  root.RG = { parseScreen, stopKey, houseNumber, display, query, hasDeadline, haversine, buildDoors, solve, improve, pathCost, tidy };
})(typeof window !== 'undefined' ? window : globalThis);
