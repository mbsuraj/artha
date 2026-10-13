'use strict';
// Scenario planner. Page 1: define assets. Page 2: place them on a timeline and see the result.
const KEY = 'investmentplanner.v1';          // separate from the original calculator's storage
const HORIZONS = [5, 10, 15, 20, 25, 30, 35, 40];

const ASSUME_FIELDS = [
  ['maintGrowth','Maintenance rises (% a year)',1], ['taxGrowth','Tax rises (% a year)',1],
  ['insGrowth','Insurance rises (% a year)',1],
  ['rentStepPct','Rent rises (%)',1], ['rentStepYears','...every (years)',3],
  ['apprStepPct','Value rises (%)',1], ['apprStepYears','...every (years)',3],
  ['sellCostPct','Selling fee (%)',0],
];
const ASSET_FIELDS = [
  ['loan','Loan remaining ($)'], ['termMonths','Term remaining (months)'], ['rate','Interest rate (APR %)'],
  ['equity','Current equity ($)'], ['rent','Annual rent ($)'],
  ['maintenance','Annual maintenance ($)'], ['tax','Annual tax ($)'], ['insurance','Annual insurance ($)'],
  ['fx','Units per $1 today'], ['fxGrowth','Currency vs $ (% a year, − = weaker)'],
];
// A potential asset has no fixed loan: you pick the down payment when you place the buy, and
// loan = price - down payment. So it takes a purchase price plus loan terms, costs and income.
const POT_FIELDS = [['price','Purchase price ($)'],
  ...ASSET_FIELDS.filter(f => f[0] !== 'loan' && f[0] !== 'equity').map(f =>
    f[0] === 'termMonths' ? ['termMonths','Loan term (months)'] :
    f[0] === 'rate' ? ['rate','Loan interest rate (APR %)'] :
    f[0] === 'rent' ? ['rent','Annual rent, first year owned ($)'] : f)];
const ASSET_DEFAULTS = { currency:'USD', fx:1, fxGrowth:0 };
const ASSUME_DEFAULTS = Object.fromEntries(ASSUME_FIELDS.map(f => [f[0], f[2]]));

const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const uid = () => 'a' + Math.random().toString(36).slice(2, 9);
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const codeOf = x => String(x.currency || 'USD').trim().toUpperCase() || 'USD';

// ---------- State ----------
const DEFAULT = {
  horizon: 30, startCash: 100000, display: 'USD',
  assets: [
    {name:'Home', status:'current', loan:300000, termMonths:300, rate:6.5, equity:150000, rent:0, maintenance:4000, tax:6000, insurance:1800},
    {name:'Commercial unit', status:'current', loan:200000, termMonths:180, rate:7.25, equity:100000, rent:30000, maintenance:3000, tax:4000, insurance:1500},
    {name:'Rental condo', status:'potential', loan:250000, termMonths:360, rate:6.75, equity:60000, rent:24000, maintenance:2500, tax:3500, insurance:1200},
  ],
};
// Validate a plan object against an asset's status. Returns a clean plan or undefined.
// `equityDown` is the fallback down payment for a buy when none was recorded.
function cleanPlan(p, status, equityDown) {
  if (!(p && Number.isInteger(+p.year) && +p.year >= 1)) return undefined;
  if (status === 'current' && p.action === 'sell') return { action: 'sell', year: +p.year };
  if (status === 'potential' && p.action === 'buy')
    return { action: 'buy', year: +p.year, down: Math.max(0, +p.down >= 0 ? +p.down : equityDown || 0) };
  return undefined;
}
function normalizeState(st) {
  st.assets = st.assets.map(x => {
    const status = x.status === 'potential' ? 'potential' : 'current';
    const plan = cleanPlan(x.plan, status, +x.equity || 0);
    // Plan B is a scratch "what-if" plan kept alongside Plan A for side-by-side comparison.
    // It is never written to saved scenario files (stripped in saveCurrent).
    const planB = cleanPlan(x.planB, status, +x.equity || 0);
    // Files from the original calculator keep assumptions globally (st.assumptions) with optional
    // per-asset overrides. Fold them into each asset's own assumptions.
    const price = x.price != null ? +x.price || 0 : (+x.loan || 0) + (+x.equity || 0);   // older potential assets had loan + equity
    const o = { ...x, id: x.id || uid(), status, price,
      assume: { ...ASSUME_DEFAULTS, ...(st.assumptions || {}), ...(x.overrides || {}), ...(x.assume || {}) } };
    delete o.overrides;
    if (plan) o.plan = plan; else delete o.plan;
    if (planB) o.planB = planB; else delete o.planB;
    return o;
  });
  delete st.assumptions;
  st.horizon = +st.horizon || 30;
  st.startCash = +st.startCash || 0;
  st.includeOps = !!st.includeOps;   // false: cash only moves when you buy or sell
  st.cashYield = st.cashYield != null && isFinite(+st.cashYield) ? Math.max(0, +st.cashYield) : 4;   // %/yr on unused cash
  st.display = String(st.display || 'USD').toUpperCase();
  delete st.displayB;                    // old currency-compare feature, replaced by plan compare
  st.compareOn = !!st.compareOn;         // side-by-side plan comparison on (scratch UI state, not saved to scenarios)
  return st;
}
let state;
try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
if (!state || !Array.isArray(state.assets)) state = clone(DEFAULT);
normalizeState(state);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

// ---------- Display currency ----------
let DISP = { code:'USD', fx:1, fxGrowth:0 };
const money = (n, code) => (n < 0 ? '-' : '') + (code === 'USD' ? '$' : code + ' ') + Math.abs(Math.round(n)).toLocaleString();
const usd = n => money(n, DISP.code);          // the left / only side
function dispFor(code) {
  const src = code === 'USD' ? null : state.assets.find(x => codeOf(x) === code);
  return src ? { code, fx: +src.fx > 0 ? +src.fx : 1, fxGrowth: +src.fxGrowth || 0 } : { code:'USD', fx:1, fxGrowth:0 };
}
function resolveDisplay() { DISP = dispFor(state.display); }

// ---------- Page 1: assets ----------
function assetCard(a, i) {
  const pot = a.status === 'potential', cur = a.currency || 'USD';
  const label = ([k, l]) => l.replace('($)', '(' + cur + ')');
  return `
    <div class="card inner">
      <div class="asset-head">
        <div><label>Name</label><input data-i="${i}" data-k="name" value="${esc(a.name)}"></div>
        <div style="flex:0 0 130px"><label>Status</label>
          <select data-i="${i}" data-k="status"><option value="current" ${pot ? '' : 'selected'}>Current</option><option value="potential" ${pot ? 'selected' : ''}>Potential</option></select></div>
        <div style="flex:0 0 110px"><label>Currency code</label><input data-i="${i}" data-k="currency" maxlength="6" value="${esc(cur)}"></div>
        <button data-del="${i}">Remove</button>
      </div>
      <div class="grid">${(pot ? POT_FIELDS : ASSET_FIELDS).map(f => `<div><label>${label(f)}</label><input type="number" step="any" ${f[0] === 'fxGrowth' ? '' : 'min="0"'} data-i="${i}" data-k="${f[0]}" value="${a[f[0]] ?? ASSET_DEFAULTS[f[0]] ?? 0}"></div>`).join('')}</div>
      ${pot ? `<div class="sub" style="margin:8px 0 0">Loan = price − the down payment you pick when buying.</div>` : ''}
      <div style="margin-top:12px"><label style="font-weight:600">Assumptions for this asset</label></div>
      <div class="grid" style="margin-top:6px">${ASSUME_FIELDS.map(([k, l]) => `<div><label>${l}</label><input type="number" step="any" min="0" data-i="${i}" data-s="${k}" value="${(a.assume || {})[k] ?? ASSUME_DEFAULTS[k]}"></div>`).join('')}</div>
    </div>`;
}
function renderAssets() {
  if (document.activeElement !== $('cashYield')) $('cashYield').value = state.cashYield;
  $('assets').innerHTML = state.assets.length ? state.assets.map(assetCard).join('')
    : '<div class="sub">No assets yet.</div>';
}

// ---------- Model ----------
function effective(asset) {
  const step = (v, d) => Math.max(1, +v || d);
  const e = { ...ASSUME_DEFAULTS, ...(asset.assume || {}) };
  return { ...e, rentStepYears: step(e.rentStepYears, 3), apprStepYears: step(e.apprStepYears, 3) };
}
function numericAsset(x) {
  const o = {}; [...ASSET_FIELDS.map(f => f[0]), 'price'].forEach(k => o[k] = +x[k] || 0);
  if (!(o.fx > 0)) o.fx = 1;
  return o;
}
// Where an asset sits on the timeline, from its status and the given plan (Plan A's x.plan, or an entry from planB).
function placement(x, T, plan) {
  const p = plan, y = p ? Math.round(+p.year) : 0;
  if (x.status === 'potential') return p && p.action === 'buy' && y >= 1 && y <= T ? { start:y, buy:true } : { start:T + 1, buy:true, skipped:true };
  return p && p.action === 'sell' && y >= 1 && y <= T ? { start:1, sellYear:y } : { start:1 };
}
// Cash available for a down payment at the start of year y, in US dollars (cash is held in USD). This is
// the same cash the cash chart shows at that moment: starting cash + interest earned on unused cash in earlier
// years + proceeds of assets sold at or before y - down payments already planned for other assets (+ rent minus
// all costs in the years before y, when "include rent and running costs" is on). Returns the total and the lines.
function cashSources(m, y, skip) {
  const lines = [{ kind:'start', amount: m.startUsd }];
  let before = m.startUsd;           // nominal cash through the end of year y-1, without interest
  if (y > 1 && m.includeOps) {
    const ops = m.resUsd.reduce((t, r, j) => j === skip ? t : t + r.rows.slice(0, y - 1).reduce((q, row) => q + row.netCashFlow, 0), 0);
    lines.push({ kind:'ops', years: y - 1, amount: ops }); before += ops;
  }
  const events = [];
  m.resUsd.forEach((r, j) => {
    if (j === skip) return;
    if (r.events.sell && r.events.sell.year <= y) events.push({ kind:'sale', j, year: r.events.sell.year, amount: r.events.sell.amount });
    if (r.events.buy && r.events.buy.year <= y) events.push({ kind:'buy', j, year: r.events.buy.year, amount: -r.events.buy.amount });
  });
  events.forEach(e => { if (e.year < y) before += e.amount; });
  // interest on unused cash through year y-1 = the chart's cash at the end of y-1 minus everything above
  const interest = y > 1 ? m.wealth[y - 1].cashUsd - before : 0;
  if (Math.abs(interest) > 0.005) lines.push({ kind:'interest', years: y - 1, amount: interest });
  lines.push(...events);
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}
const availableCash = (m, y, skip) => cashSources(m, y, skip).total;
// The plan for an asset on a given side: 'A' = the saved default (x.plan), 'B' = the what-if (x.planB).
const planKey = side => side === 'B' ? 'planB' : 'plan';
const planOf = (x, side) => x[planKey(side)];
// side 'A' (default) is primary and sets the global DISP; side 'B' is the comparison plan.
// Both sides use the same display currency (chosen from the single dropdown).
function buildModel(side) {
  side = side || 'A';
  if (side === 'A') resolveDisplay();
  const d = DISP;
  const T = Math.max(1, Math.round(state.horizon));
  const project = d => state.assets.map(x => {
    const na = numericAsset(x), pl = planOf(x, side);
    if (x.status === 'potential') {   // loan = price - the down payment chosen for the buy
      const down = Math.min(Math.max(+(pl && pl.down) || 0, 0), na.price);
      na.equity = down; na.loan = na.price - down;
    }
    return Engine.scenarioAsset(na, effective(x), T, d, placement(x, T, pl));
  });
  const res = project(d);                          // for charts, in the display currency
  const resUsd = d.code === 'USD' ? res : project({ fx:1, fxGrowth:0 });   // cash is kept in USD
  const wealth = Engine.wealthPath(state.startCash, resUsd, res, d, T, state.includeOps, state.cashYield);
  return { T, res, resUsd, wealth, disp: d, side, startUsd: state.startCash, includeOps: state.includeOps, cashYield: state.cashYield };
}

// ---------- Page 2: timeline ----------
const loc = (n, cur) => cur + ' ' + Math.round(n).toLocaleString();
function eventText(x, r, T, m, i) {
  const pl = planOf(x, m.side);
  if (x.status === 'potential') {
    if (!r.events.buy) return 'Not buying';
    const cur = codeOf(x), price = +x.price || 0, down = Math.min(+(pl && pl.down) || 0, price);
    const short = m.resUsd[i].events.buy.amount > Math.max(0, availableCash(m, r.events.buy.year, i)) + 0.5;
    return `Buy in year ${r.events.buy.year} · down ${loc(down, cur)} · loan ${loc(price - down, cur)}` +
      (short ? ' <span style="color:var(--c-interest)">⚠ not enough cash</span>' : '');
  }
  if (!r.events.sell) return 'Keep';
  const a = r.events.sell.amount;
  return `Sell in year ${r.events.sell.year} · ${a < 0 ? 'you pay ' + usd(-a) : 'you get ' + usd(a)}`;
}
function renderTimeline(m) {
  const { T, res, side } = m;
  const years = Array.from({ length: T }, (_, i) => i + 1);
  const cols = `grid-template-columns:repeat(${T},1fr)`;
  const tick = y => (T <= 15 || y === 1 || y % 5 === 0) ? y : '';
  let html = `<div class="tl-row"><div class="tl-label"><span class="sub" style="margin:0">Year →</span></div>
    <div class="tl-ruler" style="${cols}">${years.map(y => `<div>${tick(y)}</div>`).join('')}</div><div></div></div>`;
  state.assets.forEach((x, i) => {
    const r = res[i], pot = x.status === 'potential', pl = planOf(x, side);
    const bar = r.n > 0 ? `<div class="bar ${pot ? 'potential' : 'current'}" style="left:${(r.start - 1) / T * 100}%;width:${r.n / T * 100}%"></div>` : '';
    const mk = (r.events.buy ? `<div class="mk buy" style="left:${(r.events.buy.year - 1) / T * 100}%">BUY</div>` : '') +
               (r.events.sell ? `<div class="mk sell" style="left:${(r.events.sell.year - 1) / T * 100}%">SELL</div>` : '');
    const hint = pot && !r.events.buy ? '<div class="hint">Click a year to buy</div>' : '';
    // Deleting an asset affects both plans, so that control only lives on the Plan A timeline.
    const actions = (pl ? `<button data-clear="${x.id}" data-side="${side}">Reset</button>` : '') +
      (side === 'A' ? `<button data-rm="${x.id}" title="Delete this asset">✕</button>` : '');
    html += `<div class="tl-row">
      <div class="tl-label"><b>${esc(x.name)}</b> <span class="badge ${x.status}">${x.status}</span>
        <div class="sub" style="margin:2px 0 0">${eventText(x, r, T, m, i)}</div></div>
      <div class="tl-track" style="${cols}">${years.map(y => `<div class="cell" data-cell="1" data-id="${x.id}" data-y="${y}" data-side="${side}" title="${esc(x.name)}, year ${y}"></div>`).join('')}${bar}${mk}${hint}</div>
      <div class="tl-actions">${actions}</div>
    </div>`;
  });
  $(side === 'B' ? 'timelineB' : 'timeline').innerHTML = html;
}
let menuCtx = null;
function menuPreview() {
  const c = menuCtx; if (!c) return;
  const d = parseFloat($('mDown').value), ok = d >= 0 && d <= c.cap + 1e-6;
  const loan = ok ? c.price - d : 0, pmt = ok ? Engine.monthlyPayment(loan, c.rate, c.term) : 0;
  $('mInfo').innerHTML = ok
    ? `Loan: ${loc(loan, c.cur)}${c.term ? ` · ${loc(pmt, c.cur)} a month` : ''}`
    : `<span style="color:var(--c-interest)">Pick 0 to ${loc(c.cap, c.cur)}</span>`;
  $('mBuy').disabled = !ok;
  // Cash at the end of the buy year if you do this: the cash chart's figure, including that year's rent and costs
  if (ok) {
    const na = { ...c.asset, equity: d, loan: c.price - d };
    const r = Engine.scenarioAsset(na, c.eff, c.T, { fx:1, fxGrowth:0 }, { start: c.y, buy: true });
    const left = c.availUsd - d * Engine.usdPerLocal(c.asset, c.t0);          // cash right after the purchase
    const end = left + (state.cashYield || 0) / 100 * Math.max(0, left) + (state.includeOps ? r.rows[c.y - 1].netCashFlow + c.othersOpsUsd : 0);
    const f = (end < 0 ? '−$' : '$') + Math.abs(Math.round(end)).toLocaleString();
    $('mEnd').innerHTML = `Cash at the end of year ${c.y}: <b${end < 0 ? ' style="color:var(--c-interest)"' : ''}>${f}</b>${end < 0 ? ' · short on cash' : ''}`;
  } else $('mEnd').innerHTML = '';
}
function openMenu(id, y, ev, side) {
  side = side || 'A';
  const key = planKey(side);
  const x = state.assets.find(a => a.id === id); if (!x) return;
  const menu = $('menu'); menuCtx = null;
  if (x.status === 'potential') {
    // How much cash would there be at the start of that year, without this purchase?
    const saved = x[key], i = state.assets.indexOf(x);
    delete x[key]; let m; try { m = buildModel(side); } finally { if (saved) x[key] = saved; }
    const asset = numericAsset(x), t0 = y - 1, cur = codeOf(x);
    const src = cashSources(m, y, i);
    // US dollars -> this asset's currency, at the exchange rate in force at the purchase
    const toLocal = v => v / Engine.usdPerLocal(asset, t0);
    const availLocal = Math.max(0, toLocal(src.total));
    const cap = Math.floor(Math.min(asset.price, availLocal) * 100) / 100;
    const def = saved && saved.action === 'buy' ? Math.min(+saved.down || 0, cap) : cap;   // start from everything available
    // Each line keeps its sign so the lines add up to the total. A sale can be negative when the loan
    // is larger than the sale value.
    const signed = v => (v < 0 ? '−' : '+') + loc(Math.abs(toLocal(v)), cur);
    const sum = src.lines.map(l => {
      const nm = l.j !== undefined ? esc(state.assets[l.j].name) : '';
      const label = l.kind === 'start' ? 'Starting cash' : l.kind === 'interest' ? 'Interest earned' : l.kind === 'ops' ? 'Rent minus costs' : l.kind === 'sale' ? `Sold ${nm} (after loan & fees)` : `Down payment, ${nm}`;
      return `<div style="display:flex;justify-content:space-between;gap:12px"><span>${label}</span><span>${l.kind === 'start' ? loc(toLocal(l.amount), cur) : signed(l.amount)}</span></div>`;
    }).join('');
    menuCtx = { id, y, side, cap, price: asset.price, cur, rate: asset.rate, term: asset.termMonths, asset, eff: effective(x), t0, T: m.T,
      availUsd: src.total,               // cash at the start of the buy year, before this purchase
      othersOpsUsd: m.resUsd.reduce((t, r) => t + r.rows[y - 1].netCashFlow, 0) };   // rent minus costs of the other assets in that year
    menu.innerHTML = `<div class="mh" data-menu="1">${esc(x.name)} · buy in year ${y}${side === 'B' ? ' · Plan B' : ''}</div>
      <div class="mrow" data-menu="1">Price: <b>${loc(asset.price, cur)}</b></div>
      <div class="mrow" data-menu="1" style="border-top:1px solid var(--border);border-bottom:1px solid var(--border)">${sum}
        <div style="display:flex;justify-content:space-between;gap:12px;font-weight:700;margin-top:2px"><span>Cash you can use</span><span>${loc(availLocal, cur)}</span></div>
        ${src.total < 0 ? '<div class="sub" style="margin:4px 0 0">Your cash is below zero by then.</div>' : ''}</div>
      <label data-menu="1" style="padding:0 8px">Down payment (${cur})</label>
      <div style="padding:2px 8px"><input id="mDown" data-menu="1" type="number" step="any" min="0" max="${cap}" value="${def}"></div>
      <div class="mrow" id="mInfo" data-menu="1"></div>
      <div class="mrow" id="mEnd" data-menu="1"></div>
      <button id="mBuy" data-act="buy" data-id="${id}" data-y="${y}" data-side="${side}" data-menu="1">Buy</button>
      <button data-act="none" data-id="${id}" data-y="${y}" data-side="${side}" data-menu="1">Don't buy</button>`;
  } else {
    menu.innerHTML = `<div class="mh" data-menu="1">${esc(x.name)} · year ${y}${side === 'B' ? ' · Plan B' : ''}</div>
      <button data-act="sell" data-id="${id}" data-y="${y}" data-side="${side}" data-menu="1">Sell in year ${y}</button>
      <button data-act="none" data-id="${id}" data-y="${y}" data-side="${side}" data-menu="1">Keep it</button>`;
  }
  menu.style.display = 'block';
  menu.style.left = Math.max(8, Math.min((ev.clientX || 0), (window.innerWidth || 800) - 280)) + 'px';
  menu.style.top = Math.max(8, (ev.clientY || 0) + 8) + 'px';
  menuPreview();
}
const closeMenu = () => { $('menu').style.display = 'none'; menuCtx = null; };
// Ids of planned purchases on the given side whose down payment is more than the cash available, in state st.
function unfundedBuys(st, side) {
  const real = state; state = st;               // buildModel reads the global state
  try {
    const m = buildModel(side);
    return m.res.map((r, i) => r.events.buy && m.resUsd[i].events.buy.amount >
      Math.max(0, availableCash(m, r.events.buy.year, i)) + 0.5 ? st.assets[i].id : null).filter(Boolean);
  } finally { state = real; }
}
// Apply a change to a plan on the given side ('A' or 'B'). If it would leave a purchase that is
// covered today without enough cash (for example, resetting the sale that paid for it), warn first.
// Continuing also resets those purchases. Changes that keep every purchase covered go through silently.
function commitChange(mutate, describe, side) {
  side = side || 'A';
  const key = planKey(side);
  const trial = clone(state); mutate(trial);
  const already = new Set(unfundedBuys(state, side));       // purchases that were already short are left alone
  const dropped = [];
  for (let broken = unfundedBuys(trial, side).filter(id => !already.has(id)); broken.length;
       broken = unfundedBuys(trial, side).filter(id => !already.has(id))) {
    // reset the earliest one first; resetting it frees cash, which may cover the later ones
    const x = broken.map(id => trial.assets.find(a => a.id === id)).sort((a, b) => a[key].year - b[key].year)[0];
    dropped.push(`"${x.name}" (year ${x[key].year})`);
    delete x[key];
  }
  if (dropped.length && !confirm(`${describe} leaves ${dropped.join(' and ')} without enough cash.\n\nThat purchase will be removed too. Continue?`)) return false;
  state = trial; save(); closeMenu(); renderAssets(); renderPlanner();
  return true;
}
function setPlan(id, act, y, down, side) {
  side = side || 'A';
  const key = planKey(side);
  const x = state.assets.find(a => a.id === id); if (!x) return;
  const sfx = side === 'B' ? ' (Plan B)' : '';
  const cur = x[key];
  const describe = act === 'none'
    ? (cur ? (cur.action === 'sell' ? `Resetting the sale of "${x.name}"${sfx}` : `Removing the purchase of "${x.name}"${sfx}`) : null)
    : act === 'sell' ? (cur ? `Moving the sale of "${x.name}" to year ${y}${sfx}` : `Selling "${x.name}" in year ${y}${sfx}`)
    : `Buying "${x.name}" in year ${y}${sfx}`;
  if (!describe) { closeMenu(); return; }          // nothing to reset
  commitChange(st => {
    const t = st.assets.find(a => a.id === id);
    if (act === 'none') delete t[key]; else t[key] = { action: act, year: +y, ...(act === 'buy' ? { down } : {}) };
  }, describe, side);
}
// Start / stop comparing. Turning it on seeds Plan B as a copy of Plan A (the current default)
// so the right side starts identical, then can be edited independently. Turning it off discards Plan B.
function toggleCompare() {
  state.compareOn = !state.compareOn;
  state.assets.forEach(x => { if (state.compareOn) { if (x.plan) x.planB = clone(x.plan); else delete x.planB; } else delete x.planB; });
  save(); closeMenu(); renderPlanner();
}
// Promote Plan B to be the new default (Plan A), then stop comparing. This is how you pick the
// winning plan after a comparison; the next time you open the planner this becomes the default.
function usePlanB() {
  if (!confirm('Make Plan B the new default plan? This replaces Plan A. (Save afterwards to keep it on disk.)')) return;
  state.assets.forEach(x => { if (x.planB) x.plan = clone(x.planB); else delete x.plan; delete x.planB; });
  state.compareOn = false;
  save(); closeMenu(); renderAssets(); renderPlanner();
}

// ---------- Page 2: charts and tables ----------
let charts = [];
// Draws a dashed line and a small tag ("Buy X" / "Sell Y") at each planned event.
// opt.events = [{index, text, kind}]; opt.edge = true puts the line at the left edge of a yearly bar.
const eventMarks = {
  id: 'eventMarks',
  afterDatasetsDraw(chart, args, opt) {
    const evs = (opt && opt.events) || [];
    if (!evs.length) return;
    const ctx = chart.ctx, ca = chart.chartArea, xs = chart.scales.x;
    const slot = chart.data.labels.length > 1 ? xs.getPixelForValue(1) - xs.getPixelForValue(0) : 0;
    const groups = {};
    evs.forEach(e => (groups[e.index] = groups[e.index] || []).push(e));
    ctx.save();
    ctx.font = '600 11px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.textBaseline = 'middle';
    const tags = [];
    Object.keys(groups).forEach(idx => {
      const px = xs.getPixelForValue(+idx) - (opt.edge ? slot / 2 : 0);
      ctx.strokeStyle = cssv(groups[idx][0].kind === 'buy' ? '--c-ins' : '--c-interest'); ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(px, ca.top); ctx.lineTo(px, ca.bottom); ctx.stroke(); ctx.setLineDash([]);
      groups[idx].forEach(e => {
        const w = ctx.measureText(e.text).width + 12;
        tags.push({ e, w, left: px + 4 + w > ca.right ? px - 4 - w : px + 4 });   // flip left near the right edge
      });
    });
    // place tags left to right, moving one down a row whenever it would cover an earlier one
    const h = 18, rows = [];
    tags.sort((p, q) => p.left - q.left).forEach(t => {
      let r = 0;
      while ((rows[r] || []).some(o => t.left < o.left + o.w + 4 && t.left + t.w + 4 > o.left)) r++;
      (rows[r] = rows[r] || []).push(t);
      const y = ca.top + 6 + r * (h + 4), color = cssv(t.e.kind === 'buy' ? '--c-ins' : '--c-interest');
      ctx.fillStyle = cssv('--card'); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(t.left, y, t.w, h, 9); else ctx.rect(t.left, y, t.w, h);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.fillText(t.e.text, t.left + 6, y + h / 2 + 0.5);
    });
    ctx.restore();
  },
};
const shortName = n => n.length > 16 ? n.slice(0, 15) + '…' : n;
// The three charts for one side. Each side formats money in its own currency.
function drawCharts(m, sfx, view) {
  const { res, wealth } = m, code = m.disp.code, fm = n => money(n, code);
  const sel = view === 'all' ? state.assets.map((_, i) => i) : [+view];
  const rows = view === 'all' ? Engine.sumRows(res.map(r => r.rows)) : res[+view].rows;
  const labels = rows.map(r => 'Yr ' + r.year);
  // buy / sell tags. An event happens at the start of its year. On the cash chart (index 0 = "Now") that is
  // index year-1; on the yearly charts it is the left edge of that year.
  const eventList = idxs => idxs.flatMap(i => {
    const r = res[i], nm = shortName(state.assets[i].name);
    return [...(r.events.sell ? [{ index: r.events.sell.year - 1, text: 'Sell ' + nm, kind: 'sell' }] : []),
            ...(r.events.buy ? [{ index: r.events.buy.year - 1, text: 'Buy ' + nm, kind: 'buy' }] : [])];
  });
  const text = cssv('--muted'), grid = cssv('--border');
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
    plugins:{ tooltip:{callbacks:{label:c => `${c.dataset.label}: ${fm(c.parsed.y)}`}}, legend:{labels:{color:text}},
              title:{ display: !!state.compareOn, text: 'Plan ' + m.side + (m.side === 'A' ? ' (current default)' : ' (what-if)'), color: text, font:{ size:13, weight:'600' } } } };
  const scales = st => ({ x:{stacked:st, ticks:{color:text}, grid:{color:grid}}, y:{stacked:st, ticks:{color:text, callback:n => fm(n)}, grid:{color:grid}} });
  const ln = (label, data, c, dash, w) => ({ label, data, borderColor:cssv(c), borderWidth:w || 2, pointRadius:0, borderDash:dash || [], tension:0 });
  const marks = (idxs, edge) => ({ ...opts, scales:scales(false), plugins:{...opts.plugins, eventMarks:{events:eventList(idxs), edge}} });
  const allIdx = state.assets.map((_, i) => i);
  return [
    new Chart($('wealthChart' + sfx), { type:'line', data:{ labels:['Now', ...labels], datasets:[
      ln('Cash + equity', wealth.map(p => p.netWorth), '--text', [], 3),
      ln('Cash', wealth.map(p => p.cash), '--c-ins'),
      ln('Equity (property value minus loans)', wealth.map(p => p.assetValue - p.loan), '--c-value'),
    ]}, plugins:[eventMarks], options: marks(allIdx, false) }),
    new Chart($('opChart' + sfx), { type:'line', data:{ labels, datasets:[
      ln('Rent + equity growth', rows.map(r => r.rent + r.equityGain), '--c-equity'),
      ln('Rent (cash income)', rows.map(r => r.rent), '--c-rent'),
      ln('Total cost of running (incl. loan)', rows.map(r => r.totalCost), '--c-interest'),
    ]}, plugins:[eventMarks], options: marks(sel, true) }),
    new Chart($('valueChart' + sfx), { type:'line', data:{ labels, datasets:[
      ln('Asset value', rows.map(r => r.value), '--c-value'), ln('Equity', rows.map(r => r.equity), '--c-equity'),
      ln('Loan balance', rows.map(r => r.balance), '--c-loan'),
    ]}, plugins:[eventMarks], options: marks(sel, true) }),
  ];
}
function renderPlanner() {
  if (currentPage !== 'planner') return;
  const none = !state.assets.length;                 // no assets: only show how the cash grows
  const m = buildModel(), { T, res, wealth } = m;
  $('assetCards').style.display = none ? 'none' : '';
  $('opsWrap').style.display = none ? 'none' : '';
  $('clickHint').style.display = none ? 'none' : '';
  $('wealthTitle').textContent = none ? 'Cash growth' : 'Total Cash + Equity Plots';
  $('wealthDesc').textContent = none ? 'How your cash grows with interest.' : 'Your cash plus the part of your property you own after loans.';

  // controls
  const hs = [...new Set([...HORIZONS, T])].sort((a, b) => a - b);
  $('horizon').innerHTML = hs.map(h => `<option value="${h}">${h} years</option>`).join(''); $('horizon').value = T;
  if (document.activeElement !== $('startCash')) $('startCash').value = state.startCash;
  $('includeOps').checked = !!state.includeOps;
  const codes = [...new Set(['USD', ...state.assets.map(codeOf)])];
  if (!codes.includes(state.display)) state.display = 'USD';
  $('dispCur').innerHTML = codes.map(c => `<option>${c}</option>`).join(''); $('dispCur').value = state.display;
  // compare: Plan A (saved default) vs Plan B (what-if), on the same assets, side by side.
  const compare = !!state.compareOn && !none;
  $('cmpBtn').className = compare ? 'primary' : '';
  $('cmpBtn').textContent = compare ? 'Stop comparing' : 'Compare plans';
  $('cmpBtn').disabled = none;
  $('useBBtn').style.display = compare ? '' : 'none';
  $('planALabel').style.display = compare ? '' : 'none';
  $('pagePlanner').className = compare ? 'compare' : '';
  $('appMain').style.maxWidth = compare ? '1500px' : '';
  const mB = compare ? buildModel('B') : null;
  $('curNote').innerHTML = compare
    ? `Comparing <b>Plan A</b> (current default) with <b>Plan B</b> (what-if) in <b>${DISP.code}</b>. Edit either timeline. The yearly table below uses Plan A.`
    : codes.length > 1 ? `Showing amounts in <b>${DISP.code}</b>.` : '';
  if (none) {
    $('timeline').innerHTML = '<div class="sub" style="margin:0">No assets yet. Add some on the Assets page to plan buys and sells.</div>';
    charts.forEach(c => c.destroy()); charts = [];
    const pts = wealth.map(p => p.cash);
    charts = [new Chart($('wealthChart'), { type:'line', data:{ labels:['Now', ...wealth.slice(1).map(p => 'Yr ' + p.year)], datasets:[
      { label:'Cash', data: pts, borderColor: cssv('--c-ins'), borderWidth:3, pointRadius:0, tension:0 }]},
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
        plugins:{ tooltip:{callbacks:{label:c => `${c.dataset.label}: ${usd(c.parsed.y)}`}}, legend:{labels:{color:cssv('--muted')}} },
        scales:{ x:{ticks:{color:cssv('--muted')}, grid:{color:cssv('--border')}}, y:{ticks:{color:cssv('--muted'), callback:n => usd(n)}, grid:{color:cssv('--border')}} } } })];
    $('wealthNote').innerHTML = `${usd(pts[0])} grows to <b>${usd(pts[T])}</b> in ${T} years at ${state.cashYield}% a year.`;
    return;
  }
  const vsel = $('view'), cur = vsel.value || 'all';
  vsel.innerHTML = '<option value="all">All assets combined</option>' + state.assets.map((a, i) => `<option value="${i}">${esc(a.name)}${res[i].inPlan ? '' : ' (not in plan)'}</option>`).join('');
  vsel.value = [...vsel.options].some(o => o.value === cur) ? cur : 'all';
  $('startCashCur').textContent = '$';

  renderTimeline(m);
  if (mB) renderTimeline(mB); else $('timelineB').innerHTML = '';

  const v = vsel.value;
  const sel = v === 'all' ? state.assets.map((_, i) => i) : [+v];
  const rows = v === 'all' ? Engine.sumRows(res.map(r => r.rows)) : res[+v].rows;
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  charts.forEach(c => c.destroy());
  charts = drawCharts(m, '', v);
  if (mB) charts = charts.concat(drawCharts(mB, 'B', v));
  const neg = wealth.find(p => p.cash < 0), low = wealth.reduce((a, p) => p.cash < a.cash ? p : a, wealth[0]);
  const shortfalls = res.map((r, i) => r.events.buy && m.resUsd[i].events.buy.amount > Math.max(0, availableCash(m, r.events.buy.year, i)) + 0.5
    ? esc(state.assets[i].name) : '').filter(Boolean);
  $('wealthNote').innerHTML = (shortfalls.length ? `<span style="color:var(--c-interest)">⚠ Not enough cash for the down payment: ${shortfalls.join(', ')}.</span><br>` : '') +
    (neg ? `Cash goes below zero in year ${neg.year} (lowest ${usd(low.cash)}).` : '');

  const net = sum('rent') - sum('totalCost'), netEq = net + sum('equityGain');
  $('opNote').innerHTML = `Over ${T} years, rent minus all costs: <b>${usd(net)}</b>. Counting the growth in what you own: <b>${usd(netEq)}</b>.`;
  $('opDrop').innerHTML = sel.map(i => {
    const x = state.assets[i], r = res[i], t = +x.termMonths || 0;
    if (!(+x.loan > 0) || t <= 0 || r.n <= 0) return '';
    const endYear = r.start + Math.ceil(t / 12) - 1;               // last calendar year with loan payments
    if (endYear >= r.start + r.n - 1) return '';                   // loan outlives ownership or timeline
    return `${esc(x.name)}'s loan is paid off in year ${endYear}, so costs drop after that.`;
  }).filter(Boolean).join('<br>');

  // Yearly table. The cash columns cover all your assets, whichever asset is selected above. Buying and
  // selling happen at the start of the year, so cash goes: start -> after buy/sell -> + interest
  // (+ rent minus costs, if counted) -> year end. Amounts are in the display currency at the start-of-year
  // rate; for a non-USD display the year-end cash is at the year-end rate, so the gap is shown separately.
  const u = t => Engine.unitsPerUsd(DISP, t), sgn = v => (v < 0 ? '−' : '+') + usd(Math.abs(v));
  const evText = y => res.flatMap((r, i) => [
    r.events.sell && r.events.sell.year === y ? `Sell ${esc(state.assets[i].name)} ${sgn(r.events.sell.amount)}` : null,
    r.events.buy && r.events.buy.year === y ? `Buy ${esc(state.assets[i].name)} ${sgn(-r.events.buy.amount)}` : null]).filter(Boolean).join('<br>') || '–';
  const showOps = !!state.includeOps, showFx = DISP.code !== 'USD';
  const cashCols = [['Year', r => r.year], ['Buy / sell', r => evText(r.year), 'ev'],
    ['Cash at start of year', r => usd(wealth[r.year - 1].cash)],
    ['Cash after buy / sell', r => usd(wealth[r.year].afterEventsUsd * u(r.year - 1))],
    ['Interest on cash', r => usd(wealth[r.year].interestUsd * u(r.year - 1))],
    ...(showOps ? [['Rent minus costs', r => usd(wealth[r.year].opsUsd * u(r.year - 1))]] : []),
    ...(showFx ? [['Exchange-rate effect', r => { const p = wealth[r.year]; return usd(p.cash - (p.afterEventsUsd + p.interestUsd + p.opsUsd) * u(r.year - 1)); }]] : []),
    ['Cash at year end', r => '<b>' + usd(wealth[r.year].cash) + '</b>'],
    ['Equity (all assets)', r => usd(wealth[r.year].assetValue - wealth[r.year].loan)],     // property value minus loans
    ['Cash + equity', r => '<b>' + usd(wealth[r.year].netWorth) + '</b>']];
  const assetCols = [['principal','Principal'],['interest','Interest'],['maintenance','Maint.'],['tax','Tax'],
    ['insurance','Insurance'],['totalCost','Total cost'],['opCost','Op. costs'],['rent','Rent'],['noi','NOI'],['netCashFlow','Net cash flow'],
    ['equityGain','Equity gain'],['balance','Loan balance'],['value','Asset value'],['equity','Equity (this view)']];
  $('tbl').innerHTML = '<tr>' + cashCols.map(c => `<th${c[2] ? ' class="ev"' : ''}>${c[0]}</th>`).join('') + assetCols.map(c => `<th>${c[1]}</th>`).join('') + '</tr>' +
    rows.map(r => '<tr>' + cashCols.map(c => `<td${c[2] ? ' class="ev"' : ''}>${c[1](r)}</td>`).join('') + assetCols.map(([k]) => `<td>${usd(r[k])}</td>`).join('') + '</tr>').join('');

  const pct = v => v + '%';
  $('assumeList').innerHTML = [
    ...state.assets.map(x => { const f = effective(x);
      return `<b>${esc(x.name)}</b>: maintenance +${pct(f.maintGrowth)}/yr, tax +${pct(f.taxGrowth)}/yr, insurance +${pct(f.insGrowth)}/yr · rent +${pct(f.rentStepPct)} every ${f.rentStepYears} yr · value +${pct(f.apprStepPct)} every ${f.apprStepYears} yr${+f.sellCostPct ? ` · selling fee ${pct(f.sellCostPct)}` : ''}`; }),
    'Buying and selling happen at the start of the year you pick.',
    'Selling: you get the sale price, minus the loan left and the selling fee.',
    'Buying: the down payment can\'t be more than your cash. Loan = price − down payment.',
    `Cash is in US dollars and earns ${state.cashYield}% a year while unused. ${state.includeOps ? 'Rent and running costs are added to it.' : 'Rent and running costs are not added to it.'}`,
    'No inflation, income tax or empty months. Interest rates stay fixed.',
    ...state.assets.filter(x => codeOf(x) !== 'USD' || +x.fx > 1 || +x.fxGrowth).map(x =>
      `<b>${esc(x.name)}</b>: $1 = ${+x.fx > 0 ? +x.fx : 1} ${esc(codeOf(x))} today, ${+x.fxGrowth || 0}% a year change.`),
  ].map(t => `<li>${t}</li>`).join('');
}

function exportCsv() {
  const { res, wealth } = buildModel(); const v = $('view').value;
  const rows = (v === 'all' ? Engine.sumRows(res.map(r => r.rows)) : res[+v].rows)
    .map(r => ({ ...r, cash: wealth[r.year].cash, portfolioAssetValue: wealth[r.year].assetValue,
                 totalValue: wealth[r.year].total, netWorth: wealth[r.year].netWorth, cashInterest: wealth[r.year].interest,
                 cashAfterBuySell: wealth[r.year].afterEventsUsd * Engine.unitsPerUsd(DISP, r.year - 1),
                 equityAllAssets: wealth[r.year].assetValue - wealth[r.year].loan, cashPlusEquity: wealth[r.year].netWorth }));
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(','), ...rows.map(r => keys.map(k => r[k].toFixed ? +r[k].toFixed(2) : r[k]).join(','))].join('\n');
  const l = document.createElement('a');
  l.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'})); l.download = 'plan-' + DISP.code + '.csv'; l.click();
}

// ---------- Pages ----------
let currentPage = 'assets';
function showPage(p) {
  currentPage = p;
  $('pageAssets').style.display = p === 'assets' ? '' : 'none';
  $('pagePlanner').style.display = p === 'planner' ? '' : 'none';
  $('tabAssets').className = p === 'assets' ? 'tab on' : 'tab';
  $('tabPlanner').className = p === 'planner' ? 'tab on' : 'tab';
  try { history.replaceState(null, '', '#' + p); } catch (e) {}
  closeMenu();
  if (p === 'assets') renderAssets(); else renderPlanner();
}

// ---------- Scenarios ----------
// On a static host (e.g. GitHub Pages) there is no backend, so scenarios live in this browser
// under SKEY. When server.js is running locally it answers /api/scenarios, and we use that
// instead so scenarios are saved as JSON files on disk. The backend is picked once at startup.
const API = '/api/scenarios';
const SKEY = 'investmentplanner.scenarios.v1';
const send = (method, body) => ({ method, headers: {'Content-Type':'application/json', 'X-Planner':'1'}, body: body && JSON.stringify(body) });

// Browser-storage backend. Shape mirrors the server: list() -> [{name, savedAt}], get() -> {name, savedAt, data}.
const localStore = {
  all() { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; } },
  write(all) { localStorage.setItem(SKEY, JSON.stringify(all)); },
  async list() { return Object.values(this.all()).map(s => ({ name: s.name, savedAt: s.savedAt })).sort((a, b) => a.name.localeCompare(b.name)); },
  async get(name) { const s = this.all()[name]; if (!s) throw new Error('no such scenario'); return s; },
  async put(name, data) { const all = this.all(); all[name] = { name, savedAt: new Date().toISOString(), data }; this.write(all); return all[name]; },
  async del(name) { const all = this.all(); delete all[name]; this.write(all); return { deleted: name }; },
};
// File-on-disk backend, served by planner/server.js (local use only).
const serverStore = {
  async req(sub, opt) { const r = await fetch(API + sub, opt); const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'HTTP ' + r.status); return b; },
  async list() { return (await this.req('')).scenarios; },
  async get(name) { return this.req('/' + encodeURIComponent(name)); },
  async put(name, data) { return this.req('/' + encodeURIComponent(name), send('PUT', { data })); },
  async del(name) { return this.req('/' + encodeURIComponent(name), send('DELETE')); },
};
let store = localStore, serverMode = false;
// Use the file server if it answers, otherwise fall back to browser storage (seeding examples once).
async function initStore() {
  try { await serverStore.list(); store = serverStore; serverMode = true; }
  catch (e) { store = localStore; serverMode = false; await seedExamples(); }
}
// First run only: copy the bundled example scenarios (scenarios/index.json) into this browser so the
// dropdown isn't empty on the hosted site. A one-time flag means examples a user deletes stay deleted.
async function seedExamples() {
  const SEEDED = SKEY + '.seeded';
  if (localStorage.getItem(SEEDED)) return;
  try {
    const files = await (await fetch('scenarios/index.json')).json();
    const all = localStore.all();
    for (const file of files) {
      try {
        const sc = await (await fetch('scenarios/' + file)).json();
        const data = sc.data || sc, name = (sc.name || String(file).replace(/\.json$/i, '')).trim();
        if (name && !all[name]) all[name] = { name, savedAt: sc.savedAt || new Date().toISOString(), data };
      } catch (e) { /* skip a bad example */ }
    }
    localStore.write(all);
  } catch (e) { /* no manifest to seed from */ }
  localStorage.setItem(SEEDED, '1');
}
let scenarioList = [];
const setStatus = t => { $('scStatus').textContent = t; };
async function renderScenarios(selected) {
  try { scenarioList = await store.list(); }
  catch (e) { scenarioList = []; setStatus('Could not read scenarios: ' + e.message); }
  $('scList').innerHTML = scenarioList.length ? scenarioList.map(s => `<option>${esc(s.name)}</option>`).join('') : '<option value="">(no saved scenarios)</option>';
  if (selected && scenarioList.some(s => s.name === selected)) $('scList').value = selected;
}
function applyScenario(data) {
  // A loaded scenario is always the default plan (Plan A); any prior comparison is cleared.
  state = normalizeState({ display: data.display, horizon: data.horizon, startCash: data.startCash, includeOps: data.includeOps, cashYield: data.cashYield, assumptions: data.assumptions, assets: clone(data.assets) });
  save(); showPage(currentPage);
}
// The scenario file only ever holds the default plan. Plan B (the what-if) and the compare flag
// are scratch UI state and are stripped out before saving — so only the chosen plan is persisted.
function scenarioData() {
  const data = clone(state);
  delete data.compareOn;
  data.assets.forEach(a => delete a.planB);
  return data;
}
async function saveCurrent() {
  const name = $('scName').value.trim();
  if (!name) { setStatus('Enter a name first.'); return; }
  if (state.compareOn && !confirm('You are comparing plans. Saving stores Plan A (the current default) only. Use "Use Plan B as default" first if you want to keep Plan B.\n\nSave Plan A as "' + name + '"?')) return;
  if (scenarioList.some(s => s.name === name) && !confirm('Overwrite saved scenario "' + name + '"?')) return;
  try {
    const r = await store.put(name, scenarioData());
    await renderScenarios(r.name);
    setStatus('Saved "' + r.name + '"' + (serverMode ? ' to disk.' : ' in this browser.'));
  } catch (e) { setStatus('Save failed: ' + e.message); }
}
async function loadSelected() {
  const name = $('scList').value;
  if (!name) { setStatus('Nothing to load.'); return; }
  try {
    const sc = await store.get(name);
    applyScenario(sc.data); $('scName').value = sc.name;
    setStatus('Loaded "' + sc.name + '".');
  } catch (e) { setStatus('Load failed: ' + e.message); }
}
async function deleteSelected() {
  const name = $('scList').value;
  if (!name || !confirm('Delete scenario "' + name + '"?' + (serverMode ? ' This removes its file.' : ''))) return;
  try { await store.del(name); await renderScenarios(); setStatus('Deleted "' + name + '".'); }
  catch (e) { setStatus('Delete failed: ' + e.message); }
}
// Download the current plan as a JSON file. Works anywhere; handy for backups and moving between devices.
function exportFile() {
  const name = $('scName').value.trim() || 'scenario';
  const payload = { name, savedAt: new Date().toISOString(), data: scenarioData() };
  const l = document.createElement('a');
  l.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  l.download = name.replace(/[^\w.-]+/g, '_') + '.json'; l.click();
  setStatus('Exported "' + name + '".');
}
// Import a scenario file (for example one exported from the original calculator) and save it to disk.
function importFile(file) {
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const obj = JSON.parse(rd.result), data = obj.data || obj;
      if (!Array.isArray(data.assets)) throw new Error('no assets found');
      const name = (obj.name || file.name.replace(/\.json$/i, '') || 'imported').trim();
      applyScenario(data);
      const r = await store.put(name, scenarioData());
      await renderScenarios(r.name); $('scName').value = r.name;
      setStatus('Imported "' + r.name + '".');
    } catch (e) { setStatus('Import failed: ' + e.message); }
  };
  rd.readAsText(file);
}

// ---------- Events ----------
document.addEventListener('input', e => {
  const t = e.target, d = t.dataset || {};
  if (d.k === 'status') {
    const x = state.assets[+d.i], id = x.id, to = t.value;
    // a plan only makes sense for its status, so changing status clears it (and may affect later purchases)
    commitChange(st => {
      const a = st.assets.find(q => q.id === id); a.status = to; delete a.plan; delete a.planB;
      if (to === 'potential' && !(+a.price > 0)) a.price = (+a.loan || 0) + (+a.equity || 0);
    }, `Changing "${x.name}" to ${to}`);
    renderAssets(); return;     // re-render so the select matches the state if the change was cancelled
  }
  if (d.k) state.assets[+d.i][d.k] = (d.k === 'name' || d.k === 'currency') ? t.value : (parseFloat(t.value) || 0);
  else if (d.s) state.assets[+d.i].assume[d.s] = parseFloat(t.value) || 0;
  else if (t.id === 'startCash') state.startCash = parseFloat(t.value) || 0;
  else if (t.id === 'cashYield') state.cashYield = Math.max(0, parseFloat(t.value) || 0);
  else if (t.id === 'mDown') { menuPreview(); return; }
  else return;
  save(); renderPlanner();
});
document.addEventListener('change', e => {
  const t = e.target, d = t.dataset || {};
  if (t.id === 'dispCur') { state.display = t.value; save(); renderPlanner(); }
  else if (t.id === 'includeOps') { state.includeOps = !!t.checked; save(); renderPlanner(); }
  else if (t.id === 'horizon') { state.horizon = +t.value || 30; save(); renderPlanner(); }
  else if (d.k === 'currency') renderAssets();      // refresh labels
});
document.addEventListener('click', e => {
  const t = e.target, d = t.dataset || {};
  if (t.id === 'cmpBtn') { toggleCompare(); return; }
  if (t.id === 'useBBtn') { usePlanB(); return; }
  if (d.cell) { openMenu(d.id, +d.y, e, d.side); return; }
  if (d.act === 'buy') {
    const down = parseFloat($('mDown').value);
    if (menuCtx && down >= 0 && down <= menuCtx.cap + 1e-6) setPlan(d.id, 'buy', d.y, down, d.side);
    return;
  }
  if (d.act) { setPlan(d.id, d.act, d.y, undefined, d.side); return; }
  if (d.menu) return;                 // clicks inside the pop-up (labels, the input) keep it open
  if (d.del !== undefined) {
    const x = state.assets[+d.del]; if (!x) return;
    commitChange(st => { st.assets = st.assets.filter(a => a.id !== x.id); }, `Removing "${x.name}"`);
    return;
  }
  if (d.rm) {
    const x = state.assets.find(a => a.id === d.rm);
    if (x && confirm('Delete "' + x.name + '" entirely? To keep it but undo its timeline change, use Reset.')) {
      commitChange(st => { st.assets = st.assets.filter(a => a.id !== d.rm); }, `Deleting "${x.name}"`);
    }
    return;
  }
  if (d.clear) { setPlan(d.clear, 'none', undefined, undefined, d.side); return; }
  if (d.page) { showPage(d.page); return; }
  closeMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
$('addAsset').onclick = () => {
  state.assets.push({ id: uid(), name:'New asset', status:'current', currency:'USD', fx:1, fxGrowth:0, price:0, loan:0, termMonths:0, rate:0, equity:0, rent:0, maintenance:0, tax:0, insurance:0, assume:{...ASSUME_DEFAULTS} });
  save(); renderAssets();
};
$('view').onchange = renderPlanner; $('csv').onclick = exportCsv;
$('scSave').onclick = saveCurrent; $('scLoad').onclick = loadSelected; $('scDelete').onclick = deleteSelected;
$('scExport').onclick = exportFile;
$('scImport').onclick = () => $('scFile').click();
$('scFile').onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; };
initStore().then(() => renderScenarios());
showPage((typeof location !== 'undefined' && location.hash === '#planner') ? 'planner' : 'assets');
