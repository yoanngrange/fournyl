// Market study PDF for 2 to 5 communes: every figure, chart and map of the commune sheet, confronted theme by theme.
// One table per theme, one column per commune (the header repeats on each printed page); the most favourable
// value of a row is flagged ("meilleur"), figures carry a bar scaled on the row so they compare at a glance.
// Printed in landscape (see @page compare in styles.css).
import t from '../i18n/fr.js';
import { BIN_COLOURS, CRITERIA, WEIGHTS, bin, category, score } from './scoring.js';
import { fmtCriterion, fmtEuro, fmtInt, fmtPct, fmtSigned, textClass, tr } from './format.js';
import { KIND_COLOURS, breadMap, esc, freeze, hygiene, locator, waterScale } from './commune-view.js';

/** One line style per commune for the population chart: colour and dash, so it never relies on colour alone. */
const SERIES = [
  ['#1E3F8A', ''],
  ['#B5651D', '7 4'],
  ['#2E7D4F', '2 4'],
  ['#6B3FA0', '10 4 2 4'],
  ['#1C1A17', '4 2'],
];

const dec1 = (x) => (x == null ? t['card.notPublished'] : x.toFixed(1).replace('.', ','));
const pct1 = (x) => (x == null ? t['card.notPublished'] : `${dec1(x)} %`);

/** Indexes of the best value of a row (better: 'high' | 'low'); none when fewer than 2 distinct values. */
function bestOf(vals, better) {
  if (!better) return new Set();
  const known = vals.filter((v) => v != null);
  if (known.length < 2 || new Set(known).size < 2) return new Set();
  const target = better === 'high' ? Math.max(...known) : Math.min(...known);
  return new Set(vals.flatMap((v, i) => (v === target ? [i] : [])));
}

/**
 * A row of figures. vals: raw numbers (null = missing); show: how to print one; better: 'high' | 'low' | null;
 * bars: draw a bar scaled on the row maximum.
 */
function figures(label, vals, show, { better = null, bars = true } = {}) {
  const best = bestOf(vals, better);
  const max = Math.max(...vals.filter((v) => v != null).map(Math.abs), 0) || 1;
  const cells = vals.map((v, i) => {
    const bar = bars && v != null ? `<span class="cmp-bar"><i style="width:${(100 * Math.abs(v)) / max}%"></i></span>` : '';
    const tag = best.has(i) ? ` <span class="best-tag">${t['basket.best']}</span>` : '';
    return `<td class="${best.has(i) ? 'is-best' : ''}"><span class="cmp-val${v == null ? ' is-text' : ''}">${v == null ? t['card.notPublished'] : show(v, i)}</span>${tag}${bar}</td>`;
  });
  return `<tr><th scope="row">${label}</th>${cells.join('')}</tr>`;
}

/** A row of free content (text, lists, maps): one cell per commune. */
const cellsRow = (label, cells, cls = '') => `<tr class="${cls}"><th scope="row">${label}</th>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;

/** A sub-heading across the table. */
const sub = (title, n) => `<tr class="cmp-sub"><th scope="rowgroup" colspan="${n + 1}">${title}</th></tr>`;

/** A full-width cell (charts that draw every commune together). */
const wide = (html, n) => `<tr class="cmp-wide"><td colspan="${n + 1}">${html}</td></tr>`;

function table(id, title, pages, body) {
  const head = pages
    .map((p, i) => {
      const [colour, dash] = SERIES[i];
      return `<th scope="col"><b>${esc(p.name)}</b><small>${esc(p.dep_name)}</small>
        <svg class="cmp-key" viewBox="0 0 40 6" aria-hidden="true"><line x1="0" y1="3" x2="40" y2="3" stroke="${colour}" stroke-width="3" stroke-dasharray="${dash}"/></svg></th>`;
    })
    .join('');
  return `<section class="cmp-part" aria-labelledby="${id}">
    <h2 id="${id}">${title}</h2>
    <table class="cmp-table" style="--n:${pages.length}">
      <thead><tr><th scope="col"><span class="visually-hidden">${t['basket.criterion']}</span></th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

/** Population of every commune since the first census year, indexed to 100, on one chart. */
function historyChart(pages) {
  const first = Math.max(...pages.map((p) => p.history[0]?.[0] ?? 9999));
  const series = pages.map((p) => {
    const base = p.history.find(([y]) => y >= first)?.[1];
    return p.history.filter(([y]) => y >= first).map(([y, n]) => [y, base ? (100 * n) / base : null]);
  });
  const years = [...new Set(series.flat().map(([y]) => y))].sort((a, b) => a - b);
  const vals = series.flat().map(([, v]) => v).filter((v) => v != null);
  if (years.length < 2 || !vals.length) return '';
  const lo = Math.min(100, ...vals);
  const hi = Math.max(100, ...vals);
  const W = 960;
  const H = 220;
  const L = 46;
  const B = 24;
  const x = (y) => L + ((W - L - 10) * (y - years[0])) / (years.at(-1) - years[0]);
  const yy = (v) => 10 + ((H - B - 10) * (hi - v)) / (hi - lo || 1);
  const ticks = [lo, 100, hi].filter((v, i, a) => a.indexOf(v) === i);
  const grid = ticks
    .map((v) => `<line x1="${L}" x2="${W - 10}" y1="${yy(v)}" y2="${yy(v)}" class="cmp-grid"/><text x="${L - 6}" y="${yy(v) + 4}" text-anchor="end">${Math.round(v)}</text>`)
    .join('');
  const xlabels = years.map((y) => `<text x="${x(y)}" y="${H - 6}" text-anchor="middle">${y}</text>`).join('');
  const lines = series
    .map((s, i) => {
      const pts = s.filter(([, v]) => v != null).map(([y, v]) => `${x(y).toFixed(1)},${yy(v).toFixed(1)}`).join(' ');
      const [colour, dash] = SERIES[i];
      return `<polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="2.5" stroke-dasharray="${dash}"/>`;
    })
    .join('');
  return `<p class="cmp-chart-title">${tr('basket.cmp.historyIndex', { first })}</p>
    <svg class="cmp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr('basket.cmp.historyIndex', { first }))}">${grid}${xlabels}${lines}</svg>`;
}

/** First page: the figures of the map card, side by side. */
function summary(pages) {
  const scores = pages.map((p) => score(Object.fromEntries(Object.entries(p.criteria).map(([k, v]) => [k, v.pct])), WEIGHTS));
  return [
    figures(t['basket.row.score'], scores, (v, i) => `${v} / 100 · ${t[`cat.${category(scores[i])}`]}`, { better: 'high' }),
    cellsRow(t['basket.row.cp'], pages.map((p) => esc(p.postcodes.join(', ') || '–'))),
    figures(t['card.inhabitants'], pages.map((p) => p.pop), fmtInt),
    figures(t['card.growthYearly'], pages.map((p) => p.criteria.growth.v), fmtSigned, { better: 'high' }),
    figures(t['card.bakeries'], pages.map((p) => p.bakeries), fmtInt),
    figures(t['card.perBakery'], pages.map((p) => (p.bakeries ? p.pop / p.bakeries : null)), fmtInt, { better: 'high' }),
    figures(t['crit.bakery_age'], pages.map((p) => p.criteria.bakery_age.v), (v) => fmtCriterion('bakery_age', v), { better: 'high' }),
    figures(t['card.income'], pages.map((p) => p.income.median), fmtEuro, { better: 'high' }),
    figures(t['card.crime'], pages.map((p) => p.criteria.crime.v), (v) => `${fmtCriterion('crime', v)} ‰`, { better: 'low' }),
  ].join('');
}

function why(pages) {
  const weighted = CRITERIA.filter((c) => c.weighted);
  const scores = pages.map((p) => score(Object.fromEntries(Object.entries(p.criteria).map(([k, v]) => [k, v.pct])), WEIGHTS));
  return [
    figures(t['basket.row.score'], scores, (v, i) => `<span class="swatch ${category(v) === 'avoid' ? 'is-hatched' : ''}" style="background:${BIN_COLOURS[bin(v)]}"></span> ${v} / 100 · ${t[`cat.${category(scores[i])}`]}`, { better: 'high' }),
    ...weighted.map((c) =>
      figures(
        `${t[`crit.${c.key}`]} <small>${tr('card.weight', { w: `×${c.weight}` })}</small>`,
        pages.map((p) => (p.criteria[c.key].pct == null ? null : Math.round(p.criteria[c.key].pct / 10))),
        (v) => `${v} / 100`,
        { better: 'high' },
      ),
    ),
  ].join('');
}

function demography(pages, n) {
  const first = Math.max(...pages.map((p) => p.history[0]?.[0] ?? 9999));
  const at = (p, year) => p.history.find(([y]) => y === year)?.[1] ?? null;
  const last = (p) => p.history.at(-1)?.[1] ?? null;
  const bands = pages[0].pyramid.bands;
  const share = (p, i) => {
    const total = [...p.pyramid.m, ...p.pyramid.f].reduce((a, b) => a + (b || 0), 0);
    return total ? (100 * ((p.pyramid.m[i] || 0) + (p.pyramid.f[i] || 0))) / total : null;
  };
  return [
    figures(t['card.inhabitants'], pages.map((p) => p.pop), fmtInt),
    figures(t['card.growthYearly'], pages.map((p) => p.criteria.growth.v), fmtSigned, { better: 'high' }),
    figures(tr('page.change', { first }), pages.map((p) => (at(p, first) ? (100 * (last(p) - at(p, first))) / at(p, first) : null)), fmtSigned, { better: 'high' }),
    wide(historyChart(pages), n),
    sub(`${t['card.pyramid']} · ${t['basket.cmp.shareOfPop']}`, n),
    ...bands
      .map((band, i) => figures(band, pages.map((p) => share(p, i)), pct1))
      .reverse(),
  ].join('');
}

function competition(pages, fonds) {
  const price = (p) => (fonds.departements[p.dep] || fonds.france).median;
  return [
    figures(t['card.bakeries'], pages.map((p) => p.bakeries), fmtInt),
    figures(t['card.perBakery'], pages.map((p) => (p.bakeries ? p.pop / p.bakeries : null)), fmtInt, { better: 'high' }),
    sub(tr('page.within', { km: pages[0].competition.km }), pages.length),
    figures(t['page.within.bakeries'], pages.map((p) => p.competition.bakeries), fmtInt, { better: 'low' }),
    figures(t['page.within.communes'], pages.map((p) => p.competition.communes), fmtInt),
    figures(t['page.within.without'], pages.map((p) => p.competition.communes_without_bakery), fmtInt, { better: 'high' }),
    sub(tr('card.history', { since: pages[0].bakery_history.since }).replace(/\s*:$/, ''), pages.length),
    figures(t['card.takeovers'], pages.map((p) => p.bakery_history.takeovers), fmtInt),
    figures(t['card.openings'], pages.map((p) => p.bakery_history.openings), fmtInt),
    figures(t['card.closures'], pages.map((p) => p.bakery_history.closures), fmtInt),
    figures(t['page.sireneBakeries'], pages.map((p) => p.businesses.sirene_bakeries + p.businesses.sirene_pastry), fmtInt),
    figures(t['card.fonds'], pages.map(price), fmtEuro, { better: 'low' }),
  ].join('');
}

function bread(pages) {
  const here = (p, kind) => p.bread_points.filter((b) => b.here && (!kind || b.kind === kind)).length;
  const checked = (p) => p.bread_points.filter((b) => b.here && hygiene(b));
  const worst = (p) => Math.max(0, ...checked(p).map((b) => b.hyg));
  const legend = Object.entries(KIND_COLOURS).map(([k, c]) => `<span><i style="background:${c}"></i>${t[`page.bread.${k}`]}</span>`).join('');
  return [
    cellsRow(`${t['page.bread']}<div class="pg-legend cmp-legend">${legend}</div>`, pages.map((p, i) => `<div class="cmp-map pg-bread-map" data-i="${i}"></div>`), 'cmp-maps'),
    sub(t['page.bread.here'], pages.length),
    ...Object.keys(KIND_COLOURS).map((k) => figures(t[`page.bread.${k}`], pages.map((p) => here(p, k)), fmtInt)),
    figures(t['page.bread.around'], pages.map((p) => p.bread_points.filter((b) => !b.here).length), fmtInt),
    sub(t['basket.cmp.hygiene'], pages.length),
    figures(t['basket.cmp.checked'], pages.map((p) => checked(p).length), (v, i) => tr('basket.cmp.checkedOf', { n: fmtInt(v), total: fmtInt(here(pages[i])) }), { bars: false }),
    cellsRow(t['basket.cmp.worst'], pages.map((p) => (worst(p) ? t[`page.hyg.${worst(p)}`] : '–'))),
  ].join('');
}

function water(pages) {
  return [
    figures(t['page.water.hardness'], pages.map((p) => p.water?.th ?? null), (v) => `${dec1(v)} °f`),
    cellsRow(t['page.water.scale'], pages.map((p) => (p.water ? waterScale(p.water.th) : t['page.water.none']))),
    figures(t['page.water.networks'], pages.map((p) => p.water?.networks ?? null), fmtInt, { bars: false }),
    cellsRow(t['basket.cmp.waterRange'], pages.map((p) => (!p.water ? '–' : p.water.max > p.water.min ? `${dec1(p.water.min)} – ${dec1(p.water.max)} °f` : t['basket.cmp.noGap']))),
  ].join('');
}

function economy(pages) {
  const sectors = Object.keys(pages[0].businesses.sectors);
  const sizes = Object.keys(pages[0].businesses.by_size);
  const a = (p) => p.amenities;
  return [
    figures(t['card.establishments'], pages.map((p) => p.businesses.total), fmtInt),
    figures(t['card.foodShops'], pages.map((p) => a(p).small_grocers + a(p).butchers + a(p).fishmongers), fmtInt),
    figures(t['card.supermarkets'], pages.map((p) => a(p).supermarkets), fmtInt, { better: 'low' }),
    figures(t['card.cafesRestaurants'], pages.map((p) => p.businesses.cafes + a(p).restaurants), fmtInt),
    sub(t['page.sectors'], pages.length),
    ...sectors.map((k) => figures(t[`sector.${k}`], pages.map((p) => p.businesses.sectors[k] ?? null), fmtInt)),
    sub(t['card.bySize'], pages.length),
    ...sizes.map((k) => figures(t[`card.size.${k}`], pages.map((p) => p.businesses.by_size[k] ?? null), fmtInt)),
    cellsRow(
      t['card.mainEmployers'],
      pages.map((p) =>
        p.businesses.main_employers.length
          ? `<ul class="cmp-list">${p.businesses.main_employers.map((e) => `<li>${esc(e.name)} <small>${tr('card.employees', { n: e.employees })}</small></li>`).join('')}</ul>`
          : t['card.noMainEmployer'],
      ),
    ),
  ].join('');
}

function income(pages) {
  return [
    figures(t['card.income'], pages.map((p) => p.income.median), fmtEuro, { better: 'high' }),
    figures(t['basket.cmp.depIncome'], pages.map((p) => p.income.dep_median), fmtEuro),
    figures(t['page.poverty'], pages.map((p) => p.income.poverty_pct), fmtPct, { better: 'low' }),
    figures(t['card.secondHomes'], pages.map((p) => p.housing.second_homes_pct), fmtPct),
    figures(t['page.vacant'], pages.map((p) => p.housing.vacant_pct), fmtPct, { better: 'low' }),
    figures(t['page.households'], pages.map((p) => p.housing.dwellings), fmtInt),
  ].join('');
}

function safety(pages) {
  const svc = ['primary_schools', 'secondary_schools', 'pharmacies', 'doctors', 'post', 'stations'];
  return [
    figures(t['card.crime'], pages.map((p) => p.criteria.crime.v), (v) => `${fmtCriterion('crime', v)} ‰`, { better: 'low' }),
    figures(t['basket.cmp.crimeRank'], pages.map((p) => (p.criteria.crime.pct == null ? null : Math.round(p.criteria.crime.pct / 10))), (v) => `${v} / 100`, { better: 'high' }),
    sub(t['page.services'], pages.length),
    ...svc.map((k) => figures(t[`svc.${k}`], pages.map((p) => p.amenities[k] ?? 0), fmtInt)),
  ].join('');
}

function politics(pages, year) {
  const pol = (p) => p.politics || { rounds: [] };
  const nuance = (c) => (c ? t[`nuance.${c}`] || c : t['card.noNuance']);
  const deciding = (p) => pol(p).rounds.at(-1);
  const mayorList = (p) => deciding(p)?.lists.find((l) => l.name === pol(p).list) ?? null;
  // A single list always has 100 % of valid votes: its share of registered voters says more.
  const mayorScore = (p) => {
    const l = mayorList(p);
    if (!l) return '–';
    return deciding(p).lists.length === 1
      ? `${tr('card.ofRegistered', { p: pct1(l.pct_reg) })} <small>(${t['card.singleList']})</small>`
      : pct1(l.pct);
  };
  return [
    cellsRow(t['card.mayor'], pages.map((p) => esc(pol(p).mayor || '–'))),
    cellsRow(t['card.mayorList'], pages.map((p) => esc(pol(p).list || '–'))),
    cellsRow(t['card.nuance'], pages.map((p) => (pol(p).list ? nuance(pol(p).nuance) : '–'))),
    figures(tr('basket.cmp.turnout', { year }), pages.map((p) => pol(p).rounds[0]?.turnout ?? null), pct1),
    cellsRow(t['basket.cmp.mayorScore'], pages.map(mayorScore)),
    figures(t['card.blankNull'], pages.map((p) => deciding(p)?.blank_null ?? null), (v) => tr('card.ofVoters', { p: pct1(v) })),
    cellsRow(t['basket.cmp.rounds'], pages.map((p) => (pol(p).rounds.length ? t[`basket.cmp.round${pol(p).rounds.length}`] : '–'))),
  ].join('');
}

/** The whole comparison, theme by theme. */
export function compareHTML(pages, meta, fonds) {
  const n = pages.length;
  const parts = [
    ['sum', t['basket.printCompare'], summary(pages)],
    ['why', t['page.why'], why(pages)],
    ['loc', t['page.locator'], cellsRow(t['page.locator'], pages.map((p, i) => `<div class="cmp-map pg-locator-map" data-i="${i}"></div>`), 'cmp-maps')],
    ['demo', t['card.demography'], demography(pages, n)],
    ['comp', t['page.competition'], competition(pages, fonds)],
    ['bread', t['page.bread'], bread(pages)],
    ['water', t['page.water'], water(pages)],
    ['eco', t['card.economy'], economy(pages)],
    ['inc', t['page.incomeHousing'], income(pages)],
    ['safe', t['page.safetyServices'], safety(pages)],
    ['pol', t['card.politics'], politics(pages, meta.years.election)],
  ];
  return parts.map(([id, title, body]) => table(`cmp-${id}`, title, pages, body)).join('');
}

/** Draws every map of the comparison, then freezes it into a picture (one WebGL context at a time). */
export async function wireCompare(root, pages) {
  const opts = { canvasContextAttributes: { preserveDrawingBuffer: true }, fadeDuration: 0 };
  for (const el of root.querySelectorAll('.cmp-map.pg-locator-map')) {
    const p = pages[+el.dataset.i];
    await freeze(el, await locator(el, p, opts).catch(() => null));
  }
  for (const el of root.querySelectorAll('.cmp-map.pg-bread-map')) {
    const p = pages[+el.dataset.i];
    if (p.bread_points.length) await freeze(el, await breadMap(el, p, { print: true, interactive: false, ...opts }), t['page.bread.attribution']);
    else el.outerHTML = `<p class="pg-muted small">${t['page.bread.none']}</p>`;
  }
}
