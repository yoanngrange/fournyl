// Commune sheet: everything we know about one commune, from data/commune/<code>.json. Rendered on the
// commune page (src/commune.js) and, one after the other, in the basket's PDF export (src/panier.js).
import * as maplibregl from '../../vendor/maplibre-gl-6.11.2/maplibre-gl.mjs';
import t from '../i18n/fr.js';
import { BIN_COLOURS, CRITERIA, WEIGHTS, bin, category, score } from './scoring.js';
import { fmtCriterion, fmtEuro, fmtInt, fmtPct, fmtSigned, helpLink, textClass, tr } from './format.js';
import { depPath } from './slug.js';
import { basketButton } from './basket.js';

export const getJSON = (path) => fetch(`data/${path}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(path))));
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const pct1 = (x) => (x == null ? '—' : `${x.toFixed(1).replace('.', ',')} %`);

const row = (label, value, hint = '') =>
  `<div class="pg-row"><span>${label}${hint ? ` <small>${hint}</small>` : ''}</span><b class="${textClass(value).trim()}">${value}</b></div>`;
/** One figure of a figures grid (<dl class="pg-tiles">): label, value, and an optional note (year, unit). */
const tile = (label, value, sub = '') =>
  `<div class="pg-tile"><dt>${label}</dt><dd class="pg-tile-v${textClass(value)}">${value}</dd>${sub ? `<dd class="pg-tile-sub">${sub}</dd>` : ''}</div>`;
/** Parts of a block side by side on wide screens (one column each), stacked on phones. */
const cols = (...parts) => `<div class="pg-cols">${parts.filter(Boolean).map((x) => `<div>${x}</div>`).join('')}</div>`;

/** A block of the sheet; help: anchor on the help page, shown as a "?" next to the title. */
const section = (id, title, help, body) =>
  `<section class="pg-card" aria-labelledby="${id}">
    <h2 id="${id}">${title}${help ? helpLink(help, esc(title.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())) : ''}</h2>${body}</section>`;
const bar = (label, value, share, text) =>
  `<div class="pg-bar"><span>${label}</span><div class="pg-bar-track"><i style="width:${Math.max(0, Math.min(100, share))}%"></i></div><b>${text ?? value}</b></div>`;

// ---------- blocks ----------

function summary(p) {
  const pb = p.criteria.per_bakery;
  const first = !p.bakeries
    ? tr(p.pop >= 1000 ? 'page.sum.noBakeryBig' : 'page.sum.noBakerySmall', { pop: fmtInt(p.pop) })
    : tr('page.sum.perBakery', {
        per: fmtInt(p.pop / p.bakeries),
        level: t[`page.sum.level.${pb.pct >= 700 ? 'high' : pb.pct >= 300 ? 'mid' : 'low'}`],
      });
  const g = p.criteria.growth.v;
  const second =
    g == null ? null : g > 0.3 ? tr('page.sum.growthUp', { g: fmtPct(g) }) : g < -0.3 ? tr('page.sum.growthDown', { g: fmtPct(-g) }) : t['page.sum.growthFlat'];
  const inc = p.income;
  const third =
    inc.median == null || inc.dep_median == null || inc.median === inc.dep_median // Paris: commune = département
      ? null
      : t[inc.median > inc.dep_median ? 'page.sum.incomeAbove' : 'page.sum.incomeBelow'];
  const parts = [first, second, third].filter(Boolean);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts.at(-1)}` : parts[0];
  return `${text}.`;
}


function why(p) {
  const rows = CRITERIA.filter((c) => c.weighted)
    .map((c) => {
      const crit = p.criteria[c.key];
      const rank = crit.pct == null ? null : Math.round(crit.pct / 10);
      const weight = `<span class="pg-why-weight">${tr('card.weight', { w: `×${c.weight}` })}</span>`;
      if (rank == null) {
        // Missing value: said once, on the right, with the consequence; no empty bar.
        return `<div class="pg-why is-missing">
          <div class="pg-why-head">
            <span class="pg-why-label">${t[`crit.${c.key}`]}</span>
            <span class="pg-why-rank"><span class="pg-why-na">${t['card.notPublished']}</span>
              <span class="pg-why-weight">${t['page.why.notCounted']}</span></span>
          </div>
        </div>`;
      }
      const value =
        c.key === 'per_bakery' && !p.bakeries
          ? t['page.why.noBakery']
          : `${fmtCriterion(c.key, crit.v)}${c.key === 'crime' ? ' ‰' : ''}`;
      return `<div class="pg-why">
        <div class="pg-why-head">
          <span class="pg-why-label">${t[`crit.${c.key}`]} <small>${value}</small></span>
          <span class="pg-why-rank"><span><b>${rank}</b><small> / 100</small></span>${weight}</span>
        </div>
        <div class="pg-bar-track"><i style="width:${rank}%"></i></div>
      </div>`;
    })
    .join('');
  return `<div class="pg-why-grid">${rows}</div>`;
}

/** Section title with the score. */
function whyTitle(s) {
  return `<span class="pg-why-title">${t['page.why']}${s == null ? '' : ` <span class="pg-why-score">${tr('page.why.score', { s })}</span>`}</span>`;
}

/**
 * The top band (logo + breadcrumb) is sticky. Once the name/score block has scrolled under it,
 * a compact copy slides in just below the band.
 * It is a separate fixed bar, so showing it never changes the page height (a sticky block that shrank
 * when stuck made the page jump back and forth at the threshold). Visual only: the block itself stays
 * in the page for screen readers.
 */
export function stickyHead(root) {
  const head = root.querySelector('.pg-head');
  if (!head) return;
  const bar = document.createElement('div');
  bar.className = 'pg-fixbar';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = `<div class="pg-fixbar-inner">
      <div class="pg-fixbar-id"><b>${head.querySelector('.page-title').innerHTML}</b><small>${head.querySelector('.pg-muted').innerHTML}</small></div>
      <div class="pg-fixbar-score">${head.querySelector('.pg-score').innerHTML}</div>
    </div>`;
  document.body.append(bar);
  const top = document.querySelector('.page-top');
  let topH = 0, queued = false;
  const update = () => {
    queued = false;
    bar.classList.toggle('is-on', head.getBoundingClientRect().bottom <= topH);
  };
  const measure = () => {
    topH = top ? top.offsetHeight : 0;
    document.documentElement.style.setProperty('--top-h', `${topH}px`);
    update();
  };
  if (top && 'ResizeObserver' in window) new ResizeObserver(measure).observe(top);
  measure();
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
}

function historyChart(history) {
  if (history.length < 2) return '';
  const W = 600;
  const H = 220;
  const pad = { l: 56, r: 16, t: 20, b: 28 };
  const years = history.map(([y]) => y);
  const max = Math.max(...history.map(([, v]) => v));
  const step = 10 ** Math.floor(Math.log10(max || 1));
  const top = Math.ceil(max / step) * step || 1;
  const x = (y) => pad.l + ((y - years[0]) / (years.at(-1) - years[0] || 1)) * (W - pad.l - pad.r);
  const yy = (v) => H - pad.b - (v / top) * (H - pad.t - pad.b);
  const grid = [0, 0.5, 1]
    .map((f) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy(top * f)}" y2="${yy(top * f)}" class="grid"/>
      <text x="${pad.l - 8}" y="${yy(top * f)}" text-anchor="end" dominant-baseline="middle">${fmtInt(top * f)}</text>`)
    .join('');
  const points = history.map(([y, v]) => `${x(y)},${yy(v)}`).join(' ');
  const dots = history
    .map(([y, v]) => `<g><circle cx="${x(y)}" cy="${yy(v)}" r="12" fill="transparent"><title>${tr('page.historyPoint', { year: y, pop: fmtInt(v) })}</title></circle>
      <circle cx="${x(y)}" cy="${yy(v)}" r="4" class="dot"/></g>`)
    .join('');
  const labels = history.map(([y]) => `<text x="${x(y)}" y="${H - 8}" text-anchor="middle">${y}</text>`).join('');
  const desc = history.map(([y, v]) => tr('page.historyPoint', { year: y, pop: fmtInt(v) })).join(' ; ');
  const data = history.map(([y, v]) => [Math.round(x(y)), Math.round(yy(v)), y, fmtInt(v)]);
  return `<div class="pg-chart-wrap" data-w="${W}" data-h="${H}" data-points='${JSON.stringify(data)}'>
    <svg class="pg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}">${grid}
    <polyline points="${points}" class="line"/>${dots}${labels}
    <line class="guide" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
    <circle class="dot-on" r="6" visibility="hidden"/></svg>
    <div class="pg-chart-tip" hidden></div></div>`;
}

/** Population chart: the nearest census value follows the pointer (desktop) or the finger (tap). */
function wireChart(wrap) {
  const svg = wrap.querySelector('svg');
  const tip = wrap.querySelector('.pg-chart-tip');
  const guide = svg.querySelector('.guide');
  const dot = svg.querySelector('.dot-on');
  const data = JSON.parse(wrap.dataset.points);
  const W = Number(wrap.dataset.w);
  const show = (clientX) => {
    const box = svg.getBoundingClientRect();
    const vx = ((clientX - box.left) / box.width) * W;
    const [px, py, year, pop] = data.reduce((a, b) => (Math.abs(b[0] - vx) < Math.abs(a[0] - vx) ? b : a));
    guide.setAttribute('x1', px);
    guide.setAttribute('x2', px);
    dot.setAttribute('cx', px);
    dot.setAttribute('cy', py);
    guide.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');
    tip.textContent = tr('page.historyPoint', { year, pop });
    tip.hidden = false;
    const k = box.width / W;
    const left = Math.min(Math.max(px * k, tip.offsetWidth / 2), box.width - tip.offsetWidth / 2);
    tip.style.left = `${left}px`;
    tip.style.top = `${py * k}px`;
  };
  const hide = () => {
    tip.hidden = true;
    guide.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
  };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hide();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!wrap.contains(e.target)) hide(); // a tap elsewhere closes it on touch screens
  });
}

function pyramid(p) {
  const total = [...p.pyramid.m, ...p.pyramid.f].reduce((a, b) => a + (b || 0), 0) || 1;
  const max = Math.max(...p.pyramid.m, ...p.pyramid.f) || 1;
  const rows = p.pyramid.bands
    .map((band, i) => ({ band, m: p.pyramid.m[i] || 0, f: p.pyramid.f[i] || 0 }))
    .reverse()
    .map(({ band, m, f }) => {
      const mp = ((100 * m) / total).toFixed(1).replace('.', ',');
      const fp = ((100 * f) / total).toFixed(1).replace('.', ',');
      return `<div class="pyr-row" role="listitem" aria-label="${tr('card.pyramidRow', { band, m: mp, f: fp })}">
        <div class="pyr-m"><span>${mp}</span><i style="width:${(100 * m) / max}%"></i></div>
        <div class="pyr-band" aria-hidden="true">${band}</div>
        <div class="pyr-f"><i style="width:${(100 * f) / max}%"></i><span>${fp}</span></div>
      </div>`;
    })
    .join('');
  return `<h3>${t['card.pyramid']}</h3><div class="pyr-head" aria-hidden="true"><span>${t['card.men']}</span><span>${t['card.women']}</span></div>
    <div role="list">${rows}</div>`;
}

function competition(p, fonds, depName) {
  const c = p.competition;
  const h = p.bakery_history;
  const nearby = p.nearby
    .map(
      (n) => `<tr${n.code === p.code ? ' class="is-here"' : ''}><th scope="row">${esc(n.name)}</th><td>${n.km.toFixed(1).replace('.', ',')} km</td>
        <td>${fmtInt(n.pop)}</td><td>${n.bakeries ? fmtInt(n.bakeries) : t['card.none']}</td></tr>`,
    )
    .join('');
  const dep = fonds.departements[p.dep];
  const prices = dep || fonds.france;
  const since = new Date(fonds.since).getFullYear();
  const priceHint = dep
    ? tr('card.fondsDep', { dep: esc(depName), n: fmtInt(dep.n), since, q1: fmtEuro(dep.q1), q3: fmtEuro(dep.q3) })
    : tr('card.fondsFrance', { n: fmtInt(prices.n), since, q1: fmtEuro(prices.q1), q3: fmtEuro(prices.q3) });
  // No bakery: one statement and where the nearest one is, instead of two tiles both saying "aucune".
  const closest = p.nearby.filter((n) => n.code !== p.code && n.bakeries).sort((a, b) => a.km - b.km)[0];
  const head = p.bakeries
    ? `<dl class="pg-tiles is-2">
      ${tile(t['card.bakeries'], fmtInt(p.bakeries))}
      ${tile(t['card.perBakery'], fmtInt(p.pop / p.bakeries))}
    </dl>`
    : `<div class="pg-none">
      <b>${t['page.noBakery']}</b>
      ${closest ? `<span>${tr('page.noBakery.closest', { name: esc(closest.name), km: closest.km.toFixed(1).replace('.', ',') })}</span>` : ''}
    </div>`;
  return cols(
    `${head}
    <h3>${tr('page.within', { km: c.km })}</h3>
    ${row(t['page.within.bakeries'], fmtInt(c.bakeries))}
    ${row(t['page.within.communes'], fmtInt(c.communes))}
    ${row(t['page.within.without'], fmtInt(c.communes_without_bakery))}`,
    `<h3>${tr('card.history', { since: h.since })}</h3>
    ${row(t['card.takeovers'], fmtInt(h.takeovers))}
    ${row(t['card.openings'], fmtInt(h.openings))}
    ${row(t['card.closures'], fmtInt(h.closures))}
    ${row(t['page.sireneBakeries'], fmtInt(p.businesses.sirene_bakeries + p.businesses.sirene_pastry))}
    <div class="pg-row pg-price"><span>${t['card.fonds']}<small>${priceHint}</small></span><b>${fmtEuro(prices.median)}</b></div>`,
    `<h3>${t['page.nearby']}</h3>
    <div class="pg-table-wrap"><table class="pg-table stack-rows" style="--cols:3">
      <thead><tr><th scope="col">${t['page.nearby.commune']}</th><th scope="col">${t['page.nearby.km']}</th>
        <th scope="col">${t['page.nearby.pop']}</th><th scope="col">${t['page.nearby.bakeries']}</th></tr></thead>
      <tbody>${nearby}</tbody></table></div>`,
  );
}

function economy(p) {
  const a = p.amenities;
  const b = p.businesses;
  const sectors = Object.entries(b.sectors).sort((x, y) => y[1] - x[1]);
  const maxSector = Math.max(...sectors.map(([, n]) => n), 1);
  const sizes = Object.entries(b.by_size).map(([k, n]) => row(t[`card.size.${k}`], fmtInt(n))).join('');
  const employers = b.main_employers.length
    ? b.main_employers.map((e) => row(esc(e.name), tr('card.employees', { n: e.employees }))).join('')
    : `<p class="pg-muted">${t['card.noMainEmployer']}</p>`;
  return cols(
    `${row(t['card.establishments'], fmtInt(b.total))}
    ${row(t['card.foodShops'], fmtInt(a.small_grocers + a.butchers + a.fishmongers))}
    ${row(t['card.supermarkets'], fmtInt(a.supermarkets))}
    ${row(t['card.cafesRestaurants'], fmtInt(b.cafes + a.restaurants))}
    <h3>${t['card.mainEmployers']}</h3>${employers}`,
    `<h3>${t['page.sectors']}</h3>
    ${sectors.map(([k, n]) => bar(t[`sector.${k}`], n, (100 * n) / maxSector, fmtInt(n))).join('')}`,
    `<h3>${t['card.bySize']}</h3>${sizes}`,
  );
}

function incomeHousing(p, depName) {
  const i = p.income;
  const vals = [
    [p.name, i.median],
    [depName, i.dep_median],
    ['France', i.france_median],
  ];
  const max = Math.max(...vals.map(([, v]) => v || 0), 1);
  return cols(
    `<h3>${t['page.incomeCompare']}</h3>
    ${vals.map(([label, v]) => bar(esc(label), v, (100 * (v || 0)) / max, fmtEuro(v))).join('')}`,
    `${row(t['page.poverty'], i.poverty_pct == null ? t['card.notPublished'] : fmtPct(i.poverty_pct))}
    ${row(t['card.secondHomes'], fmtPct(p.housing.second_homes_pct))}
    ${row(t['page.vacant'], fmtPct(p.housing.vacant_pct))}
    ${row(t['page.households'], fmtInt(p.housing.dwellings))}`,
  );
}

function safetyServices(p) {
  const crime = p.criteria.crime;
  const a = p.amenities;
  const svc = ['primary_schools', 'secondary_schools', 'pharmacies', 'doctors', 'post', 'stations']
    .map((k) => row(t[`svc.${k}`], a[k] ? fmtInt(a[k]) : t['card.none']))
    .join('');
  return cols(
    `<dl class="pg-tiles is-1">${tile(
      t['card.crime'],
      crime.v == null ? t['card.notPublished'] : `${fmtCriterion('crime', crime.v)} ‰`,
      crime.pct == null ? t['card.crime.sub'] : tr('page.crimeRank', { p: Math.round(crime.pct / 10) }),
    )}</dl>`,
    `<h3>${t['page.services']}</h3>${svc}`,
  );
}

function politics(pol, year) {
  if (!pol || (!pol.mayor && !pol.rounds.length)) return `<p class="pg-muted">${t['card.noPolitics']}</p>`;
  const nuance = (c) => (c ? t[`nuance.${c}`] || c : t['card.noNuance']);
  const head = [
    pol.mayor ? row(t['card.mayor'], esc(pol.mayor)) : '',
    pol.list ? row(t['card.mayorList'], esc(pol.list)) : '',
    pol.list ? row(t['card.nuance'], nuance(pol.nuance)) : '',
  ].join('');
  // Mayor first, then one column per round.
  // A single list always has 100 % of valid votes: show its share of registered voters instead, and the
  // blank and null ballots (the votes cast against it).
  const rounds = pol.rounds.map((r) => {
    const single = r.lists.length === 1;
    const lists = r.lists
      .map((l) =>
        single && l.pct_reg != null
          ? bar(`${esc(l.name)} <small>${t['card.singleList']} · ${nuance(l.nuance)}</small>`, l.pct_reg, l.pct_reg, tr('card.ofRegistered', { p: pct1(l.pct_reg) }))
          : bar(`${esc(l.name)} <small>${nuance(l.nuance)}</small>`, l.pct, l.pct || 0, pct1(l.pct)),
      )
      .join('');
    const blank = r.blank_null == null ? '' : row(t['card.blankNull'], tr('card.ofVoters', { p: pct1(r.blank_null) }));
    return `<h3>${tr('card.round', { year, n: r.round === 1 ? '1er' : '2nd', turnout: pct1(r.turnout) })}</h3>${lists}${blank}`;
  });
  return cols(head, ...rounds);
}

// ---------- locator map ----------

/** [west, south, east, north] of a GeoJSON geometry. */
function bbox(geometry) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]);
      b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]);
      b[3] = Math.max(b[3], c[1]);
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return b;
}

/** The commune and its neighbours, neighbours shaded by whether they have a bakery. */
export async function locator(el, p, mapOptions = {}) {
  const deps = [...new Set([p.dep, ...p.neighbours.map((n) => n.code.slice(0, 2))])];
  const geos = await Promise.all(deps.map((d) => getJSON(`geo/${d}.geojson`).catch(() => null)));
  const kinds = new Map([[p.code, 'here'], ...p.neighbours.map((n) => [n.code, n.bakeries ? 'with' : 'without'])]);
  const names = new Map([[p.code, p.name], ...p.neighbours.map((n) => [n.code, n.name])]);
  const features = geos
    .filter(Boolean)
    .flatMap((g) => g.features)
    .filter((f) => kinds.has(f.properties.code))
    .map((f) => ({ ...f, properties: { ...f.properties, kind: kinds.get(f.properties.code) } }));
  if (!features.length) return null;
  const boxes = features.map((f) => bbox(f.geometry));
  const all = [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
  const map = new maplibregl.Map({
    container: el,
    interactive: false,
    attributionControl: false,
    ...mapOptions,
    bounds: [[all[0], all[1]], [all[2], all[3]]],
    fitBoundsOptions: { padding: 16 },
    style: {
      version: 8,
      sources: { c: { type: 'geojson', data: { type: 'FeatureCollection', features } } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#F2ECDF' } },
        {
          id: 'fill',
          type: 'fill',
          source: 'c',
          paint: { 'fill-color': ['match', ['get', 'kind'], 'here', '#FF0000', 'without', '#9BB0DA', '#DCD3C2'] },
        },
        { id: 'line', type: 'line', source: 'c', paint: { 'line-color': '#FAF6EC', 'line-width': 1.2 } },
      ],
    },
  });
  const markers = features.map((f, i) => {
    const [w, s, e, n] = boxes[i];
    const label = document.createElement('div');
    label.className = `map-label${f.properties.kind === 'here' ? ' is-here' : ''}`;
    label.textContent = names.get(f.properties.code);
    label.setAttribute('aria-hidden', 'true');
    return new maplibregl.Marker({ element: label }).setLngLat([(w + e) / 2, (s + n) / 2]);
  });
  map.once('load', () => markers.forEach((m) => m.addTo(map)));
  return { map, markers };
}

/** Every postcode of the commune (Nantes has four); the INSEE code is never shown. */
const postcodes = (list = []) =>
  list.length > 1 ? tr('cp.list', { list: list.join(', ') }) : list.length ? tr('cp.one', { cp: list[0] }) : '';

// ---------- points of sale of bread (IGN street map) ----------

const IGN_PLAN =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2' +
  '&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png';
export const KIND_COLOURS = { bakery: '#FF0000', pastry: '#E08A5A', bake_off: '#1E3F8A', retail: '#8A8172' };

const monthYear = (ym) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

/** Alim'Confiance publishes a result for one year: one older than that (data built a while ago) is not shown. */
export function hygiene(b) {
  if (!b.hyg || !b.hyg_date) return null;
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - 1);
  return new Date(`${b.hyg_date}-28`) >= limit ? { level: b.hyg, date: monthYear(b.hyg_date) } : null;
}

const hygieneText = (h) => `${tr('page.hyg', { level: t[`page.hyg.${h.level}`] })} (${tr('page.hyg.on', { date: h.date })})`;

function breadRow(b) {
  const since = b.year ? ` · ${tr('page.bread.since', { year: b.year })}` : '';
  const h = hygiene(b);
  const hyg = h ? `<small class="pg-hyg is-${h.level}"><i aria-hidden="true">${'●'.repeat(5 - h.level)}${'○'.repeat(h.level - 1)}</i> ${hygieneText(h)}</small>` : '';
  return `<li><span class="pg-dot" style="background:${KIND_COLOURS[b.kind]}"></span>
    <span>${b.name ? esc(b.name) : `<i>${t['page.bread.noName']}</i>`} <small>${t[`page.bread.${b.kind}`]}${since}</small>${hyg}</span>
    <b>${b.km.toFixed(1).replace('.', ',')} km</b></li>`;
}

/** Tap water hardness of the commune (median of the networks serving it). */
/** Hardness classes in °f (pipeline/config.py WATER_CLASSES); the scale stops at 50 °f. */
const WATER_SCALE = [[0, 7, 'very_soft'], [7, 15, 'soft'], [15, 25, 'medium'], [25, 35, 'hard'], [35, 50, 'very_hard']];

/** The five classes side by side, widths in °f, a marker at the commune's value (position and label, not colour). */
export function waterScale(th) {
  const top = WATER_SCALE.at(-1)[1];
  const segs = WATER_SCALE.map(
    ([lo, hi, cls]) => `<div class="pg-scale-seg${th != null && th >= lo && (th < hi || hi === top) ? ' is-on' : ''}" style="flex:${hi - lo}">
      <i></i><span>${t[`page.water.${cls}`]}</span><small>${lo === 0 ? '' : lo}</small></div>`,
  ).join('');
  const marker = th == null ? '' : `<b class="pg-scale-mark" style="left:${(100 * Math.min(th, top)) / top}%" aria-hidden="true"></b>`;
  return `<div class="pg-scale-wrap"><div class="pg-scale" role="img" aria-label="${esc(t['page.water.scale'])}">${marker}${segs}</div></div>`;
}

/** Tap water block: hardness of the commune, the networks serving it, and where it sits on the scale. */
function water(p) {
  const w = p.water;
  if (!w) return `<p class="pg-muted">${t['page.water.none']}</p>`;
  const dec = (x) => x.toFixed(1).replace('.', ',');
  const range = w.max - w.min >= 5 ? `<p class="pg-muted small">${tr('page.water.range', { min: dec(w.min), max: dec(w.max) })}</p>` : '';
  return cols(
    `<dl class="pg-tiles is-2">
      ${tile(t['page.water.hardness'], `${dec(w.th)} °f`, tr('page.water.sub', { cls: t[`page.water.${w.class}`], year: w.year }))}
      ${tile(t['page.water.networks'], fmtInt(w.networks))}
    </dl>${range}`,
    `<h3>${t['page.water.scale']}</h3>${waterScale(w.th)}`,
  );
}

/** Points of sale in the commune first, then the others within 5 km; nearest first in each group. */
function breadList(p) {
  if (!p.bread_points.length) return `<p class="pg-muted">${t['page.bread.none']}</p>`;
  const here = p.bread_points.filter((b) => b.here);
  const around = p.bread_points.filter((b) => !b.here);
  const checked = p.bread_points.filter(hygiene).length;
  const count = `<p class="pg-muted small pg-hyg-count">${checked ? tr('page.hyg.count', { n: fmtInt(checked), total: fmtInt(p.bread_points.length) }) : t['page.hyg.countNone']}.</p>`;
  const group = (title, list, empty) => `<h3 class="pg-points-title">${title} <span>${fmtInt(list.length)}</span></h3>
    ${list.length ? `<ul class="pg-points">${list.map(breadRow).join('')}</ul>` : `<p class="pg-muted small">${empty}</p>`}`;
  return `${count}<div class="pg-points-wrap">${group(t['page.bread.here'], here, t['page.bread.hereNone'])}${
    around.length ? group(t['page.bread.around'], around, '') : ''}</div>`;
}

const BREAD_RADIUS_KM = 5; // same radius as the pipeline (build_local.BREAD_RADIUS_M)

/** A circle of radius km around [lon, lat], as a GeoJSON polygon (equirectangular approximation). */
function disc(lon, lat, km, steps = 96) {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const ring = Array.from({ length: steps + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / steps;
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
  });
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

export function breadMap(el, p, { print = false, ...mapOptions } = {}) {
  if (!p.bread_points.length) return null;
  const area = disc(p.lon, p.lat, BREAD_RADIUS_KM);
  const ring = area.geometry.coordinates[0];
  const lons = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  const map = new maplibregl.Map({
    container: el,
    bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    fitBoundsOptions: { padding: 16 },
    cooperativeGestures: true, // the page keeps scrolling; ctrl/two fingers to move the map
    attributionControl: print ? false : { compact: true, customAttribution: t['page.bread.attribution'] },
    ...mapOptions,
    style: {
      version: 8,
      sources: {
        plan: { type: 'raster', tiles: [IGN_PLAN], tileSize: 256, maxzoom: 18 },
        area: { type: 'geojson', data: area },
      },
      layers: [
        { id: 'plan', type: 'raster', source: 'plan' },
        // The 5 km search area of the list beside the map.
        { id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#1E3F8A', 'fill-opacity': 0.25 } },
        { id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#1E3F8A', 'line-width': 2 } },
      ],
    },
  });
  if (!print) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const townHall = document.createElement('div');
  townHall.className = 'bakehouse-pin';
  const markers = [new maplibregl.Marker({ element: townHall }).setLngLat([p.lon, p.lat]).addTo(map)];
  for (const b of p.bread_points) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bread-pin';
    el.style.background = KIND_COLOURS[b.kind];
    el.setAttribute('aria-label', `${b.name || t['page.bread.noName']}, ${t[`page.bread.${b.kind}`]}`);
    const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
      `<b>${b.name ? esc(b.name) : t['page.bread.noName']}</b><br>${t[`page.bread.${b.kind}`]}${b.year ? ` · ${tr('page.bread.since', { year: b.year })}` : ''} · ${b.km.toFixed(1).replace('.', ',')} km${hygiene(b) ? `<br>${hygieneText(hygiene(b))}` : ''}`,
    );
    markers.push(new maplibregl.Marker({ element: el }).setLngLat([b.lon, b.lat]).setPopup(popup).addTo(map));
  }
  return { map, markers };
}

// ---------- photo (Wikimedia Commons) ----------

const stripTags = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return div.textContent.trim();
};

/** Banner photo with its author and licence, asked from Commons so the credit is always current. */
async function photo(el, p) {
  const file = p.wiki?.file;
  if (!file) return;
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  api.search = new URLSearchParams({
    action: 'query',
    titles: `File:${file}`,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1600',
    format: 'json',
    origin: '*',
  });
  const data = await fetch(api).then((r) => r.json());
  const info = Object.values(data.query?.pages || {})[0]?.imageinfo?.[0];
  if (!info?.thumburl) return;
  const meta = info.extmetadata || {};
  const author = stripTags(meta.Artist?.value) || t['page.photo.unknownAuthor'];
  const licence = stripTags(meta.LicenseShortName?.value);
  el.innerHTML = `<img src="${esc(info.thumburl)}" alt="${esc(tr('page.photo.alt', { name: p.name }))}" loading="eager">
    <figcaption>${esc(tr('page.photo.credit', { author, licence }))} · <a href="${esc(info.descriptionurl)}">Wikimedia Commons</a></figcaption>`;
  el.hidden = false;
}

// ---------- sheet ----------

/**
 * HTML of the whole sheet. idp: prefix for element ids (several sheets in one document);
 * actions: map link and basket button (left out of the PDF).
 */
export function communeHTML(p, meta, fonds, { idp = '', actions = true, inBasket = false } = {}) {
  const y = meta.years;
  const pct = Object.fromEntries(Object.entries(p.criteria).map(([k, v]) => [k, v.pct]));
  const s = score(pct, WEIGHTS);
  const cat = category(s);
  const sirene = meta.sources.find((x) => x.id === 'sirene')?.published;
  const sireneMonth = sirene ? new Date(sirene).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '';
  const first = p.history[0]?.[0];
  const firstPop = p.history[0]?.[1];
  return `
    <figure class="pg-photo" id="${idp}photo" hidden></figure>
    <div class="pg-head" id="${idp}pg-head">
      <div class="pg-head-id">
        <h1 class="page-title">${esc(p.name)}</h1>
        <p class="pg-muted">${[postcodes(p.postcodes), esc(p.dep_name)].filter(Boolean).join(' · ')}</p>
      </div>
      <div class="pg-score">
        <span class="swatch ${cat === 'avoid' ? 'is-hatched' : ''}" style="background:${BIN_COLOURS[bin(s)]}"></span>
        <b>${s ?? '–'}</b><span>${s == null ? t['cat.unknown'] : tr('card.outOf', { cat: t[`cat.${cat}`] })}</span>
      </div>
    </div>
    <div class="pg-hero">
      <div class="pg-hero-text">
        <p class="pg-summary">${esc(summary(p))}</p>
        ${p.wiki?.article ? `<p class="pg-wiki"><a href="${esc(p.wiki.article)}">${t['page.wikipedia']}</a></p>` : ''}
        ${actions ? `<div class="pg-actions">
          <a class="pg-button" href="${depPath(p.dep_name)}?c=${p.code}#carte=11/${p.lat}/${p.lon}">${t['page.openMap']}</a>
          ${basketButton(inBasket)}
        </div>` : ''}
        <dl class="pg-tiles">
          ${tile(t['card.inhabitants'], fmtInt(p.pop), tr('card.inYear', { year: y.census }))}
          ${tile(t['card.growthYearly'], fmtSigned(p.criteria.growth.v), tr('card.fromTo', { from: y.growth_from, to: y.census }))}
          ${tile(t['card.bakeries'], p.bakeries ? fmtInt(p.bakeries) : t['card.none'], tr('card.inYear', { year: y.bpe }))}
          ${tile(t['card.perBakery'], p.bakeries ? fmtInt(p.pop / p.bakeries) : t['card.noBakery'])}
          ${tile(t['card.income'], fmtCriterion('income', p.income.median), t['card.income.sub'])}
          ${tile(t['card.crime'], p.criteria.crime.v == null ? t['card.notPublished'] : `${fmtCriterion('crime', p.criteria.crime.v)} ‰`, t['card.crime.sub'])}
        </dl>
      </div>
      <figure class="pg-locator">
        <div class="pg-locator-map" id="${idp}locator" role="img" aria-label="${esc(t['page.locator'])}"></div>
        <figcaption>
          <span><i style="background:#FF0000"></i>${t['page.locator.here']}</span>
          <span><i style="background:#DCD3C2"></i>${t['page.locator.with']}</span>
          <span><i style="background:#9BB0DA"></i>${t['page.locator.without']}</span>
        </figcaption>
      </figure>
    </div>
    <div class="pg-grid">
      ${section(`${idp}why`, whyTitle(s), 'note', why(p))}
      ${section(`${idp}demo`, t['card.demography'], 'recensement', cols(
        `<h3>${tr('page.history', { first })}</h3>${historyChart(p.history)}
         ${firstPop ? row(tr('page.change', { first }), fmtSigned((100 * (p.history.at(-1)[1] - firstPop)) / firstPop)) : ''}`,
        pyramid(p),
      ))}
      ${section(`${idp}comp`, t['page.competition'], 'boulangeries-comptees', competition(p, fonds, p.dep_name))}
      ${section(`${idp}bread`, t['page.bread'], 'points-de-vente',
        `<div class="pg-bread"><div class="pg-bread-map" id="${idp}bread-map" role="img" aria-label="${esc(t['page.bread'])}"></div>
          <div><div class="pg-legend">${Object.entries(KIND_COLOURS).map(([k, c]) => `<span><i style="background:${c}"></i>${t[`page.bread.${k}`]}</span>`).join('')}
            <span><i class="is-pin"></i>${t['page.bread.townHall']}</span></div>${breadList(p)}
          </div></div>`)}
      ${section(`${idp}water`, t['page.water'], 'eau', water(p))}
      ${section(`${idp}eco`, t['card.economy'], 'employeurs', economy(p))}
      ${section(`${idp}inc`, t['page.incomeHousing'], 'revenu', incomeHousing(p, p.dep_name))}
      ${section(`${idp}safe`, t['page.safetyServices'], 'delinquance', safetyServices(p))}
      ${section(`${idp}pol`, t['card.politics'], 'politique', politics(p.politics, y.election))}
    </div>
    <p class="pg-sources">${tr('page.built', { built: new Date(meta.built_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) })} ${tr('page.sources', { census: y.census, income: y.income, bpe: y.bpe, sirene: sireneMonth, crime: y.crime, election: y.election, water: y.water })}<a href="aide/#liste">${t['help.link']}</a></p>
`;
}

// ---------- maps frozen for printing ----------

const settle = (map, ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms); // tiles that never come must not block the export
    map.once('idle', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Replaces a live map by a picture of it, its markers laid on top in percentages, so the sheet prints
 * at any width and the WebGL context is released (browsers keep only ~16 at a time).
 */
export async function freeze(el, made, note = '') {
  if (!made) return;
  const { map, markers } = made;
  await settle(map, 10000);
  const canvas = map.getCanvas();
  const w = el.clientWidth || 1;
  const hgt = el.clientHeight || 1;
  let src = '';
  try {
    src = canvas.toDataURL('image/jpeg', 0.9); // a JPEG keeps a PDF of 10 sheets small
  } catch {
    /* tainted canvas: markers only */
  }
  const spots = markers.map((m) => [m.getElement(), map.project(m.getLngLat())]);
  map.remove();
  el.replaceChildren();
  el.classList.add('is-frozen');
  el.style.aspectRatio = `${w} / ${hgt}`;
  if (src) el.insertAdjacentHTML('afterbegin', `<img src="${src}" alt="">`);
  for (const [node, pt] of spots) {
    for (const prop of ['transform', 'translate', 'opacity', 'pointer-events']) node.style.removeProperty(prop); // MapLibre's placement
    node.classList.remove('maplibregl-marker');
    node.classList.add('frozen-marker');
    node.style.left = `${(100 * pt.x) / w}%`;
    node.style.top = `${(100 * pt.y) / hgt}%`;
    el.append(node);
  }
  if (note) el.insertAdjacentHTML('beforeend', `<small class="frozen-note">${note}</small>`);
}

const imageLoaded = (img, ms) =>
  new Promise((resolve) => {
    if (!img || img.complete) return resolve();
    const timer = setTimeout(resolve, ms);
    img.addEventListener('load', () => (clearTimeout(timer), resolve()), { once: true });
    img.addEventListener('error', () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Brings a rendered sheet to life. print: maps become pictures and the promise resolves once the sheet is
 * ready to print (maps drawn, photo loaded); otherwise maps stay interactive and charts get their tooltip.
 */
export async function wireCommune(root, p, { print = false } = {}) {
  const photoEl = root.querySelector('.pg-photo');
  const photoDone = photo(photoEl, p).catch(() => {});
  const locEl = root.querySelector('.pg-locator-map');
  const breadEl = root.querySelector('.pg-bread-map');
  if (!print) {
    locator(locEl, p).catch(() => {});
    if (breadEl) breadMap(breadEl, p);
    root.querySelectorAll('.pg-chart-wrap').forEach(wireChart);
    return;
  }
  const opts = { canvasContextAttributes: { preserveDrawingBuffer: true }, fadeDuration: 0 };
  await freeze(locEl, await locator(locEl, p, opts).catch(() => null));
  if (breadEl) await freeze(breadEl, breadMap(breadEl, p, { print: true, interactive: false, ...opts }), t['page.bread.attribution']);
  await photoDone;
  await imageLoaded(photoEl?.querySelector('img'), 8000);
}
