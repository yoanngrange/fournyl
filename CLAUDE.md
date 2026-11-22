# Fournyl — project instructions for Claude Code

Fournyl (fournyl.com; repo `yoanngrange/fournyl`) helps bakers choose **where in France to open or take over a bakery**.
It scores every French commune from open data and shows the result on a map.

Read these before writing code:
- `docs/SPEC.md` — what the product does, screens, scoring rules
- `docs/DATA.md` — every data source, join keys, output schemas
- `docs/PLAN.md` — milestones in order, with acceptance criteria
- `docs/DESIGN.md` — design system (colours, type, components); `design/` — early mockups (behaviour reference)

## Owner

Yoann, product manager and baker in training. He prefers pragmatic, low-overhead
architecture: static hosting, few dependencies, no backend until one is truly needed.
Explain trade-offs briefly when you deviate from this file.

## Stack (decided)

- **Front end:** static site, plain HTML + CSS + vanilla JavaScript (ES modules). No framework.
  A build step (Vite) is allowed only if MapLibre or performance makes it necessary.
- **Map:** MapLibre GL JS, rendering our own GeoJSON layers on a plain background
  (no third-party basemap needed for the MVP).
- **Data pipeline:** Python 3.12 (`pipeline/`), pandas + geopandas. Produces static JSON/GeoJSON in `public/data/`.
- **Hosting:** GitHub Pages. A GitHub Action runs the pipeline on a schedule and deploys.
- **No accounts, payments or server in the MVP.** Shortlist lives in `localStorage`.

## Conventions

- Code, comments, commit messages: English. **UI copy: French** (the users are French bakers);
  keep all UI strings in `src/i18n/fr.js` so an English version stays possible.
- Every commune is keyed by its **INSEE commune code** (`code_insee`, 5 characters, e.g. `44043`,
  Corsica `2A004`). Freeze one COG (Code officiel géographique) vintage per pipeline run.
- Never commit raw downloads (`pipeline/raw/` is git-ignored). Commit only pipeline code.
- Generated data is built in CI; do not hand-edit files in `public/data/`.
- Every number shown in the UI must carry its year (see DATA.md); sources are listed once at the bottom of the
  commune page and on the help page (`/aide/`), not under each section title.
- **Few words in the interface** (Nov 2026): no explanatory sentences, hints or notes on screens. An explanation
  goes on the help page (`/aide/`) and the interface links to it with a "?" (`helpLink()` in `src/lib/format.js`).
- Missing values are normal (statistical secrecy on small communes). Show "non diffusé",
  never 0, and drop that criterion from the score for that commune (re-normalise weights).
- Accessibility: real buttons/inputs/labels, keyboard access to map features (search + list),
  text contrast 4.5:1, never colour alone (Avoid areas are also hatched).

## Privacy (non-negotiable)

- The "bakeries likely to sell soon" signal uses company directors' birth years (RNE).
  **Only aggregated counts per commune are ever stored in `public/data` or shown.**
  Never output an individual business with an age or a "likely to sell" flag.
- **Bakery pages** (one per bakery / pastry shop, Nov 2026) show public SIRENE facts about the shop. The SIRET
  never leaves the pipeline (pages use `bakery_id`). A sole trader (entreprise individuelle) is a person: never
  named (shop sign only). Nothing about directors. Every page is indexed (decided by Yoann, Nov 19, 2026).
- No lead sharing with brokers or millers, and no user accounts (decided Nov 22, 2026). Payment, when it comes,
  only generates an invoice.

## Definition of done for any task

1. It works on the Loire-Atlantique (44) sample end to end.
2. Pipeline steps have a small test (row counts, no duplicate codes, value ranges).
3. UI checked at 1440 px and 390 px wide.
4. Docs updated if behaviour changed.
