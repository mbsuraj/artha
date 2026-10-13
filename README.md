# Artha

A browser-based **investment scenario planner** for real estate and cash. Lay your current and
potential properties on a timeline, decide what to buy and sell and when, and watch what happens to
your cash, loans, equity and net worth over the years, across currencies.

> **Artha** (अर्थ) is the Sanskrit word for wealth, prosperity and the material means of life, one of
> the four aims (puruṣārthas) of classical Indian thought. Fitting for a tool about deploying capital.

**Live:** https://mbsuraj.github.io/artha/

No build step, no framework, no tracking. Just HTML, CSS and vanilla JavaScript, with
[Chart.js](https://www.chartjs.org/) loaded from a CDN for the graphs.

---

## What it does

- **Assets page** — describe what you own (*current*) and what you might buy (*potential*): loan,
  term, rate, equity, rent and the running costs (maintenance, tax, insurance), plus per-asset growth
  assumptions and a selling fee.
- **Scenario planner** — click a year on each asset's timeline to **buy**, **sell** or do nothing.
  The app amortizes every loan, grows costs and rents, appreciates values, tracks a cash balance
  (with interest on idle cash and, optionally, rent minus costs), and plots:
  - total **cash + equity** (net worth) over time,
  - **income vs. cost of owning**,
  - **asset value, loan balance and equity**.
- **Compare plans** — keep a *Plan A* (your default) next to a *Plan B* what-if, side by side, then
  promote B to be the new default if you like it.
- **Multi-currency** — each asset carries its own currency, exchange rate and yearly drift vs. the
  dollar. Cash is held in USD; charts render in whatever display currency you pick.
- **Scenarios** — save, load, delete, **export** and **import** named scenarios. Two examples ship
  with the app (USA + India, USA + China).
- Export the yearly detail to **CSV**.

## Running it locally

**Option A — with the local server (recommended).** Saves scenarios as JSON files on disk under
`scenarios/`, and the bundled examples are available immediately. Needs Node (no npm install, zero
dependencies):

```bash
node server.js
# then open http://localhost:8123
```

**Option B — any static file server.** Scenarios are kept in your browser's `localStorage`; the
example scenarios are seeded automatically on first load:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

**Option C — open `index.html` directly** (double-click / `file://`). Works, but browsers block
`fetch` over `file://`, so the examples won't auto-load. You can still **Import** them from the
`scenarios/` folder by hand.

## How your data is stored

The scenario storage layer is adaptive and is chosen once at startup:

- If `server.js` is answering (`/api/scenarios`), scenarios are read from and written to JSON files
  in `scenarios/`.
- Otherwise (the hosted site, or a plain static server), scenarios live in your browser under the
  `localStorage` key `investmentplanner.scenarios.v1`.

`localStorage` is per-browser and per-origin: it isn't synced across devices and is cleared if you
clear site data. Use **Export file** to back a scenario up or move it to another device, and **Import
file** to bring it back. Nothing is ever sent to a server you don't run yourself.

## Project structure

```
artha/
├── index.html        UI markup and styles (the whole page)
├── engine.js         Pure finance math — no DOM, so it runs in Node and is unit-testable
├── app.js            UI logic: state, the timeline, charts, and scenario storage
├── server.js         Optional local Node server for file-based scenarios (localhost only)
└── scenarios/
    ├── index.json    Manifest of bundled examples (used to seed the hosted site)
    ├── USA-India.json
    └── USA-China.json
```

### Reading the code

- **`engine.js`** is the heart of it and has no UI concerns. Key functions:
  - `monthlyPayment()` — fixed-rate loan payment (handles 0%).
  - `projectAsset()` — one asset, year by year, in its own currency: principal/interest split,
    growing costs, stepped rent and appreciation, balance, value and equity.
  - `usdPerLocal()` / `unitsPerUsd()` / `toUsd()` / `fromUsd()` — currency conversion with yearly FX
    drift; start-of-year rates for flows, year-end rates for balances.
  - `scenarioAsset()` — places an asset on the shared timeline given a buy/sell plan, producing
    per-year rows plus the cash-moving `buy`/`sell` events.
  - `wealthPath()` — walks the cash balance forward (events, interest, optional rent-minus-costs) and
    rolls everything up into total value and net worth.
- **`app.js`** wires the DOM to the engine: it holds `state`, renders the two pages, draws the Chart.js
  graphs, runs the timeline pop-up menu, and implements the adaptive scenario store (`localStore` vs.
  `serverStore`, selected in `initStore()`).
- **`index.html`** is a single self-contained page; styling is inline CSS with a dark-mode block.

## Deploying to GitHub Pages

The app is fully static, so hosting is just serving these files. For a project page at
`https://<user>.github.io/artha/`, push this repo to a `artha` repository and enable GitHub Pages on
the default branch (root). All asset paths are relative, so it works at any subpath. `server.js` is
not used when hosted — the app automatically falls back to browser storage and seeds the examples
from `scenarios/index.json`.

> The in-app "How it works & source code" link points at `github.com/mbsuraj/artha`. Update it in
> `index.html` if your repository lives elsewhere.

## Assumptions and limitations

The projections are deliberately simple and nominal. Among the assumptions: fixed interest rates,
level monthly payments, no prepayment or refinancing, no vacancy, no income tax, no general inflation
adjustment, and growth applied as periodic steps. Buying and selling happen at the start of the
chosen year. The in-app "Assumptions" panel spells out the exact figures for your scenario.

**This is a planning and learning tool, not financial advice.** Check the numbers against your own
situation before making decisions.
