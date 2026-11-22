# Fournyl — build plan

Work milestone by milestone. Finish and demo each one before starting the next.
Start every milestone on Loire-Atlantique (44), then generalise.

## M0 — Repo skeleton (½ day)
- Folders: `src/` (app), `public/` (static + data), `pipeline/`, `docs/`, `design/`.
- MapLibre GL JS added (npm or a pinned copy in `public/vendor/`), `index.html` showing an empty map.
- GitHub Action that deploys `public/` + `src/` to GitHub Pages.
- **Done when:** the empty map is live on Pages.
- *Done (Oct 2026):* MapLibre 6.11.2 pinned in `public/vendor/` (ES modules, no build step), fonts self-hosted
  in `public/fonts/`. Local preview: `uv run python scripts/serve.py`. Site assembled by `scripts/build_site.sh`.

## M1 — Data pipeline for one département
- `fetch.py` for: COG, ADMIN EXPRESS, populations légales, RP age/sex, séries historiques, Filosofi,
  SIRENE (filtered to dep 44 for speed), BPE, SSMSI, DVF.
- Build every file of DATA.md §4 for dep 44 only (percentiles temporarily computed on 44).
- **Done when:** `python -m pipeline.run --dep 44` writes all outputs and the tests pass.
- *Done (Oct 2026):* all sources except DVF (deferred to M4, commune page) and RNE (M6). Percentiles are
  already **national** (statistics are read for all of France anyway), so M3 will not shift colours.
  Run: `uv run python -m pipeline.run --dep 44` (~1 min with cached downloads), then `uv run pytest`.
  See DATA.md §6 for what the real files required.

## M2 — Commune map (dep 44)
- Commune polygons coloured by score; Avoid bins hatched (MapLibre `fill-pattern`).
- Hover tooltip, click → pinned card (as in `design/Zoom.dc.html`).
- Sidebar: range sliders whose bounds follow the visible communes (`map.on('moveend')` +
  `queryRenderedFeatures` or a bbox test on centroids), importance selects, reset.
- Top bar counts, legend, URL state.
- First version of the **Sources & method page** (SPEC §3.5), linked from the sidebar and the card.
- **Done when:** behaviour matches the mockup on dep 44, at 1440 px and 390 px.
- *Done (Oct 2026):* plus search (keyboard combobox) and a "best communes on screen" list for keyboard
  access, shortlist star (localStorage). The GitHub Action now builds the data (dep 44), runs the tests and
  deploys; it also reruns monthly. Not in M2: delivery switch (M5), commune page link (M4), `sell_soon` row
  (hidden until M6 has data).

## M3 — All of France
- Pipeline `--all`; national percentiles; per-département geometry loaded on demand.
- National view: département choropleth = number of Go communes (computed client-side from
  `communes-index.json` with the current weights), top-6 list, click to zoom.
- Search with autocomplete.
- **Done when:** national view loads < 2 s on throttled 4G; scores identical to M2 for dep 44 after
  switching to national percentiles (colours may differ, that is expected and correct).
- *Done (Oct 2026):* `--all` builds 34,746 communes in ~4 min (223 MB in `public/data/`). National view colours
  départements by Go communes (quintiles), top départements in the sidebar, click to zoom; commune polygons load
  per département. `communes-index.json` is 865 kB gzipped (target was 400 kB): fine on 4G (< 1 s), further
  savings possible with delta encoding. Search was already done in M2.

## M4 — Commune page
- Route `/commune/{code}` rendered from `commune/{code}.json`; layout as `design/Commune.dc.html`.
- Generated one-line summary (template rules, not AI).
- Pre-render static HTML for all communes at build time (SEO): one command, same locally and in CI,
  output deployed as the Pages artifact and never committed (SPEC §3.4).
- **Done when:** every section works for Clisson (44043), a tiny village with missing Filosofi data,
  and Paris.
- *Done (Oct 2026):* commune page at `/<département>/<commune>-<code>/` (SPEC §3.6) rendered by `src/commune.js`
  from `commune/<code>.json`, with a generated summary sentence, locator map, score breakdown, population since
  1968, age pyramid, competition within 10 km and takeovers, local economy, income and housing, safety and
  services, politics. 34,842 static pages + sitemap generated in ~15 s. DVF prices still to add.

## M5 — Delivery mode
- Switch, bakehouse pin, Distance / Contiguous modes (algorithm: `design/logic-reference.js`).
- Reach stats in the sidebar; national view metric switches to "communes without a bakery".
- Adjacency must cross département borders (load neighbour départements' adjacency when needed).
- **Done when:** a 40-commune contiguous block across a département border works.
- *Done (Oct 2026):* switch, Distance (5–30 km, dashed circle) and Communes voisines (2–40) modes, bakehouse pin,
  reach stats, national view by communes without a bakery, URL state (`d`, `cv`, `r`/`nb`, `b`), and a ranking of
  the **best bakehouse spots on screen** (inhabitants without a bakery within reach) that surfaces clusters such as
  north-east of Fougères. Tested: a 40-commune block from Louvigné-du-Désert spans 35, 50 and 53.

## M6 — Takeover signal
*Dropped (Yoann, Nov 22, 2026): no RNE ingestion, no `sell_soon` criterion, no takeover preset.*
- RNE ingestion (behind a feature flag until INPI terms are confirmed), aggregated `sell_soon` per commune.
- Takeover preset raises its weight.
- **Done when:** no individual-level data exists anywhere in `public/`.

## M7 — Polish & refresh
- Monthly scheduled pipeline, data vintage shown in the UI, shortlist + compare (up to 3),
  empty/error states, French copy review.

## V1 — Public launch on fournyl.com (Nov 2026)
- Brand **Fournyl** and design system (`docs/DESIGN.md`): flour paper, ink, one red, blue ↔ kraft map scale.
- Phones: map-first, no sliders, shop / round switch kept, "around me", commune details on their own page.
- PWA (manifest, icons, service worker). First-visit notice and disclaimers on the map and commune pages.
- One help page `/aide/`: method, sources and updates, terms of use, legal notice (publisher: association
  Vraie Forêt), privacy; every "?" of the interface links to it (replaced "Infos légales" and `/sources/`).
- Operations (`docs/OPERATIONS.md`): Cloudflare Web Analytics, weekly traffic email, daily monitoring,
  build failure alerts, custom domain.
- Basket `/panier/` (replaced the shortlist `/ma-selection/`): up to 5 communes, comparison and market study PDF.
- French copy review: done (Yoann, Nov 22, 2026).

## Next
- **Public transport near each bakery** (bakery page): numbers of the bus, tram, metro and train lines with a stop
  within 500 m of the shop, as on the "Ce qui attire du passage" block. Source to confirm: the GTFS feeds of
  transport.data.gouv.fr (national stop and route aggregate), lines deduplicated by network + short name.
  **Done when:** works on the 44 sample, lines shown with their network and the data's year, test on stop counts.
- **Payment:** Stripe for the basket study (1 € for 1 to 5 communes), invoice generated at payment, no account.

## Later
- Van-tour route planning (OSRM / OpenRouteService): keep in mind.

*Dropped (Yoann, Nov 22, 2026):* takeover signal (M6) and presets, user accounts, bank-specific study (the basket PDF is enough), bakeries-for-sale
alerts, broker / miller leads, communes looking for a baker, franchise access, overseas départements.

## Data to add once an open source exists
- **Market days** (jour de marché per commune): a strong signal for a baker (footfall, competition on market
  day). No national open dataset in Nov 2026; the commune page shows nothing about markets until one exists
  (not even "not available"). Watch data.gouv.fr and regional open-data portals.
