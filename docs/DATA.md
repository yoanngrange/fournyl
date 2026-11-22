# Fournyl — data guide

All sources below are French public open data. Most are under the **Licence Ouverte / Open Licence 2.0**
(Etalab), which requires attribution (source + date) — the UI footer and `meta.json` handle that.
Items marked **VERIFY** were not confirmed when this guide was written; check them first.

## 1. Join key and geography

- Key: **INSEE commune code** (`code_insee`, 5 chars). Corsica uses `2A…` / `2B…`.
- Communes merge every year ("communes nouvelles"). Freeze one **COG** vintage per run and map any
  older codes with INSEE's *table de passage* (COG history). Log every unmapped code; fail the build if > 0.1 %.
- Paris, Lyon and Marseille: keep the whole commune for the MVP (arrondissements later).
- **Boundaries:** IGN **ADMIN EXPRESS COG CARTO** (generalised, made for maps; matches the COG vintage).
  Simplify further per zoom need (e.g. `mapshaper -simplify 10% keep-shapes`). The mockup used a community
  GeoJSON derived from IGN data (github.com/gregoiredavid/france-geojson); fine for prototyping only.
- **Adjacency** (for the contiguous delivery mode): computed in the pipeline with geopandas —
  two communes are neighbours if their boundaries share a line (not just a point). Store as a list of codes.
- **Centroids:** use a point guaranteed inside the polygon (`representative_point()`), or the town-hall
  coordinates if available. Distances = haversine in km.

## 2. Sources by criterion

| Need | Source | Notes |
|---|---|---|
| Population (current) | INSEE *Populations légales* (yearly) | Official population per commune. |
| Age pyramid | INSEE census (RP), population by sex and 5-year age band, commune level | Group into 0–14, 15–29, 30–44, 45–59, 60–74, 75+ for the card; keep 5-year bands for the page. |
| Population history | INSEE census *séries historiques* (1968 → latest) | For the "population over time" chart. **Growth (decided):** average annual rate between the two census vintages 6 years apart that INSEE itself compares (currently RP 2017 → RP 2023): `((P2023 / P2017)^(1/6) − 1) × 100`, in %/year. |
| Households, housing, second homes, vacant | INSEE census (RP) housing tables | Second-home share matters: tourist communes have strong seasonal demand. |
| Commuting | INSEE census *mobilités professionnelles* (home → work flows) | "% of residents working outside the commune" and main destination. |
| Income, poverty | INSEE **Filosofi**, commune level | Statistical secrecy: **nothing is published under 50 fiscal households and 100 people**; the median is available from that threshold; the full set (incl. detailed breakdowns) generally from 1,000 households or 2,000 people. Expect gaps for small villages. |
| Existing bakeries (count) — **reference** | INSEE **BPE** (Base permanente des équipements) 2025, code **B207 Boulangerie-pâtisserie** | **Decided (Oct 2026): BPE is the count used for scoring.** INSEE cleans it (one point of sale = one equipment), whereas SIRENE also lists head offices, industrial bakeries and dormant establishments still flagged active. |
| Existing bakeries — cross-check | **SIRENE** stock of establishments (`StockEtablissement`), active (`etatAdministratifEtablissement = A`), `activitePrincipaleEtablissement` in **10.71C** (boulangerie et boulangerie-pâtisserie). Also count 10.71D (pâtisserie) and 47.24Z (retail of bread/pastry) separately. | Location by `codeCommuneEtablissement`. Used only to log the gap with BPE and for the "local economy" figures. The quality check compares BPE B207 with SIRENE **10.71C + 10.71D** (closest definition; 46,657 vs 50,675 in Oct 2026, gap 8.6 %). No SIRENE code set reproduces BPE exactly: INSEE cleans BPE. |
| Bakeries, shops, services (count) | INSEE **BPE** | **Verified on BPE 2025:** B207 Boulangerie-pâtisserie, B104 Hypermarché, B105 Supermarché, B201 Supérette, B202 Épicerie, B204 Boucherie charcuterie, B206 Poissonnerie, A504 Restaurant, D307 Pharmacie, D265 Médecin généraliste, A206–A208 poste, E107–E109 gares, C107–C109 écoles, C201/C301–C303 collèges et lycées (full list in `pipeline/config.py`; codes change between vintages). Also schools, pharmacy, doctors, post office, station from BPE. |
| Businesses by sector | SIRENE establishments, grouped by NAF section | For "local economy" bars. |
| Crime | **SSMSI** — *Bases statistiques communale, départementale et régionale de la délinquance enregistrée par la police et la gendarmerie nationales* (data.gouv.fr) | Rates per 1,000 inhabitants by indicator. Small counts are suppressed for small communes → treat as missing. **Decided:** `crime` = burglaries of homes + physical violence outside the family + thefts (armed, violent, non-violent against people), per 1,000 inhabitants, year 2025 (excluding fraud and drug offences, which reflect police activity more than local safety). **Withheld counts:** SSMSI publishes 0 and counts ≥ 5 and withholds 1–4. A withheld indicator counts as 2.5; the commune's value is dropped when that uncertainty exceeds 5 offences per 1,000 inhabitants. Coverage: 23 % of communes nationally, 72 % in dep 44 (vs 7 % if any withheld count made the value missing). Paris, Lyon, Marseille are published per arrondissement and summed from counts. |
| Property prices | **DVF** (Demandes de valeurs foncières), Etalab "géo-DVF" | Median €/m² per commune over the last 3 years, houses and flats separately. Terms forbid re-identifying people or letting search engines index individual sales — **publish aggregates only**. |
| Bakery history (openings, closures, takeovers) | **SIRENE** stock, all establishments in 10.71C incl. closed ones | Since 2016. Closure date = `dateDebut` of a closed establishment. **Takeover** = a closure matched with an opening by another SIREN in the same commune within 180 days; same SIREN = a move (ignored). Not in the score. ~1,800 takeovers/year nationally, consistent with BODACC sales. Change of legal form (EI → company) counts as a takeover (documented bias). |
| Price of a bakery business | **BODACC** commercial notices (DILA, OpenDataSoft API `annonces-commerciales`, family `vente`, activity mentions "boulang") | Price parsed from `origineFonds` ("acquis par achat au prix stipulé de …"); purchases only (no contributions in kind, no leases); corrections/cancellations skipped; duplicates (same postcode, price, year) dropped; kept between 5 k€ and 3 M€. Median and quartiles over the last 5 years per département, shown only from **20 sales**, otherwise national. ~96 % of sale notices carry a price; ~1,600 bakery sales/year. Notices name people: **only aggregates leave the pipeline** (`fonds.json`). |
| Businesses by size, main employers | **SIRENE** establishments (`trancheEffectifsEtablissement`) + **StockUniteLegale** (company name, legal form) | Size groups: none / 1–9 / 10–49 / 50–249 / 250+. Main employers: up to 3 establishments with 10+ employees, **legal entities only** (never `categorieJuridique` 1000, sole traders named after a person) and only with `statutDiffusion = O` on both establishment and company. |
| Mayor | **Répertoire national des élus**, maires file (Ministère de l'Intérieur) | Only first name and surname are exported; birth date and occupation in the file are never used. |
| Municipal election 2026 | Ministère de l'Intérieur, results per commune, round 1 (15 March) and round 2 (22 March) | Turnout (% votants), each list's full name, nuance and % of valid votes. Mayor's list = the list with the most council seats in the deciding round. Nuances exist mostly above 3,500 inhabitants. Candidate names are not in the commune file and are not used. Per list also `pct_reg` (% Voix/inscrits) and per round `blank_null` (100 − % Exprimés/votants): a single list always has 100 % of valid votes (86 of 207 communes in dep 44 in 2026). |
| Points of sale of bread (commune page map) | **SIRENE** establishments with Lambert-93 coordinates, NAF 10.71C (boulangerie), 10.71D (pâtisserie), 10.71B (cuisson de pâte à pain industrielle, "terminal de cuisson"), 47.24Z (dépôt de pain) | Within 5 km of the town hall, nearest 300 at most. Publicly released establishments only; name = shop sign, usual name, or company name for legal entities, never a sole trader's name. Basemap: IGN Plan IGN v2 WMTS (data.geopf.fr, Licence Ouverte, no key). Supermarket in-store bakeries are not in SIRENE as bakeries. Each point also carries `year` (year of `dateCreationEtablissement`: a takeover usually creates a new establishment, so this dates the current operator rather than the shop) and `here` (`codeCommuneEtablissement`, arrondissements and merged communes mapped, equals the commune): the page lists points in the commune first, then the others. |
| Hygiene of points of sale (commune page list) | **Alim'Confiance** (DGAL, ministère de l'Agriculture), `export_alimconfiance` on dgal.opendatasoft.com (CSV export, only `siret`, `date_inspection`, `app_code_synthese_eval_sanit`), Licence Ouverte | Rolling window: a result stays published one year after the inspection (~72 k inspections, ~8.8 k bakeries in Nov 2026). Joined to the SIRENE point by **SIRET** (~92 % of bakery inspections match); latest inspection per SIRET, the worse level if two on that date. Each point gets `hyg` (1 très satisfaisant, 2 satisfaisant, 3 à améliorer, 4 à corriger de manière urgente) and `hyg_date` (YYYY-MM). The SIRET is never exported. The page hides a result older than 12 months. Dep 44: ~20 % of points have one. |
| Tap-water hardness (commune page) | **Contrôle sanitaire de l'eau distribuée** (ARS / ministère de la Santé), data.gouv.fr `dis-{year}.zip`, last complete year (`WATER_YEAR`, 2025), Licence Ouverte | Parameter `TH` (titre hydrotimétrique, °f) in `DIS_RESULT`, sample → network via `DIS_PLV` (deduplicated: one row per upstream network), network → communes via `DIS_COM_UDI`. Median per network over the year, then median of the networks serving the commune, plus min/max. Classes (°f): < 7 very soft, 7–15 soft, 15–25 medium, 25–35 hard, ≥ 35 very hard. ~95 % of communes have a value; `water: null` otherwise. Hub'Eau's API lagged (2023 for Clisson in Nov 2026), so the yearly file is used. |
| Bakery pages (one per shop) | **SIRENE** establishments 10.71C / 10.71D (address, `dateCreationEtablissement`, `trancheEffectifsEtablissement` + year, `etablissementSiege`) and legal units (legal form, `dateCreationUniteLegale`) | Publicly released establishments only. Network = active 10.71C/D establishments of the same SIREN. Competitors = every point of sale of bread (10.71B/C/D, 47.24Z) within 2 km of the shop, 8 nearest, computed on Lambert-93 coordinates. Legal form codes are **int64** in the Parquet stock: always compare through `legal_codes()` (a bug compared them to the text "1000" and let sole traders through as main employers until Nov 2026). Output `data/bakery/<commune>.json`; no SIRET. |
| Published accounts (bakery pages) | **Ratios financiers BCE / INPI** (data.economie.gouv.fr, Parquet export of `siren, date_cloture_exercice, chiffre_d_affaires, resultat_net, confidentiality`, 137 MB, ~6.8 M balance sheets), Licence Ouverte | Latest closing date with a revenue > 0. Small companies may keep their accounts confidential and sole traders file none: in dep 44, 137 of 800 shops have a revenue (Nov 2026). The export is generated on the fly (~10 min) and was cut once in CI (Nov 19, 2026): only accounts closed since 2021 with a revenue are requested (41 MB). |
| Opening hours, website, phone, wheelchair (bakery pages) | **BANCO** (Base nationale des commerces ouverte, OpenStreetMap France / GéoDataMine), daily national CSV export, **ODbL** (attribution "© contributeurs OpenStreetMap" on the page) | `type` bakery or pastry. Matched to the SIRENE shop by `siret` when filled (60 % in dep 44), otherwise the nearest OSM shop within 40 m in the same commune. Dep 44: 364 of 800 shops matched, 307 with hours. The public Overpass API refuses automated national queries; do not use it in CI. |
| Accessibility (bakery pages) | **Accès Libre** (`acceslibre.csv`, data.gouv dataset 60a528e8…, daily), Licence Ouverte | ~21,600 bakeries; SIRET rarely filled (537), so matched like OSM. Entrance step-free, steps, ramp, door width and type, adapted parking, staff. Declared, not verified. Dep 44: 250 of 800. |
| Location history (bakery pages) | **SIRENE** closed establishments (`etatAdministratifEtablissement = F`), NAF 10.71B/C/D, 47.24Z | Within 15 m (70 % of closed ones have coordinates) or same number + street + postcode; same SIREN excluded (a move, not a new operator). From = `dateCreationEtablissement`, to = `dateDebut` (start of the closed period). |
| Nearby facilities (bakery pages) | **BPE 2025 géolocalisée** (Insee, `BPE25.parquet`, Lambert-93) | Counts within 500 m: C107–C109 schools, C201 collèges, C301–C303 lycées (counted apart: two different customers), E107–E109 stations, B104–B105 hyper/supermarkets, D307 pharmacies, D265 GPs, A206–A208 post. Metropolitan France only (EPSG 2154). |
| Public transport (bakery pages) | **GTFS feeds listed on transport.data.gouv.fr** (API `/api/datasets`, type public-transit, latest available GTFS resource of each dataset, any resource type) | `pipeline/transit.py` downloads the ~420 feeds to a temporary folder and keeps one table `raw/transit.parquet` (mode, network = agency name, line = short name else long name, stop or parent-station name, lat/lon), ~10 MB, built in ~2 min. Left out: on-demand transport, school-only datasets and school routes (route_type 712/713, "SCO" or "scolaire" in the route or operator name), seasonal shuttles, ferries, flights, long-distance coaches and trains (`TRANSIT_EXCLUDE`). A line published both by its network and by the regional aggregate counts once (mode + normalised network + line). Per shop: lines with a stop within 500 m (30 at most, nearest stops first), grouped by mode and network; train stops become station names, kept only if a BPE station (E107–E109) is within 300 m (some feeds code coaches or trams as rail) and merged within 300 m. Not shown in Bourgogne-Franche-Comté except Saône-et-Loire (`TRANSIT_SKIP_DEPS`): the regional coaches are not published there (Nov 2026). Coverage measured Nov 22, 2026: ~88 % of shops nationally, 89 % in Loire-Atlantique, 44 % in communes under 500 inhabitants. Licences: Licence Ouverte or ODbL depending on the network. |
| Natural risks and climate (commune) | **GASPAR** (Géorisques, `gaspar.zip`, monthly), Licence Ouverte | `ddrm_risq` top-level risks (2-digit `num_risque`); `catnat` declarations since 1982 grouped: flood (ICB, IRN, COB, LVT), drought (SEC), ground (MVT, GLT, EFA, ECB, GET, GER, AVA), storm (TMP, GRL, PDN, VCY), sea (CMV, RAZ), quake (SEI, VOL). Commune level, not the building. |
| Postcodes (display only) | **La Poste**, *Base officielle des codes postaux* (data.gouv.fr, CSV, Latin-1) | Shown instead of the INSEE code (card, search, commune page, shortlist); search also accepts a postcode or its first digits. The INSEE code stays the key in data and URLs. A commune can have several postcodes (Nantes: 4); arrondissements of Paris, Lyon, Marseille and merged communes are folded into their current commune. |
| Tourism (optional) | INSEE tourist accommodation capacity by commune | Beds in hotels/campsites; later. |
| Not available nationally | market days, foot traffic, commercial rents | Keep in the backlog. |

## 3. Pipeline (`pipeline/`)

```
pipeline/
  fetch.py        # download each source into raw/ (cached, with checksums + source dates)
  cog.py          # load COG, build code mapping for merged communes
  build_geo.py    # boundaries → simplified per-département GeoJSON, centroids, adjacency
  build_stats.py  # join all sources on code_insee, compute indicators
  score.py        # national percentile ranks per criterion
  export.py       # write public/data/*
  tests/          # row counts, uniqueness, value ranges, sample commune snapshot (44043 Clisson)
```

Run locally: `python -m pipeline.run --dep 44` (one département) or `--all`.
CI: GitHub Action monthly (SIRENE changes monthly; other sources yearly) → build → deploy Pages.

## 4. Output files (`public/data/`)

```
meta.json                    { cog_year, built_at, sources: [{id, name, vintage, url, licence}] }
departements.geojson         simplified boundaries + {code, name, n_communes}
communes-index.json          one row per commune, compact columnar JSON (~35k rows):
                               code, name, dep, cp, lat, lon, pop, bakeries,
                               cp: postcodes, space-separated, sorted ("" if unknown)
                               v:   {per_bakery, income, growth, crime, bakery_age}   // raw values, null if missing
                               pct: {per_bakery, income, growth, crime, bakery_age}   // 0..1000 ints, already inverted where lower is better
geo/{dep}.geojson            commune polygons for one département (loaded on zoom)
adj/{dep}.json               { code: [neighbour codes] }   // may include codes from adjacent départements
commune/{code}.json          everything for the commune page (pyramid, history, sectors, amenities, bread_points
                               with hyg/hyg_date and path (own page, in the shop's commune; null for other kinds),
                               water {year, th, min, max, networks, class},
                               comparisons with département and France, nearby communes)
```

`communes-index.json` drives search, the national counts per département and the scores, so keep it lean
(target ≤ 1.5 MB raw, ≤ 400 kB gzipped). Use short keys and integers.

## 4b. Optional sources (enrichment)
Sources marked `optional` in `pipeline/config.py` (INPI accounts, BANCO, Accès Libre, GASPAR, geolocated BPE,
Alim'Confiance, tap water) never stop the build: a failed download is retried 3 times, then skipped with a
warning, and the pages are built without that block (`fetch.available()`). Their tests skip in that case.
In CI, downloads run in their own step and the raw cache is saved even when a later step fails.

## 5. Quality checks (fail the build)
- Every commune in the COG appears exactly once in `communes-index.json`.
- Population total within 0.5 % of the official national total.
- Bakery count from SIRENE vs BPE differs by < 15 % nationally (log the per-département gap).
- Percentiles: min 0, max 1000 for every criterion that has values.
- Snapshot test: commune 44043 values change only when sources change.

## 6. Implementation notes (M1, October 2026)

What the real files taught us; `pipeline/config.py` holds every URL, vintage and code.

- **Insee now distributes through Melodi** (`https://api.insee.fr/melodi/file/<DATASET>/<FILE>`): zipped CSV in
  long format (one row per geography × measure). Always filter `GEO_OBJECT = COM`: the same code can also be a
  bassin de vie, an aire d'attraction, etc. Datasets used: `DS_POPULATIONS_REFERENCE` (PMUN 2023),
  `DS_RP_SERIE_HISTORIQUE` (1968–2023, also dwellings by occupancy), `DS_RP_POPULATION_PRINC` (sex × age),
  `DS_FILOSOFI_CC` (2023: `MED_SL`, `PR_MD60`), `DS_BPE` (2025).
- These files are already published on the **2026 geography**: no code mapping was needed in Oct 2026.
  The mapping (COG history + arrondissements → commune) still runs and fails the build above 0.1 % unmapped.
- **Age bands** published by sex at commune level are 0–14, 15–24, 25–39, 40–54, 55–64, 65–79, 80+
  (not the 15-year bands of the mockup). The UI uses these.
- **Second homes and vacant dwellings** come from the census history file (2023), no separate housing file.
- **Boundaries:** ADMIN EXPRESS COG CARTO 2026 as GeoParquet (`data.geopf.fr`), no 7z to unpack.
  Simplified with `shapely.coverage_simplify` (40 m) on the whole country at once, so neighbouring communes
  and départements keep identical borders. Centre point = town hall (chef-lieu layer), or a point inside the
  polygon for the 6 uninhabited Meuse communes that have none.
- **SIRENE** is no longer split by département: the national stock (Parquet, 2.2 GB) is read with column and
  row filters. Paris/Lyon/Marseille establishments carry arrondissement codes and are summed into the commune.
- **Percentiles are always national**, even when only some départements are exported
  (`--dep 44` still ranks against all of France), so colours will not shift in M3.
- **Uninhabited communes** (population 0) are not scored.
