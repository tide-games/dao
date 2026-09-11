// The Season DAO — a venue of the fleet (#189).
//
// Pure static. The book lives in Tideholm's ledger and is read from its
// public, CORS-open /api/dao. Buying is a signed trail move exactly like a
// tavern stake: a NEGATIVE delta on the sealed balance whose evidence names
// this venue ({venue:'dao', mark, stake, shares}). The move rides home in a
// URL and Tideholm's Redeem burns the gold and credits the shares. This page
// never sees a key it can keep: the tidegate's keySigner signs in-browser.
//
// The slip segment is SHARED with the tavern and the den — same origin,
// same localStorage key — so one purse follows the player across the fleet,
// and every venue cuts it at the trail's tip on arrival (see cutSlip).

import { cutSlip } from 'https://tide-games.github.io/tavern/tavern.js';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const API = (q.get('api') || 'https://nostr.social/tideholm').replace(/\/+$/, '');
const MAX_BUY = 100000;          // one signed move — mirrors the server's DAO_MAX_BUY
const SLIP_CAP = 22;             // moves; the courier home takes ~24 at most

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB');
const pct = (n, d) => d ? (100 * n / d) : 0;
const when = (t) => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------- the seal
const SEAL = (() => {
  const did = (q.get('did') || '').trim().toLowerCase();
  if (!/^did:nostr:[0-9a-f]{64}$/.test(did)) return null;
  return {
    did,
    seal: Math.max(0, Math.floor(Number(q.get('seal')) || 0)),
    tip: (q.get('tip') || '').trim() || null,
    ret: q.get('return') || 'https://nostr.social/tideholm/',
  };
})();
const segKey = () => 'tavern-seal-' + SEAL.did.slice(-8);
function loadSeg() {
  try { const s = JSON.parse(localStorage.getItem(segKey())); if (s && Number.isFinite(s.base) && Array.isArray(s.txs)) return s; } catch { /* fresh */ }
  return { base: SEAL.seal, txs: [] };
}
function saveSeg(s) { localStorage.setItem(segKey(), JSON.stringify(s)); }
function purse() { const s = loadSeg(); return s.base + s.txs.reduce((a, t) => a + t.delta, 0); }
const b64url = (x) => btoa(unescape(encodeURIComponent(x))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let _tools = null;
async function sealTools() {
  if (_tools) return _tools;
  const base = 'https://melvincarvalho.github.io/tidegate/';
  const [core, keys] = await Promise.all([import(base + 'tidegate.js'), import(base + 'keys.js')]);
  const signer = await keys.keySigner();
  if (signer.pubkey !== SEAL.did.slice('did:nostr:'.length)) throw new Error('the stored key does not match this identity');
  _tools = { core, signer };
  return _tools;
}
async function signBuy(shares) {
  const { core, signer } = await sealTools();
  const s = loadSeg();
  const prev = s.base + s.txs.reduce((a, t) => a + t.delta, 0);
  const t = { did: SEAL.did, prev, delta: -shares, next: prev - shares };
  t.sig = await signer.sign(core.transitionBytes(t));
  t.pubkey = signer.pubkey;
  const mark = [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, '0')).join('');
  t.bet = { venue: 'dao', mark, stake: shares, shares }; // evidence rides OUTSIDE the signature, by design
  s.txs.push(t);
  saveSeg(s);
  return t;
}

// ---------------------------------------------------------------- the book
let book = null;
async function loadBook() {
  const r = await fetch(`${API}/api/dao`, { cache: 'no-store' });
  if (!r.ok) throw new Error('the book could not be read (' + r.status + ')');
  book = await r.json();
  return book;
}

function mine() {
  if (!SEAL || !book) return null;
  return book.holders.find((h) => h.key === SEAL.did) || null;
}

// ---------------------------------------------------------------- charts (all SVG, all by hand)
const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, text) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};
function defs() {
  const d = el('defs');
  const g1 = el('linearGradient', { id: 'areaGold', x1: 0, y1: 0, x2: 0, y2: 1 });
  g1.append(el('stop', { offset: '0%', 'stop-color': '#e0a92a', 'stop-opacity': .45 }), el('stop', { offset: '100%', 'stop-color': '#e0a92a', 'stop-opacity': .04 }));
  const g2 = el('linearGradient', { id: 'barGold', x1: 0, y1: 0, x2: 1, y2: 0 });
  g2.append(el('stop', { offset: '0%', 'stop-color': '#7a5806' }), el('stop', { offset: '100%', 'stop-color': '#e0a92a' }));
  const g3 = el('linearGradient', { id: 'barYou', x1: 0, y1: 0, x2: 1, y2: 0 });
  g3.append(el('stop', { offset: '0%', 'stop-color': '#154f66' }), el('stop', { offset: '100%', 'stop-color': '#2a86a8' }));
  d.append(g1, g2, g3);
  return d;
}
function niceMax(v) {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// The sale: cumulative shares over time, an area under a line, with the
// day ticks the sale actually spans.
function drawSale(series, supply) {
  const host = $('#sale-chart');
  host.innerHTML = '';
  if (!series || series.length < 1) { host.innerHTML = '<div class="empty">No shares have been bought yet. The first line of the season is still unwritten.</div>'; return; }
  const W = 900, H = 300, L = 60, R = 18, T = 16, B = 34;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'shares sold over time' });
  svg.append(defs());
  const pts = series.slice();
  const t0 = pts[0].at, t1 = Math.max(pts[pts.length - 1].at, t0 + 3600e3);
  const ymax = niceMax(Math.max(pts[pts.length - 1].sold * 1.15, 10));
  const x = (t) => L + (W - L - R) * ((t - t0) / (t1 - t0));
  const y = (v) => T + (H - T - B) * (1 - v / ymax);
  // grid + y labels
  for (let i = 0; i <= 4; i++) {
    const v = ymax * i / 4, yy = y(v);
    svg.append(el('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'grid' }));
    svg.append(el('text', { x: L - 8, y: yy + 4, 'text-anchor': 'end', class: 'axis' }, fmt(v)));
  }
  // x ticks: up to 6 evenly spaced times
  const n = Math.min(6, Math.max(2, pts.length));
  for (let i = 0; i < n; i++) {
    const t = t0 + (t1 - t0) * i / (n - 1);
    svg.append(el('text', { x: x(t), y: H - 10, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', class: 'axis' }, when(t)));
  }
  // step path: a sale is a staircase, not a slope
  let d = `M ${x(t0)} ${y(0)}`;
  let prev = 0;
  for (const p of pts) { d += ` L ${x(p.at)} ${y(prev)} L ${x(p.at)} ${y(p.sold)}`; prev = p.sold; }
  d += ` L ${x(t1)} ${y(prev)}`;
  svg.append(el('path', { d: d + ` L ${x(t1)} ${y(0)} Z`, class: 'area' }));
  svg.append(el('path', { d, class: 'line' }));
  for (const p of pts.slice(-40)) svg.append(el('circle', { cx: x(p.at), cy: y(p.sold), r: 3.2, class: 'dot' }));
  // the supply line, if it is in frame
  if (supply <= ymax) {
    svg.append(el('line', { x1: L, x2: W - R, y1: y(supply), y2: y(supply), stroke: '#a02020', 'stroke-dasharray': '6 4' }));
    svg.append(el('text', { x: W - R, y: y(supply) - 5, 'text-anchor': 'end', class: 'axis', fill: '#a02020' }, 'sold out'));
  }
  host.append(svg);
}

// Who holds the season: horizontal bars, longest first, you in sea-blue.
function drawHolders(holders, supply) {
  const host = $('#holders-chart');
  host.innerHTML = '';
  if (!holders.length) { host.innerHTML = '<div class="empty">Nobody holds the season yet.</div>'; return; }
  const rows = holders.slice(0, 12);
  const W = 900, rowH = 34, L = 150, R = 90, T = 8;
  const H = T + rows.length * rowH + 8;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'shares by holder' });
  svg.append(defs());
  const max = rows[0].shares;
  const w = (v) => Math.max(3, (W - L - R) * v / max);
  rows.forEach((h, i) => {
    const yy = T + i * rowH;
    const you = SEAL && h.key === SEAL.did;
    svg.append(el('text', { x: L - 10, y: yy + 22, 'text-anchor': 'end', class: 'hname' }, (you ? '★ ' : '') + h.name));
    const bar = el('rect', { x: L, y: yy + 6, width: 0, height: rowH - 12, class: 'hbar' + (you ? ' you' : '') });
    svg.append(bar);
    requestAnimationFrame(() => { bar.style.transition = 'width .9s cubic-bezier(.2,.8,.2,1)'; bar.setAttribute('width', w(h.shares)); });
    const share = pct(h.shares, supply);
    const inside = w(h.shares) > 70;
    svg.append(el('text', { x: inside ? L + 8 : L + w(h.shares) + 8, y: yy + 22, class: inside ? 'pct-lbl' : 'hval' }, share.toFixed(share >= 10 ? 1 : 2) + '%'));
    svg.append(el('text', { x: W - 4, y: yy + 22, 'text-anchor': 'end', class: 'hval' }, fmt(h.shares)));
  });
  host.append(svg);
  if (holders.length > rows.length) $('#holders-caption').textContent += ` Showing the top ${rows.length} of ${holders.length}.`;
}

// ---------------------------------------------------------------- render
function render() {
  const b = book;
  $('#season-badge').textContent = `Season ${b.season}`;
  $('#sold-big').textContent = fmt(b.sold);
  $('#supply-big').textContent = fmt(b.supply);
  const p = pct(b.sold, b.supply);
  requestAnimationFrame(() => { $('#bar-fill').style.width = Math.max(p, b.sold ? 0.4 : 0) + '%'; });
  $('#pct-label').textContent = (p < 1 && p > 0 ? p.toFixed(2) : p.toFixed(1)) + '% held';
  $('#remaining-label').textContent = fmt(b.remaining) + ' unsold';
  $('#api-link').href = `${API}/api/dao`;
  drawSale(b.series, b.supply);
  drawHolders(b.holders, b.supply);
  const led = $('#ledger');
  led.innerHTML = '';
  if (!b.ledger.length) led.innerHTML = '<li class="muted" style="list-style:none;margin-left:-1.4em">Nothing yet. The first buy of the season writes the first line.</li>';
  for (const e of b.ledger.slice().reverse().slice(0, 20)) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="who"></span> bought <span class="n"></span> shares for <span class="n g"></span> gold<span class="when"></span>`;
    li.querySelector('.who').textContent = e.name;
    li.querySelector('.n').textContent = fmt(e.shares);
    li.querySelector('.n.g').textContent = fmt(e.gold);
    li.querySelector('.when').textContent = when(e.at);
    led.appendChild(li);
  }
  renderYou();
}

function renderYou() {
  if (!SEAL) return;
  $('#you-hint').classList.add('hidden');
  $('#you-grid').classList.remove('hidden');
  $('#buy').classList.remove('hidden');
  const me = mine();
  $('#you-purse').textContent = fmt(purse());
  $('#you-shares').textContent = fmt(me ? me.shares : 0);
  $('#you-pct').textContent = (me ? pct(me.shares, book.supply) : 0).toFixed(3) + '%';
  const s = loadSeg();
  const slip = $('#slip');
  if (s.txs.length) {
    const net = s.txs.reduce((a, t) => a + t.delta, 0);
    const bought = s.txs.filter((t) => t.bet && t.bet.venue === 'dao').reduce((a, t) => a + t.bet.shares, 0);
    slip.classList.remove('hidden');
    slip.innerHTML = `Your slip carries <strong>${s.txs.length}</strong> signed move${s.txs.length > 1 ? 's' : ''}, net <strong>${net >= 0 ? '+' : ''}${fmt(net)}</strong> gold`
      + (bought ? ` — <strong>${fmt(bought)}</strong> shares waiting to land` : '') + `.<br>`
      + `<a class="settle" href="${SEAL.ret}?tavern=${b64url(JSON.stringify(s.txs))}">Settle up at Tideholm ↗</a> <span class="muted">— shares appear in the book when the slip is redeemed.</span>`;
  } else slip.classList.add('hidden');
  updateCost();
}

function updateCost() {
  const n = Math.floor(Number($('#shares').value)) || 0;
  $('#cost').textContent = fmt(n);
  const note = $('#buy-note');
  note.className = 'note';
  const s = loadSeg();
  const limit = Math.min(purse(), book ? book.remaining : MAX_BUY, MAX_BUY);
  $('#sign').disabled = !(n >= 1 && n <= limit) || s.txs.length >= SLIP_CAP;
  if (s.txs.length >= SLIP_CAP) { note.textContent = `Your slip already carries ${s.txs.length} moves — settle up first, then come back.`; note.classList.add('bad'); }
  else if (n > purse()) { note.textContent = `The purse holds ${fmt(purse())} — the sea takes no IOUs.`; note.classList.add('bad'); }
  else if (book && n > book.remaining) { note.textContent = `Only ${fmt(book.remaining)} shares are left this season.`; note.classList.add('bad'); }
  else if (n > MAX_BUY) { note.textContent = `At most ${fmt(MAX_BUY)} shares in one signed move.`; note.classList.add('bad'); }
  else note.textContent = '';
}

// ---------------------------------------------------------------- the till
// The prize is paid from one address in testnet4 sats. Its balance is read
// straight from the explorer, mempool included — the chain is the receipt.
const TILL = 'tb1peza8n3sgrcs88nl3k3wqsv8wmxlmlatmnhxccazfhxaps6a672gq2l258w';
async function loadTill() {
  const el = $('#till-balance');
  if (!el) return;
  try {
    const j = await (await fetch(`https://mempool.guide/testnet4/api/address/${TILL}`, { cache: 'no-store' })).json();
    const c = j.chain_stats, m = j.mempool_stats;
    const confirmed = c.funded_txo_sum - c.spent_txo_sum, pending = m.funded_txo_sum - m.spent_txo_sum;
    el.textContent = fmt(confirmed + pending) + ' sat' + (pending ? ` (${fmt(pending)} unconfirmed)` : '');
  } catch { el.textContent = 'balance unavailable'; }
}

// ---------------------------------------------------------------- boot
(async () => {
  loadTill();
  setInterval(loadTill, 120000);
  if (SEAL && q.has('seal')) {
    // Arrival from the tidegate: cut the shared slip at the trail's tip.
    const s0 = loadSeg();
    const r = cutSlip(s0, { seal: SEAL.seal, tip: SEAL.tip });
    if (r.archived.length) localStorage.setItem(segKey() + (r.reason === 'stale' ? '-stale-' : '-settled-') + Date.now(), JSON.stringify({ base: s0.base, txs: r.archived }));
    if (r.reason !== 'unchanged' && r.reason !== 'nomatch' && r.reason !== 'unsettled') saveSeg(r.seg);
    if (r.reason === 'stale') {
      const net = r.archived.reduce((a, t) => a + t.delta, 0);
      $('#buy-note').textContent = `A slip from an earlier visit could not follow the seal — the tidegate moved on while it was open. ${r.archived.length} unsettled move${r.archived.length > 1 ? 's' : ''} (net ${net >= 0 ? '+' : ''}${fmt(net)}) set aside; the purse starts fresh at ${fmt(SEAL.seal)}.`;
      $('#buy-note').classList.add('bad');
    }
  }
  try { await loadBook(); } catch (e) {
    $('#sale-chart').innerHTML = `<div class="empty">${e.message}</div>`;
    $('#holders-chart').innerHTML = '';
    return;
  }
  render();
  setInterval(async () => { try { await loadBook(); render(); } catch { /* keep the last book */ } }, 60000);

  if (!SEAL) return;
  $('#shares').addEventListener('input', updateCost);
  $('#max').addEventListener('click', () => { $('#shares').value = Math.max(0, Math.min(purse(), book.remaining, MAX_BUY)); updateCost(); });
  $('#buy').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const n = Math.floor(Number($('#shares').value)) || 0;
    const note = $('#buy-note');
    note.className = 'note';
    if (!(n >= 1) || n > purse() || n > book.remaining || n > MAX_BUY) { updateCost(); return; }
    $('#sign').disabled = true;
    note.textContent = 'signing…';
    try {
      await signBuy(n);
      // The seal in the URL is now stale: drop it so a reload cannot re-cut
      // the slip against an unsettled purse (same rule as the den).
      if (q.has('seal')) { q.delete('seal'); history.replaceState(null, '', location.pathname + '?' + q.toString()); }
      note.textContent = `Signed: ${fmt(n)} shares for ${fmt(n)} gold. Settle up at Tideholm and they land in the book.`;
      note.classList.add('good');
    } catch (e) {
      note.textContent = 'Could not sign — ' + (e.message || 'signing declined') + '. Nothing has moved.';
      note.classList.add('bad');
    }
    renderYou();
  });
})();
