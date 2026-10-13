// Pure calculation engine for the scenario planner. No DOM access so it can be tested in node.
(function (root) {
  const FLOW_KEYS = ['principal','interest','maintenance','tax','insurance','totalCost','rent',
                     'netCashFlow','appreciation','opCost','noi'];
  const STOCK_KEYS = ['balance','value','equity'];
  const ROW_KEYS = [...FLOW_KEYS, ...STOCK_KEYS, 'equityGain'];

  // Monthly payment for a fixed-rate loan; handles 0% interest.
  function monthlyPayment(principal, annualRatePct, months) {
    if (principal <= 0 || months <= 0) return 0;
    const r = annualRatePct / 100 / 12;
    if (r === 0) return principal / months;
    return (principal * r) / (1 - Math.pow(1 + r, -months));
  }

  // asset: {loan, termMonths, rate, maintenance, tax, insurance, rent, equity}
  // a: {maintGrowth, taxGrowth, insGrowth (annual %), rentStepPct, rentStepYears,
  //     apprStepPct, apprStepYears}
  // Returns one row per ownership year 1..years, in the asset's own currency.
  function projectAsset(asset, a, years) {
    const pmt = monthlyPayment(asset.loan, asset.rate, asset.termMonths);
    const r = asset.rate / 100 / 12;
    const value0 = asset.loan + asset.equity;
    let bal = asset.loan;
    let prevEquity = asset.equity;
    let prevValue = value0;
    const rows = [];
    for (let y = 1; y <= years; y++) {
      let interest = 0, principal = 0;
      for (let m = (y - 1) * 12 + 1; m <= y * 12; m++) {
        if (m > asset.termMonths || bal <= 1e-9) break;
        const i = bal * r;
        const p = Math.min(pmt - i, bal);
        interest += i; principal += p; bal -= p;
      }
      if (bal < 1e-6) bal = 0;
      const g = (pct) => Math.pow(1 + pct / 100, y - 1);
      const maintenance = asset.maintenance * g(a.maintGrowth);
      const tax = asset.tax * g(a.taxGrowth);
      const insurance = asset.insurance * g(a.insGrowth);
      const rent = asset.rent *
        Math.pow(1 + a.rentStepPct / 100, Math.floor((y - 1) / a.rentStepYears));
      const value = value0 *
        Math.pow(1 + a.apprStepPct / 100, Math.floor(y / a.apprStepYears));
      rows.push({
        year: y, principal, interest, maintenance, tax, insurance,
        totalCost: principal + interest + maintenance + tax + insurance,
        rent, netCashFlow: rent - (principal + interest + maintenance + tax + insurance),
        balance: bal, value, equity: value - bal,
        equityGain: value - bal - prevEquity,   // appreciation + principal paid down
        appreciation: value - prevValue,
        opCost: maintenance + tax + insurance,  // operating costs, excludes the loan
        noi: rent - (maintenance + tax + insurance),
      });
      prevEquity = value - bal;
      prevValue = value;
    }
    return { payment: pmt, rows };
  }

  function sumRows(list) {
    return list[0].map((_, i) => {
      const o = { year: list[0][i].year };
      ROW_KEYS.forEach(k => o[k] = list.reduce((s, rows) => s + rows[i][k], 0));
      return o;
    });
  }

  // ---- Currency ----
  // asset.fx = local units per $1 today; asset.fxGrowth = yearly % change of the local
  // currency's value vs the dollar (negative = devaluing). Same for a display currency d.
  const gOf = pct => Math.max(-99, pct || 0) / 100;
  const fxOf = x => (x.fx > 0 ? x.fx : 1);
  // USD per 1 unit of the asset's currency, t years from today.
  const usdPerLocal = (asset, t) => Math.pow(1 + gOf(asset.fxGrowth), t) / fxOf(asset);
  // Units of the display currency per $1, t years from today.
  const unitsPerUsd = (d, t) => fxOf(d) * Math.pow(1 + gOf(d.fxGrowth), -t);

  // Local-currency rows -> USD. row.year is the calendar year. Flows during a year use the
  // rate at the start of that year, year-end balances the rate at its end. equityGain is
  // recomputed from USD equity, so it includes currency moves.
  function toUsd(rows, asset, startYear) {
    let prev = asset.equity * usdPerLocal(asset, (startYear || 1) - 1);
    return rows.map(r => {
      const ff = usdPerLocal(asset, r.year - 1), sf = usdPerLocal(asset, r.year);
      const o = { year: r.year };
      FLOW_KEYS.forEach(k => o[k] = r[k] * ff);
      STOCK_KEYS.forEach(k => o[k] = r[k] * sf);
      o.equityGain = o.equity - prev; prev = o.equity;
      return o;
    });
  }

  // USD rows -> display currency d. equity0Usd = USD equity just before the first row.
  function fromUsd(rows, d, equity0Usd) {
    let prev = equity0Usd * unitsPerUsd(d, (rows.length ? rows[0].year : 1) - 1);
    return rows.map(r => {
      const ff = unitsPerUsd(d, r.year - 1), sf = unitsPerUsd(d, r.year);
      const o = { year: r.year };
      FLOW_KEYS.forEach(k => o[k] = r[k] * ff);
      STOCK_KEYS.forEach(k => o[k] = r[k] * sf);
      o.equityGain = o.equity - prev; prev = o.equity;
      return o;
    });
  }

  const zeroRow = y => { const o = { year: y }; ROW_KEYS.forEach(k => o[k] = 0); return o; };

  // Project one asset onto a T-year calendar timeline, in display currency d.
  // opt.start: first year owned (1 for an asset you own now). opt.buy: a purchase happens at
  // the start of `start` (down payment = asset.equity leaves cash). opt.sellYear: sold at
  // the start of that year (loan repaid, selling cost taken, the rest goes to cash).
  // Years outside ownership are all-zero rows so assets can be summed.
  function scenarioAsset(asset, a, T, d, opt) {
    const start = Math.max(1, Math.round(opt.start || 1));
    const sellYear = opt.sellYear ? Math.round(opt.sellYear) : null;
    const end = sellYear ? Math.min(T, sellYear - 1) : T;
    const n = Math.max(0, end - start + 1);
    const t0 = start - 1;
    const conv = (amount, t) => amount * usdPerLocal(asset, t) * unitsPerUsd(d, t);

    const proj = projectAsset(asset, a, n);
    const local = proj.rows.map(r => ({ ...r, year: r.year + start - 1 }));
    const owned = fromUsd(toUsd(local, asset, start), d, asset.equity * usdPerLocal(asset, t0));
    const rows = [];
    for (let y = 1; y <= T; y++) rows.push(y >= start && y < start + n ? owned[y - start] : zeroRow(y));

    const events = { buy: null, sell: null };
    if (opt.buy && start <= T) events.buy = { year: start, amount: conv(asset.equity, t0) };
    if (sellYear && sellYear <= T && start <= T) {
      const value = n > 0 ? local[n - 1].value : asset.loan + asset.equity;
      const bal = n > 0 ? local[n - 1].balance : asset.loan;
      const proceeds = value - bal - value * (a.sellCostPct || 0) / 100;
      events.sell = { year: sellYear, amount: conv(proceeds, sellYear - 1),
                      value: conv(value, sellYear - 1), loan: conv(bal, sellYear - 1) };
    }
    return {
      rows, events, start, end, n, inPlan: start <= T,
      payment: conv(proj.payment, t0),             // monthly loan payment when ownership starts
      value0: conv(asset.loan + asset.equity, 0),  // today's value, for assets owned now
      loan0: conv(asset.loan, 0),
      current: !opt.buy,
    };
  }

  // Cash + asset value path. Cash is held in US dollars: it is the starting cash you enter plus the
  // USD value of each year's flows, sale proceeds and down payments (resUsd = the same assets projected
  // in USD). Display-currency figures are just that cash converted at the year-end rate, so switching
  // the display currency never changes the underlying money. resDisp = assets projected in display
  // currency d. Year 0 = today (assets owned now, before any planned event).
  // Each year: sale proceeds and down payments happen at the start; unused cash (the balance after those,
  // if positive) then earns yieldPct for the year; rent minus all costs (incl. loan payments) of the owned
  // assets is added at year end when includeOps is on (earning nothing until the next year). Negative cash
  // earns and is charged nothing, and cash can go negative.
  function wealthPath(startCashUsd, resUsd, resDisp, d, T, includeOps, yieldPct) {
    if (includeOps === undefined) includeOps = true;   // false: cash moves only when you buy or sell
    const now = resDisp.filter(r => r.current);
    const path = [{ year: 0, cashUsd: startCashUsd, cash: startCashUsd * unitsPerUsd(d, 0), interestUsd: 0, interest: 0,
      afterEventsUsd: startCashUsd, eventsUsd: 0, opsUsd: 0,
      assetValue: now.reduce((s, r) => s + r.value0, 0),
      loan: now.reduce((s, r) => s + r.loan0, 0) }];
    let cashUsd = startCashUsd;
    for (let y = 1; y <= T; y++) {
      let ops = 0, events = 0, assetValue = 0, loan = 0;
      resUsd.forEach(r => {
        ops += r.rows[y - 1].netCashFlow;
        if (r.events.sell && r.events.sell.year === y) events += r.events.sell.amount;
        if (r.events.buy && r.events.buy.year === y) events -= r.events.buy.amount;
      });
      resDisp.forEach(r => { assetValue += r.rows[y - 1].value; loan += r.rows[y - 1].balance; });
      const afterEvents = cashUsd + events;
      const interestUsd = (yieldPct || 0) / 100 * Math.max(0, afterEvents);
      cashUsd = afterEvents + interestUsd + (includeOps ? ops : 0);
      path.push({ year: y, cashUsd, cash: cashUsd * unitsPerUsd(d, y), interestUsd,
                  interest: interestUsd * unitsPerUsd(d, y), assetValue, loan,
                  eventsUsd: events, afterEventsUsd: afterEvents, opsUsd: includeOps ? ops : 0 });   // pieces of this year's cash
    }
    path.forEach(p => { p.total = p.cash + p.assetValue; p.netWorth = p.total - p.loan; });
    return path;
  }

  const api = { monthlyPayment, projectAsset, sumRows, toUsd, fromUsd, scenarioAsset, wealthPath,
                usdPerLocal, unitsPerUsd };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Engine = api;
})(this);
