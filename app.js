/* Route Grouper app: reading screenshots, Mapbox, UI. Logic lives in core.js (window.RG). */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mins = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DUBLIN = { lat: 53.35, lon: -6.26 };

/* ---------- state ---------- */
const KEY = 'rg.v1';
const st = { stops: {}, geo: {}, done: {}, R: 150, M: null, grouped: true, view: 'list' };
let token = '', orsKey = '', res = null, busy = false;
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); token = localStorage.getItem('rg.token') || ''; orsKey = localStorage.getItem('rg.ors') || ''; } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
const stopsArr = () => Object.values(st.stops).sort((a, b) => a.n - b.n);

function status(text, err) { const el = $('#status'); el.textContent = text || ''; el.className = err ? 'status err' : 'status'; }
function progress(text) { const p = $('#busy'); if (text) { p.hidden = false; $('#busyText').textContent = text; } else p.hidden = true; }

/* ---------- reading screenshots ---------- */
let textWorker = null, pinWorker = null;
async function workers() {
  if (!textWorker) {
    progress('Loading the text reader (first time only, about 10 MB)…');
    textWorker = await Tesseract.createWorker('eng', 1);
    await textWorker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
    pinWorker = await Tesseract.createWorker('eng', 1);
    await pinWorker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789' });
  }
}

function loadImage(file) {
  return new Promise((ok, bad) => { const img = new Image(); img.onload = () => ok(img); img.onerror = bad; img.src = URL.createObjectURL(file); });
}

/** Finds the dark stop-number markers in the left column and returns cropped, cleaned-up images of each. */
function findPins(canvas) {
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d', { willReadFrequently: true });
  const x0 = Math.floor(W * 0.03), x1 = Math.floor(W * 0.16), cw = x1 - x0;
  const data = ctx.getImageData(x0, 0, cw, H).data;
  const g = new Uint8Array(cw * H);
  for (let i = 0; i < cw * H; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const runs = [];
  for (let y = 0; y < H; y++) {
    let c = 0; for (let x = 0; x < cw; x++) if (g[y * cw + x] < 140) c++;
    if (c > W * 0.012) { const r = runs[runs.length - 1]; if (r && y - r[1] <= 6) r[1] = y; else runs.push([y, y]); }
  }
  const out = [];
  for (const [s, e] of runs) {
    const h = e - s; if (h < H * 0.02 || h > H * 0.06) continue;
    let lo = cw, hi = 0;
    for (let y = s; y <= e; y += 2) for (let x = 0; x < cw; x++) if (g[y * cw + x] < 140) { if (x < lo) lo = x; if (x > hi) hi = x; }
    const pw = hi - lo + 1, ph = h + 1, S = 3, B = 30;
    const small = document.createElement('canvas'); small.width = pw; small.height = ph;
    const sctx = small.getContext('2d'), id = sctx.createImageData(pw, ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const v = g[(s + y) * cw + lo + x] > 170 ? 0 : 255, k = (y * pw + x) * 4;   // light digits become black on white
      id.data[k] = id.data[k + 1] = id.data[k + 2] = v; id.data[k + 3] = 255;
    }
    sctx.putImageData(id, 0, 0);
    const big = document.createElement('canvas'); big.width = pw * S + B * 2; big.height = ph * S + B * 2;
    const bctx = big.getContext('2d'); bctx.fillStyle = '#fff'; bctx.fillRect(0, 0, big.width, big.height);
    bctx.imageSmoothingEnabled = false; bctx.drawImage(small, B, B, pw * S, ph * S);
    // Variant B: tight box around the light digits, inverted, enlarged smoothly. Reads far more reliably.
    let dx0 = pw, dx1 = -1, dy0 = ph, dy1 = -1;
    for (let y = Math.floor(ph * 0.08); y < ph * 0.75; y++) for (let x = Math.floor(pw * 0.12); x < pw * 0.88; x++)
      if (g[(s + y) * cw + lo + x] > 170) { if (x < dx0) dx0 = x; if (x > dx1) dx1 = x; if (y < dy0) dy0 = y; if (y > dy1) dy1 = y; }
    let tight = null;
    if (dx1 >= 0) {
      dx0 = Math.max(0, dx0 - 3); dy0 = Math.max(0, dy0 - 3); dx1 = Math.min(pw - 1, dx1 + 3); dy1 = Math.min(ph - 1, dy1 + 3);
      const tw = dx1 - dx0 + 1, th = dy1 - dy0 + 1, S4 = 4, B4 = 40;
      const inv = document.createElement('canvas'); inv.width = tw; inv.height = th;
      const ictx = inv.getContext('2d'), iid = ictx.createImageData(tw, th);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const v = 255 - g[(s + dy0 + y) * cw + lo + dx0 + x], k = (y * tw + x) * 4;
        iid.data[k] = iid.data[k + 1] = iid.data[k + 2] = v; iid.data[k + 3] = 255;
      }
      ictx.putImageData(iid, 0, 0);
      tight = document.createElement('canvas'); tight.width = tw * S4 + B4 * 2; tight.height = th * S4 + B4 * 2;
      const tctx = tight.getContext('2d', { willReadFrequently: true });
      tctx.fillStyle = '#fff'; tctx.fillRect(0, 0, tight.width, tight.height);
      tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(inv, B4, B4, tw * S4, th * S4);
      const td = tctx.getImageData(0, 0, tight.width, tight.height);
      for (let k = 0; k < td.data.length; k += 4) { const v = td.data[k] < 128 ? 0 : 255; td.data[k] = td.data[k + 1] = td.data[k + 2] = v; }
      tctx.putImageData(td, 0, 0);
    }
    out.push({ top: s / H, canvas: big, tight });
  }
  return out;
}

function linesFrom(data) {
  let lines = data.lines;
  if (!lines && data.blocks) lines = data.blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines));
  return lines || [];
}

async function readScreenshot(file) {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  URL.revokeObjectURL(img.src);
  const W = canvas.width, H = canvas.height;
  const { data } = await textWorker.recognize(canvas);
  const lines = linesFrom(data).map(l => ({ text: l.text.replace(/\s+/g, ' ').trim(), minX: l.bbox.x0 / W, top: l.bbox.y0 / H, bottom: l.bbox.y1 / H })).filter(l => l.text);
  const found = findPins(canvas), pins = found.map(p => ({ top: p.top, reads: [] }));
  const digits = r => (r.data.text || '').replace(/\D/g, '');
  for (const [psm, which, w] of [['8', 'tight', 3], ['7', 'tight', 1], ['7', 'canvas', 1]]) {
    await pinWorker.setParameters({ tessedit_pageseg_mode: psm });
    for (let i = 0; i < found.length; i++) {
      const c = found[i][which];
      if (c) pins[i].reads.push({ text: digits(await pinWorker.recognize(c)), w });
    }
  }
  if (window.RG_DEBUG) window.RG_DEBUG.push(pins.map(p => p.reads.map(r => r.text)));
  return RG.parseScreen(lines, pins);
}

async function addScreenshots(files) {
  files = [...files].filter(f => /^image\//.test(f.type));
  if (!files.length) return;
  busy = true; render();
  try {
    await workers();
    let found = 0;
    const fresh = new Set(), clash = new Set();
    for (let i = 0; i < files.length; i++) {
      progress(`Reading screenshot ${i + 1} of ${files.length}…`);
      for (const s of await readScreenshot(files[i])) {
        const old = st.stops[s.n];
        if (old && fresh.has(s.n) && RG.stopKey(old) !== RG.stopKey(s)) clash.add(s.n);   // two screenshots disagree
        st.stops[s.n] = s; fresh.add(s.n); found++;
      }
    }
    save();
    if (!found) { status('No stops found. Use Itinerary List screenshots with the stop numbers and addresses visible.', true); return; }
    status(clash.size ? `Read ${found} stops, but stop${clash.size > 1 ? 's' : ''} ${[...clash].join(', ')} came out differently on two screenshots. Check ${clash.size > 1 ? 'them' : 'it'} against Flex.` : `Read ${found} stops.`, clash.size > 0);
    busy = false;
    await check();
  } catch (e) {
    console.error(e); status("Couldn't read the screenshots. Check your connection the first time (the text reader downloads once) and try again.", true);
  } finally { busy = false; progress(''); render(); }
}

/* ---------- Mapbox ---------- */
async function mb(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url);
    if (r.status === 401 || r.status === 403) throw new Error('token');
    if (r.status === 429) { await sleep(3000); continue; }
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }
  throw new Error('rate');
}

async function geocode(stop, near) {
  const u = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  u.search = new URLSearchParams({ q: RG.query(stop).slice(0, 250), country: 'ie', types: 'address', limit: '1', proximity: `${near.lon},${near.lat}`, access_token: token });
  const j = await mb(u);
  const f = j.features && j.features[0];
  if (!f) return { miss: 1 };
  const [lon, lat] = f.geometry.coordinates;
  const num = f.properties && f.properties.context && f.properties.context.address && f.properties.context.address.address_number;
  const house = RG.houseNumber(stop);
  return { lat, lon, exact: !!house && String(num || '').toUpperCase() === house };
}

/**
 * Road driving times and distances between every pair of doors, from OpenRouteService (free; over its limits it
 * returns an error, it never bills). A free key allows 3,500 pairs per request, so a 90-door route takes 3 requests.
 */
async function matrix(points, onStep) {
  const n = points.length, T = [...Array(n)].map(() => Array(n).fill(1e6)), D = [...Array(n)].map(() => Array(n).fill(1e6));
  for (let i = 0; i < n; i++) { T[i][i] = 0; D[i][i] = 0; }
  let per = Math.max(1, Math.min(n, Math.floor(3500 / n)));
  const locations = points.map(p => [+p.lon.toFixed(6), +p.lat.toFixed(6)]);
  for (let start = 0, step = 0; start < n;) {
    const sources = [...Array(Math.min(per, n - start)).keys()].map(j => start + j);
    onStep(++step, Math.ceil((n - start) / per) + step - 1);
    const r = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
      method: 'POST',
      headers: { Authorization: orsKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ locations, sources, metrics: ['duration', 'distance'] })
    });
    if (r.status === 401 || r.status === 403) throw new Error('orskey');
    if (r.status === 429) { await sleep(3000); continue; }                       // per-minute limit: wait and retry
    if (r.status === 400 && per > 1) { per = Math.ceil(per / 2); continue; }     // too many pairs: ask for fewer
    if (!r.ok) throw new Error('ors ' + r.status);
    const j = await r.json();
    sources.forEach((gi, ri) => {
      for (let gj = 0; gj < n; gj++) {
        const t = j.durations && j.durations[ri] && j.durations[ri][gj], d = j.distances && j.distances[ri] && j.distances[ri][gj];
        if (t != null) T[gi][gj] = t; if (d != null) D[gi][gj] = d;
      }
    });
    start += sources.length;
  }
  return { T, D, approx: false };
}

/** Without an OpenRouteService key: straight line x 1.35 at about 30 km/h. Rough, but costs nothing. */
function approxMatrix(points) {
  const n = points.length, T = [...Array(n)].map(() => Array(n).fill(0)), D = [...Array(n)].map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) { const d = RG.haversine(points[i], points[j]) * 1.35; D[i][j] = d; T[i][j] = 20 + d / 8.3; }
  return { T, D, approx: true };
}

async function check(force) {
  if (!token) { status('Add your free Mapbox token in Settings to find addresses and distances.', true); openSettings(); return; }
  if (busy) return;
  busy = true; render();
  try {
    if (force) { for (const k in st.geo) if (st.geo[k].miss) delete st.geo[k]; st.M = null; }
    const firstOf = new Map(); for (const s of stopsArr()) { const k = RG.stopKey(s); if (!firstOf.has(k)) firstOf.set(k, s); }
    const todo = [...firstOf.entries()].filter(([k]) => !st.geo[k]);
    const known = Object.values(st.geo).find(g => g.lat != null);
    let near = known ? { lat: known.lat, lon: known.lon } : DUBLIN, done = 0;
    for (let i = 0; i < todo.length; i += 4) {        // a few at a time
      progress(`Finding addresses on the map: ${Math.min(i + 4, todo.length)} of ${todo.length}…`);
      const batch = todo.slice(i, i + 4);
      const out = await Promise.all(batch.map(([, s]) => geocode(s, near)));
      batch.forEach(([k], j) => { st.geo[k] = out[j]; if (out[j].lat != null) near = out[j]; });
      done += batch.length;
    }
    // a match more than 25 km from the rest is almost certainly the wrong place
    const pts = Object.values(st.geo).filter(g => g.lat != null);
    if (pts.length >= 3) {
      const med = v => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
      const mid = { lat: med(pts.map(p => p.lat)), lon: med(pts.map(p => p.lon)) };
      for (const k in st.geo) { const g = st.geo[k]; if (g.lat != null && RG.haversine(mid, g) > 25000) st.geo[k] = { miss: 1, far: 1 }; }
    }
    save();
    const doors = RG.buildDoors(stopsArr(), st.geo).filter(d => d.geo);
    const keys = doors.map(d => d.key);
    const upgrade = st.M && st.M.approx && orsKey;           // a key was added since the rough estimate
    if (keys.length >= 2 && (!(st.M && st.M.keys.join('~') === keys.join('~')) || upgrade)) {
      const m = orsKey ? await matrix(doors.map(d => d.geo), (p, n) => progress(`Measuring road distances: ${p} of ${n}…`))
                       : approxMatrix(doors.map(d => d.geo));
      st.M = { keys, T: m.T, D: m.D, approx: m.approx }; save();
    }
    st.grouped = true;
    const miss = RG.buildDoors(stopsArr(), st.geo).filter(d => !d.geo).length;
    status(miss ? `${miss} address${miss > 1 ? 'es' : ''} couldn't be found on the map and stay where Flex put ${miss > 1 ? 'them' : 'it'}.` : 'Route checked.');
  } catch (e) {
    console.error(e);
    status(e.message === 'token' ? "Mapbox didn't accept the token. Check it in Settings."
      : e.message === 'orskey' ? "OpenRouteService didn't accept the key. Check it in Settings."
      : /^ors/.test(e.message) ? "Couldn't get road distances from OpenRouteService. Try again in a minute."
      : "Couldn't reach Mapbox. Check your signal and tap Check again.", true);
  } finally { busy = false; progress(''); save(); render(); }
}

/* ---------- route ---------- */
let resKey = '';
function solveNow() {
  const stops = stopsArr(); if (!st.M || !stops.length) return null;
  const doors = RG.buildDoors(stops, st.geo);
  const located = doors.filter(d => d.geo).map(d => d.key);
  if (located.join('~') !== st.M.keys.join('~')) return null;           // map data is for a different set of doors
  const k = st.R + '|' + stops.map(s => s.n + RG.stopKey(s)).join(',') + '|' + st.M.keys.length;
  if (k === resKey && res) return res;
  resKey = k; res = RG.solve(doors, stops, st.M, st.R); return res;
}
function parks() {
  const r = solveNow();
  if (r) return st.grouped && r.worth ? r.grouped : r.flex;
  return RG.buildDoors(stopsArr(), st.geo).map(d => ({ spot: d, doors: [d], walk: {}, maxWalk: 0 }));
}
const parkDone = p => p.doors.every(d => st.done[d.key]);
const gmaps = d => {
  const dest = d.geo ? `${d.geo.lat.toFixed(6)},${d.geo.lon.toFixed(6)}` : RG.query(d.stops[0]);
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(dest);
};
const NAV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 20 21l-8-4-8 4z" fill="currentColor"/></svg>';
const navBtn = (d, label) => `<a class="nav" href="${esc(gmaps(d))}" target="_blank" rel="noopener" aria-label="Directions to Flex stop ${esc(d.badge)}">${NAV}${label || ''}</a>`;

/* ---------- render ---------- */
function render() {
  const stops = stopsArr(), has = stops.length > 0;
  $('#empty').hidden = has; $('#route').hidden = !has;
  $('#tokenNote').hidden = !!token;
  document.querySelectorAll('[data-r]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.r === st.R));
  $('#checkBtn').disabled = busy || !has;
  if (!has) { renderNext([]); return; }
  const r = solveNow(), P = parks();
  // verdict
  let v;
  if (!r) v = `<div class="verdict"><h2>${busy ? 'Checking your route…' : 'Not checked yet'}</h2><p>${token ? 'Tap <b>Check route</b> to compare with Flex.' : 'Add your free Mapbox token in Settings first.'}</p></div>`;
  else if (r.worth) {
    const drv = r.saved >= 60 ? ` Driving is about ${mins(r.saved)} shorter too.` : r.saved <= -60 ? ` Driving is about ${mins(-r.saved)} longer, but you're out of the van far less.` : '';
    v = `<div class="verdict win"><h2>Park <em>${r.grouped.length} times</em> instead of ${r.flex.length}</h2><p>That's ${r.flex.length - r.grouped.length} fewer times in and out of the van, walking up to ${st.R} m from where you park.${drv}</p>`;
  } else v = `<div class="verdict same"><h2>Flex's order is <em>already fine</em></h2><p>Grouping only gets you to ${r.grouped.length} parking stops versus ${r.flex.length} with Flex's order, so follow Flex and park once wherever doors are close.</p>`;
  if (r) v += `<div class="tiles"><div><b>${r.flex.length} → ${r.grouped.length}</b><small>times you park</small></div><div><b>${mins(r.flexDrive)} → ${mins(r.groupedDrive)}</b><small>driving</small></div><div><b>${r.doorCount}</b><small>doors (${r.stopCount} stops)</small></div></div></div>`;
  $('#verdict').innerHTML = v;
  // notes
  const ns = stops.map(s => s.n), miss = [];
  for (let i = ns[0]; i < ns[ns.length - 1]; i++) if (!st.stops[i]) miss.push(i);
  const dl = stops.filter(RG.hasDeadline), notes = [];
  if (ns[0] > 1) notes.push(`The first stop read is ${ns[0]}, so this compares from stop ${ns[0]} onwards.`);
  if (miss.length) notes.push(`Missing stop${miss.length > 1 ? 's' : ''} ${miss.slice(0, 20).join(', ')}${miss.length > 20 ? '…' : ''}. Add a screenshot that covers ${miss.length > 1 ? 'them' : 'it'}.`);
  if (st.M && st.M.approx) notes.push('Distances are rough straight-line estimates. Add a free OpenRouteService key in <a href="#" class="openSettings">Settings</a> for real road distances.');
  if (dl.length) notes.push(`Stops with a deadline: ${dl.map(s => `${s.n} (${esc(s.deadline)})`).join(', ')}. Make sure the grouped order still gets there in time.`);
  $('#notes').innerHTML = notes.map(t => `<p class="note">${t}</p>`).join('');
  // order + view toggles
  $('#orderSeg').hidden = !(r && r.worth);
  $('#oGrouped').setAttribute('aria-pressed', st.grouped); $('#oFlex').setAttribute('aria-pressed', !st.grouped);
  $('#vList').setAttribute('aria-pressed', st.view === 'list'); $('#vMap').setAttribute('aria-pressed', st.view === 'map');
  $('#list').hidden = st.view !== 'list'; $('#mapWrap').hidden = st.view !== 'map';
  if (st.view === 'list') $('#list').innerHTML = P.map(parkHTML).join('');
  else renderMap(P);
  renderNext(P);
}

function doorHTML(d, p) {
  const dn = !!st.done[d.key], meta = [];
  if (p.doors.length > 1) meta.push(d.key === p.spot.key ? 'park here' : `${Math.round(p.walk[d.key] || 0)} m walk`);
  if (d.repeat) meta.push(`<span class="hot">repeat address, Flex stops ${d.ns.join(' and ')}</span>`);
  if (!d.geo) meta.push('not found on map'); else if (d.geo.exact === false) meta.push('map pin approximate');
  if (d.deadline) meta.push(`<span class="hot">${esc(d.deadline)}</span>`);
  return `<div class="door${dn ? ' done' : ''}${d.repeat ? ' rep' : ''}" data-k="${esc(d.key)}" role="checkbox" aria-checked="${dn}" tabindex="0">
    <span class="badge"><small>STOP</small>${esc(d.badge)}</span>
    <span class="txt"><b>${esc(d.display)}</b><span class="meta">${meta.join(' · ')}</span></span>
    <span class="right"><span class="pc">${d.parcels} pc</span>${p.doors.length > 1 ? '' : navBtn(d)}</span></div>`;
}
function parkHTML(p, i) {
  const multi = p.doors.length > 1, pc = p.doors.reduce((t, d) => t + d.parcels, 0);
  return `<section class="park${parkDone(p) ? ' pdone' : ''}"><header><span class="pnum">P${i + 1}</span><span class="ptxt">${multi ? `<b>Park once, ${p.doors.length} doors</b><small>by ${esc(p.spot.display)} · ${pc} parcels · furthest ${Math.round(p.maxWalk)} m</small>` : `<b>${p.offMap ? 'Single stop · not on map' : 'Single stop'}</b>`}</span>${multi ? navBtn(p.spot, 'Park') : ''}</header>${p.doors.map(d => doorHTML(d, p)).join('')}</section>`;
}
function renderNext(P) {
  const bar = $('#next'), i = P.findIndex(p => !parkDone(p)), p = P[i];
  bar.hidden = !p; document.body.classList.toggle('hasnext', !!p);
  if (!p) return;
  const left = p.doors.filter(d => !st.done[d.key]).length;
  bar.innerHTML = `<span class="t"><small>Next · park ${i + 1} of ${P.length}${p.doors.length > 1 ? ` · ${left} door${left > 1 ? 's' : ''} on foot` : ''}</small><b>${p.doors.length > 1 ? 'By ' : ''}${esc(p.spot.display)}</b></span>${navBtn(p.spot, 'Go')}`;
}

/* ---------- map (Leaflet) ---------- */
let map = null, layer = null, tileLayer = null, tileToken = null;
function renderMap(P) {
  if (!window.L) { $('#map').innerHTML = '<p class="note">The map needs a connection the first time.</p>'; return; }
  if (!map) {
    map = L.map('map', { zoomControl: true, attributionControl: true });
    layer = L.layerGroup().addTo(map);
  }
  if (tileToken !== token || !tileLayer) {
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = token
      ? L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${encodeURIComponent(token)}`, { tileSize: 512, zoomOffset: -1, maxZoom: 20, attribution: '© Mapbox © OpenStreetMap' })
      : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
    tileLayer.addTo(map); tileToken = token;
  }
  layer.clearLayers();
  const pts = [];
  const line = P.map(p => p.spot.geo).filter(Boolean).map(g => [g.lat, g.lon]);
  if (line.length > 1) L.polyline(line, { color: '#ff5a1f', weight: 3, dashArray: '8 6', opacity: .85 }).addTo(layer);
  P.forEach((p, i) => p.doors.forEach(d => {
    if (!d.geo) return;
    const spot = p.doors.length > 1 && d.key === p.spot.key, dn = !!st.done[d.key];
    const icon = L.divIcon({ className: '', iconSize: null, html: `<span class="pin${spot || i === 0 ? ' hot' : ''}${spot ? ' sq' : ''}${dn ? ' dn' : ''}">${esc(d.badge)}</span>` });
    const m = L.marker([d.geo.lat, d.geo.lon], { icon, title: `Flex stop ${d.badge}` }).addTo(layer);
    m.bindPopup(`<div class="pop"><b>Stop ${esc(d.badge)}</b><br>${esc(d.display)}<br><small>Park ${i + 1}${spot ? ' (park here)' : p.doors.length > 1 ? `, ${Math.round(p.walk[d.key] || 0)} m walk` : ''} · ${d.parcels} parcel${d.parcels > 1 ? 's' : ''}</small><div class="popbtns">${navBtn(d, 'Directions')}<button data-done="${esc(d.key)}">${dn ? 'Undo done' : 'Mark done'}</button></div></div>`);
    pts.push([d.geo.lat, d.geo.lon]);
  }));
  setTimeout(() => { map.invalidateSize(); if (pts.length && !map._fitted) { map.fitBounds(pts, { padding: [30, 30] }); map._fitted = true; } }, 50);
}

/* ---------- settings ---------- */
function openSettings() { $('#tokenInput').value = token; $('#orsInput').value = orsKey; $('#settings').showModal(); }
$('#settingsBtn').onclick = openSettings;
$('#tokenLink').onclick = e => { e.preventDefault(); openSettings(); };
$('#notes').addEventListener('click', e => { if (e.target.closest('.openSettings')) { e.preventDefault(); openSettings(); } });
$('#saveSettings').onclick = e => {
  e.preventDefault();
  token = $('#tokenInput').value.trim();
  orsKey = $('#orsInput').value.trim();
  try { localStorage.setItem('rg.token', token); localStorage.setItem('rg.ors', orsKey); } catch (x) {}
  $('#settings').close(); render();
};
$('#closeSettings').onclick = () => $('#settings').close();
document.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { st.R = +b.dataset.r; st.grouped = true; save(); render(); });
let armed = false;
$('#newRoute').onclick = () => {
  if (!armed) { armed = true; $('#newRoute').textContent = 'Tap again to clear'; setTimeout(() => { armed = false; $('#newRoute').textContent = 'New route'; }, 3000); return; }
  armed = false; $('#newRoute').textContent = 'New route';
  st.stops = {}; st.done = {}; st.geo = {}; st.M = null; res = null; resKey = ''; if (map) map._fitted = false;
  save(); $('#settings').close(); status(''); render();
};

/* ---------- events ---------- */
for (const id of ['#file', '#file2']) $(id).addEventListener('change', e => { const f = e.target.files; addScreenshots(f).then(() => { e.target.value = ''; }); });
$('#checkBtn').onclick = () => check(true);
$('#oGrouped').onclick = () => { st.grouped = true; save(); if (map) map._fitted = false; render(); };
$('#oFlex').onclick = () => { st.grouped = false; save(); if (map) map._fitted = false; render(); };
$('#vList').onclick = () => { st.view = 'list'; save(); render(); };
$('#vMap').onclick = () => { st.view = 'map'; save(); render(); };
const toggleDoor = k => { if (st.done[k]) delete st.done[k]; else st.done[k] = 1; save(); render(); };
$('#list').addEventListener('click', e => { if (e.target.closest('a')) return; const d = e.target.closest('.door'); if (d) toggleDoor(d.dataset.k); });
$('#list').addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && e.target.classList.contains('door')) { e.preventDefault(); toggleDoor(e.target.dataset.k); } });
$('#map').addEventListener('click', e => { const b = e.target.closest('[data-done]'); if (b) { map.closePopup(); toggleDoor(b.dataset.done); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
})();
