# The Price of Intelligence

A static site comparing what a completed task costs when a human mind does it versus a
machine one — in dollars, and in watt-hours.

## Run locally

```sh
python3 -m http.server 4173
# open http://localhost:4173
```

The site fetches its data snapshots with `fetch()`, so it must be served over HTTP —
opening `index.html` via `file://` will show a friendly error instead of data.

## Structure

| Path | Role |
|---|---|
| `index.html` / `app.js` / `styles.css` | The benchmark site (no external dependencies) |
| `data.js` | The cost engine — pure functions only, all arithmetic auditable in one file |
| `data/manifest.json` | List of available snapshot dates + the latest |
| `data/YYYY-MM-DD.json` | A dated snapshot: constants, sources, models (with confidence), tasks |
| `data/history.json` | Archived launch list prices for the "falling price of intelligence" chart |
| `live.html` / `live.js` | Separate page with external API dependencies (live + regional grid data) |
| `scripts/update-data.mjs` | Refresh script — see below |
| `water.html` / `water.js` | The water lens — embedded water per task, human vs AI |
| `greenbench.html` / `greenbench.js` | GreenBench — interactive three-gate permission standard for large-scale AI deployment |
| `.github/workflows/update-data.yml` | Daily automated refresh (commits new snapshots) |

## Methodology in one paragraph

The three cost layers (marginal, sustaining, training) are **lenses inside the market
price, never summed** — a wage already repays food and education; an API price already
covers electricity and amortizes the training run. The headline comparison is always
market price vs. market price; the decomposition shows what's inside each. Full
methodology, conventions, and caveats are on the site itself.

## Updating the data

```sh
node scripts/update-data.mjs             # refresh + write today's snapshot
node scripts/update-data.mjs --dry-run   # preview changes
node scripts/update-data.mjs --add-new   # also add new releases from watched labs
EIA_API_KEY=… node scripts/update-data.mjs   # + refresh US electricity prices
```

What refreshes automatically:

- **Model prices** — pulled live from the OpenRouter API. Models whose confidence is
  `reported`/`estimated` are updated in place; `confirmed` (vendor list) prices are
  never overwritten silently — the script warns when the marketplace disagrees so you
  can check the vendor page. New releases from watched labs are suggested (or added
  with `--add-new`).
- **US electricity prices** — from the EIA API when `EIA_API_KEY` is set
  ([free key](https://www.eia.gov/opendata/)).
- **Median weekly earnings** — from the public BLS API (rate-limited, no key).

What stays manual (the report lists these with last-verified dates): USDA food plan,
education spending, the AI energy anchors (Wh/query), training-run cost, FX rates.

Each run appends a dated snapshot and updates the manifest; the site's "Data as of"
picker exposes every snapshot, so the historical record accumulates automatically.

## The live page

`live.html` localizes the energy lens with free, key-less, CORS-open APIs
(dashboard concept adapted from [Kate Morley's National Grid: Live](https://grid.iamkate.com/), CC0):

- **UK** — national generation mix + all 14 regional carbon intensities from the
  NESO/Oxford Carbon Intensity API, and the matching half-hourly Octopus Agile
  price for the selected region. Includes a "same task, region by region" carbon
  comparison.
- **Germany/Austria** — live EPEX wholesale spot via aWATTar.
- **US** — static EIA averages from the snapshot (add `EIA_API_KEY` to refresh).
- **Custom** — enter any rate.

Adding a new region = one adapter function in `live.js` plus a free data source;
regions without live APIs fall back to clearly-badged snapshot statics.

## Data confidence

Every model price carries a badge: **confirmed** (vendor list price), **reported**
(marketplace/third-party), **estimated** (representative figure where sources conflict
or vary by host), **unavailable** (no honest single number exists — shown as "—").
