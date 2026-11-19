# Fournyl — product spec (v0.1, October 2026)

## 1. Problem and users

A baker who wants to open or take over a bakery has to guess where demand is strong,
competition is weak and the area is pleasant to live in. The data exists (INSEE, SIRENE, etc.)
but is scattered and hard to read. Fournyl turns it into one map and one page per commune.

**Primary user:** a baker (newly qualified or experienced) choosing a location, often willing to move.
**Three bakery models:**
1. **New opening** — wants many inhabitants per bakery, growing population, decent income.
2. **Takeover** — same, plus bakeries whose owners are near retirement.
3. **Mobile / delivery** — one bakehouse serving several villages without a bakery.

**Later users (paid / B2B, not in MVP):** flour millers, franchises, business brokers, communes
looking for a baker, training centres (CAP, INBP, Chambres de métiers).

## 2. MVP scope

In: national map, commune map with filters and weights, delivery mode, commune page, search,
shareable URL state, local shortlist, all of metropolitan France + Corsica.

Out (later): accounts, payments, PDF market study, broker contact, bakeries-for-sale alerts,
van-tour route planning, overseas départements, market days, shop rents, foot traffic.

## 3. Screens

Mockups in `design/` (see `design/README.md`). Layout: left sidebar 380 px, map fills the rest.

### 3.1 National view (`design/Main.dc.html`)
- Département boundaries, coloured on a 5-step green sequential scale by the **number of communes
  scored Go** (not an average score — an average hides strong towns next to weak ones).
- With the delivery switch on, the metric becomes **number of communes without a bakery**.
- Hover tooltip: département name, metric value, number of communes.
- Click a département → zoom to it and switch to commune view.
- Sidebar: intro, delivery switch, top 6 départements for the current metric, legend.

### 3.2 Commune view (`design/Zoom.dc.html`)
- Real commune boundaries. Pan (drag), zoom (wheel, + / − / reset buttons).
- **Colour = national score** (see §4), so a commune never changes colour when panning.
  Bins: ≥75 dark green `#4D9221`, 60–74 green `#7FBC41` (Go) · 40–59 neutral `#ECEAE1` (Maybe) ·
  25–39 pink `#DE77AE`, <25 magenta `#C51B7D` (Avoid, **plus diagonal hatching**) · filtered out `#D9D2C5`.
- Top bar: breadcrumb, counts in view (go / avoid / filtered out), search, zoom buttons.
- Hover: small tooltip (name, score + label, population).
- Click: pinned dark card on the right — score, 6 key figures, age pyramid, local economy,
  score breakdown, "Open commune page →", basket button.
- Floating legend bottom-left (changes in delivery mode).

**Sidebar — filters & priorities.** One row per criterion:
- A **two-handle range slider in real units**. Its min and max are the min and max of the
  communes currently **on screen**, recomputed live on pan/zoom. The user's chosen range is kept
  in real units and clamped to the visible bounds for display.
- ~~An importance select~~ **Decided (Oct 2026): no user weights.** Weights are part of our scoring recipe,
  fixed and the same for everyone (per_bakery 3, income 2, growth 2, bakery_age 2, crime 1), explained on the sources page.
  **Small communes (Nov 2026):** for `income` and `growth` the national rank is pulled towards the middle by
  reliability = pop / (pop + 500) (`SMALL_COMMUNE_K` in `pipeline/config.py`): a 4 → 12 inhabitant commune no longer
  ranks like a town with the same rate. Shown on the commune page ("?" next to *Pourquoi cette note ?*).
  Users only filter. The current value of each handle is shown in a bubble above it; the min and max of the
  communes on screen stay visible below the track.
- "Reset filters" link.
- Communes outside any active range are shown as "filtered out" and excluded from counts.
- *Implemented (M2):* a handle left at the end of its slider is **open** (no bound on that side), so panning
  to bigger or smaller communes does not silently filter them out. Population and inhabitants per bakery
  use a **logarithmic** slider (a city and villages share one range). A missing value never filters out, except
  that a commune without a bakery counts as infinite inhabitants per bakery (Nov 2026): it passes a minimum, not a maximum.
- *Crime outliers (Nov 2026):* a few communes have huge rates because visitors, not residents, drive the figure
  (Roissy-en-France ≈ 990 ‰ with the airport, ski resorts, Saint-Tropez; national median ≈ 7 ‰). The value is kept
  and scored as is, but the crime slider ends at the 99th percentile of the communes on screen (labelled "X et +";
  the end of the slider still includes the outliers). The commune page adds a note above 100 ‰.
- *French labels:* Go / Maybe / Avoid are shown as **Favorable / À étudier / Défavorable**.

Criteria (MVP):

| key | label (FR UI) | unit | better | weight (our recipe) |
|---|---|---|---|---|
| `pop` | Population | inhabitants | — (filter only) | — |
| `per_bakery` | Habitants par boulangerie | inhabitants | higher | High (3) |
| `income` | Revenu médian | €/year/UC | higher | Medium (2) |
| `growth` | Évolution de la population | %/year | higher | Medium (2) |
| `bakery_age` | Ancienneté des boulangeries | mean years since the active 10.71C establishments were registered (Sirene); none without a bakery | higher (older shops: takeover or opening more likely) | Medium (2), Nov 2026 |
| `crime` | Taux de délinquance | offences /1,000 | lower | Low (1), on by default |
| `sell_soon` | Boulangeries à reprendre bientôt | count | higher | Low (1) — High in takeover preset |

### 3.3 Delivery mode (project switch "En boutique | En tournée")
- User clicks a commune to place the **bakehouse** (marked with a dark pin).
- Segmented control **Distance | Communes voisines**:
  - Distance: slider 5–30 km; all communes whose centroid is within that distance (dashed circle drawn).
  - Contiguous: slider 2–40 communes; grows **one connected block of touching communes**, starting from the
    bakehouse and always adding the bordering commune nearest to it (algorithm in `design/logic-reference.js`).
- Map colours in range: **no bakery = green (opportunity)**, has a bakery = neutral, outside range = faded.
- Sidebar shows: communes in range, communes without a bakery, inhabitants reached, inhabitants with no bakery,
  and (contiguous mode) distance to the furthest commune.
- *Implemented (M5):* before a bakehouse is placed, every commune is shown as with/without a bakery, so clusters of
  bakery-less villages are visible at once; the sidebar ranks the communes on screen by inhabitants without a bakery
  a bakehouse there would serve (up to 1,500 communes on screen). Score filters do not apply in this mode.
- *Nov 2026:* placing the bakehouse (click, search, or pick in the list; or the commune already selected when
  switching to this mode) frames the delivery area with ~17.5 % margin around the circle or block. Only the
  département in view and those the delivery area reaches are loaded, as in shop mode.
- *Map loading:* while commune polygons download or draw, a "Chargement des communes…" indicator shows and the
  département keeps its colour until its communes are drawn.

### 3.4 Commune page (`design/Commune.dc.html`, route `/commune/{code_insee}`)
Header: breadcrumb, shortlist, "Export market study (PDF)" (locked, Pro, later).
Hero: name, INSEE code, département, region, distance to nearest big city; score tile + label;
one-sentence summary generated from the data; 6 KPI tiles; locator map (commune + 2 rings of neighbours,
neighbours shaded by "has a bakery").
Sections: Why this score (national percentile per criterion + weight) · Who lives here (age pyramid,
under-15 and 75+ shares) · Population over time (census series since 1968, hover per point) ·
Competition (bakeries here, within 10 km, villages with none, likely to sell soon within 10 km, supermarkets,
table of nearest communes) · Local economy (SIRENE establishments by sector, food shops, cafés, jobs) ·
Income & housing (median vs département vs France, poverty rate, second homes, vacant housing, price €/m²) ·
Safety & services (crime vs département vs France, schools, pharmacy, doctors, post office, station; market day "not in open data yet") ·
Next steps (Pro teasers: bank study, bakeries for sale; opt-in "put me in touch with a broker") · Sources footer.

*Nov 19, 2026 — list and map linked:* picking a shop in the list highlights its marker (larger, ink ring, popup open; the map moves if it is off screen); picking a marker highlights its row (ink edge, tinted) and scrolls the list, not the page, to it.
*Nov 2026 — points of sale of bread (map + list within 5 km):* each point shows the level of its latest
official hygiene inspection published on Alim'Confiance (four ministry levels, with the month; four-dot
pictogram plus text, never colour), and how many of the listed points have one. Above the list, the tap-water
hardness of the commune (°f and class, with the range when the networks serving it differ by 5 °f or more)
and a short note on scaling for ovens and proofers. Neither enters the score.

Pre-render commune pages as static HTML at build time: they are valuable for SEO
("boulangerie à reprendre {commune}"). GitHub Pages has no URL rewriting, so `/commune/{code}/index.html`
must exist as a file. One build command generates all ~35k pages (≈ 10 kB each, ≈ 350 MB, under the
1 GB Pages limit); it runs the same way locally and in the GitHub Action. The pages are deployed as the
Pages artifact and **never committed** to git (a monthly refresh would otherwise add ~35k files to history).

### 3.7 Bakery page (Nov 2026, route `/<département>/<commune>-<code>/<nom>-<id>/`)
One page per active bakery and pastry shop of SIRENE (10.71C, 10.71D) released publicly; `id` = 10 hex characters
derived from the SIRET (`bakery_id`), stable across builds. Rendered by `src/boulangerie.js` from
`data/bakery/<commune>.json`; a static shell per page carries the SEO tags and, for companies, schema.org `Bakery`.
Blocks: header (name, kind, address, the commune's score) · **La boutique** (current operator since, legal form,
staff bracket and year, company created, network size, seat or secondary; hygiene; IGN map with the shop and its
competitors) · **Comptes publiés** (last revenue and net income filed as public, with the closing month; otherwise
"non publiés") · **Concurrence à moins de 2 km** (8 nearest points of sale, linked to their pages, list and map
linked) · **La commune** (score, inhabitants, per bakery, growth, income, bakeries, département business price,
link to the commune page) · **Qualité de l'eau du robinet**. The commune page links each bakery and pastry shop
(list arrow and map popup). Sole traders: see CLAUDE.md (no name, no company figures, `noindex`).

### 3.6 URLs (decided Oct 25, 2026)
| Page | URL |
|---|---|
| France (map) | `/` |
| Département (map centred on it) | `/loire-atlantique/` |
| Commune page | `/loire-atlantique/clisson-44043/` |
| Bakery page | `/loire-atlantique/clisson-44043/frangins-a15fb72f9c/` |
| Help: method, sources and updates, terms, legal notice, privacy (Nov 2026) | `/aide/` (anchors `#methode`, `#sources`, `#conditions`, `#mentions`, `#confidentialite`, one per explanation, e.g. `#eau`) |
| Basket (market study export) | `/panier/` |
`/sources/` and `/infos-legales/` (until Nov 2026) are small redirect pages to `/aide/`.
Slug = lower case, accents removed, anything else → `-` (`pipeline/pages.py` and `src/lib/slug.js`, kept identical
by a test). The INSEE code is what the site reads; a wrong or old slug, or `/commune/<code>`, is redirected by
`404.html`. The map keeps its state in the query string and `#carte=zoom/lat/lon`; the path follows the
département at the centre of the map. Pages are generated at build time (`scripts/build_site.sh`), with
`sitemap.xml` and `robots.txt`; never committed.

**Commune page layout (Nov 19, 2026):** blocks in this order, each the full width of the page: Why this score ·
Demography · Bakeries and competition · Points of sale of bread within 5 km · Tap water (hardness, networks, a
5-class scale with the commune marked) · Local economy · Income and housing ·
Safety and services · Politics. Inside a block, its parts sit side by side (`.pg-cols`) and stack on narrow screens.
**Tables:** when a table's box is narrower than 560 px (phones, or a narrow column), each row header gets a line of
its own and the values share the width below (`.stack-rows`): no sideways scrolling.
**Interface copy (Nov 2026):** no explanatory sentences on screens; a "?" links to `/aide/`.
**Ranking:** France view, top 5 départements by number of favourable communes passing the filters; département
view, top 5 communes on screen passing the filters. Not shown on phones.
**Phones (Nov 2026):** map only. Top band: logo + "Fournyl", Panier, "?", locate; the shop / round switch below.
No search, no sliders, no ranking (filters from a shared link are dropped). In round mode a bottom sheet holds the
delivery settings. Tapping a commune opens one bubble next to it (name, score, "Voir la fiche complète", basket);
no hover tooltip. Commune page: no photo; name and score stay pinned under the sticky top band.
**Crime slider:** stops at 100 per 1,000 inhabitants (or the 99th percentile on screen if lower); the open end
("100 et +") keeps outliers such as Roissy-en-France (≈ 990).
**Basket (Nov 2026):** one market study of 1 to 5 communes, exported in one PDF: a comparison grid (one column
per commune), then every detailed figure of each commune. A counter shows "n / 5" and the single price
(1 € for 1 to 5 communes); free during the launch, no payment yet. A sixth commune is refused with a notice.
**Market study PDF (Nov 19, 2026):** with 2 to 5 communes, one landscape document confronting them theme by theme
(`src/lib/compare-view.js`): one table per theme, one column per commune, header repeated on each page, the most
favourable value of a row flagged "meilleur", a bar scaled on the row under every figure. Themes: summary, why this
score (ranks), location maps side by side, demography (population indexed to 100 on one chart, one line style per
commune; age bands), bakeries and competition, points of sale of bread (maps side by side, counts by kind, hygiene),
tap water, local economy, income and housing, safety and services, politics. With one commune, its full sheet.
**Values in words** ("aucune", "non diffusé") are set smaller than figures and stay on one line; figure grids are
`<dl>` lists (label `dt`, value and note `dd`).
**Elections:** a single list always has 100 % of valid votes, so for it the page shows "liste unique" and its share
of registered voters, plus the blank and null ballots (% of voters) for every round. Market days are not shown at
all until an open source exists (see PLAN.md).

**Map card (Oct 25, 2026):** only score, inhabitants, bakeries, inhabitants per bakery, median income, and a link
"Voir la fiche complète". Everything else lives on the commune page (§3.4).

### 3.5 Help page (route `/aide/`, Nov 2026; replaced `/sources/` and `/infos-legales/`)
One page with a sticky table of contents on the left (sections and subsections; a collapsible bar on phones):
Méthode (how the score works, criteria and choices, biases and limits) · Sources et mises à jour (calendar,
one table of sources with vintage, publication, download and rhythm, checks of the last build) · Conditions
d'utilisation · Mentions légales · Confidentialité. Every "?" in the interface links to one anchor of it.
In French, plain language.
- **Sources:** for each dataset, name, producer, vintage, licence, link, what we use it for (from `meta.json`).
- **Choices:** every scoring rule and why — national percentiles, weights, the no-bakery rule, the bakery count
  source (BPE), the growth definition, the crime indicators, the "likely to sell" signal and its privacy rule.
- **Potential biases and limits:** statistical secrecy on small communes (missing ≠ 0, criterion dropped),
  BPE vs SIRENE gaps, supermarket in-store bakeries not counted as bakeries, crime recorded where reported
  (tourist and commuter communes look worse), census lag (population is 3 years old), commune mergers,
  seasonal population not captured, Paris/Lyon/Marseille kept whole.
Kept up to date with every milestone that adds or changes a criterion.

## 4. Scoring (decided)

- **National, absolute.** For each criterion, precompute each commune's **percentile rank among all French
  communes** in the pipeline (`0..1`, ties = mid-rank). Invert for "lower is better" criteria.
- Client computes `score = round(100 × Σ(wᵢ × pᵢ) / Σ(wᵢ))` over criteria with weight > 0 **and a value**.
- Weights are fixed by us (see §3.2), not set by users; percentiles never change with the view.
  Future presets (takeover, mobile) would be alternative recipes chosen by us, not free weights.
- **Inhabitants per bakery** (revised Oct 19, 2026): `per_bakery = population / bakeries`, the real figure the
  user expects; communes with no bakery have no value (shown "aucune boulangerie", ignored by that slider).
  *(An Oct 17 version used `population / (bakeries + 1)`, "yours included"; dropped because the displayed figure
  no longer matched what users read.)*
- **No-bakery boost:** for ranking, a commune with **0 bakeries** counts as `population × factor`, with
  factor **1 below 500 inhabitants** (ranked as if it had one bakery: too small to sustain one), **3 from 1,000**,
  linear in between (`NO_BAKERY_BOOST*` in `pipeline/config.py`; decided Oct 25, 2026 from the share of communes
  that do have a bakery by size: 17 % at 300–500 inhabitants, 68 % at 1,000–1,500).
- Category: Go ≥ 60, Maybe 40–59, Avoid < 40.
- Presets (open question, §7): New opening, Takeover (sell_soon = High), Mobile.

## 5. Other MVP features
- **Search:** commune name autocomplete (accent-insensitive, handles "Saint" / "St"), jumps map + opens card.
- **URL state:** view, filters, weights, mode, selected commune encoded in the query string → shareable links.
- **Basket ("panier", Nov 2026; replaced the starred shortlist, same `localStorage` key):** "Ajouter au panier"
  button on the card (icon) and the commune page (icon + text); a "Panier (n)" link in every header.
  Page `/panier/` (noindex; `/ma-selection/` redirects there): the list, remove, tick up to **5** communes to
  compare score, postcode, inhabitants, growth, bakeries, inhabitants per bakery, bakery age, income and crime;
  the most favourable value per row is marked "meilleur" (text + bold, not colour alone).
  **Export PDF:** through the browser's print dialog ("Enregistrer au format PDF"), no PDF library. The page
  builds an off-screen document — the comparison (when 2+ communes are ticked), then the full commune sheet of
  every commune in the basket (same renderer as the commune page, `src/lib/commune-view.js`), each starting on a
  new page — and prints it alone (`body.is-printing`). Maps are drawn one at a time and frozen into images
  (browsers keep ~16 WebGL contexts), markers laid over them in percentages so they follow the print width.
- **Responsive (V1, Nov 2026):** on phones (≤ 720 px) the map is the interface: no sliders or weights
  (filters from a shared link still apply, with a "Réinitialiser" link). Top bar: mark, search behind an icon,
  "around me" (geolocation asked only on tap, ~100 km across), and the *En boutique / En tournée* switch.
  Bottom sheet: ranking, plus the delivery settings in round mode. Selecting a commune shows a strip
  (name, score, link); the details open on the commune page (a real, shareable URL), not a full-screen sheet.
- **PWA:** installable (`manifest.webmanifest`), service worker `sw.js`: app shell cached per build,
  data and pages network-first with a cache of the last ~120 files viewed (all of France is ~250 MB).
- **First visit notice:** what the scores are and are not, dismissed once per browser (localStorage).

## 6. Non-functional
- First load < 2 s on 4G for the national view (national file ≤ 300 kB gzipped).
- Commune geometry loaded per département on demand.
- Works offline after first load for the app and what was already viewed (PWA, see §5).

## 7. Open questions (ask Yoann before building these)
1. ~~Product name and domain~~ **Decided (Nov 2026):** Fournyl, fournyl.com.
2. Start with 3 onboarding questions (model, where, type of place) or go straight to the map with presets?
   *For the prototype: straight to the map with the "New opening" preset.*
3. Takeover and new opening as presets of one score, or two separate scores?
4. Which reference city to show as "distance to …" on the commune page (nearest city > 50k?).
5. ~~Is the crime criterion on by default?~~ **Decided:** yes, weight Low (1).
