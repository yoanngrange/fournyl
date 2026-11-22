// Bakery page: one bakery or pastry shop (data/bakery/<commune>.json), with the context of its commune
// (data/commune/<commune>.json). Same building blocks as the commune page (src/lib/commune-view.js).
import t from '../i18n/fr.js';
import { WEIGHTS, category, score } from './scoring.js';
import { fmtEuro, fmtInt, fmtSigned, helpLink, tr } from './format.js';
import { communePath } from './slug.js';
import { IGN_PLAN, KIND_COLOURS, cols, esc, hygiene, hygieneText, loadMaplibre, monthYear, row, section, tile } from './commune-view.js';

const kindLabel = (b) => t[`page.bread.${b.kind}`];
export const bakeryName = (b) => b.name || `${kindLabel(b)} · ${b.address}`;
const metres = (m) => (m < 1000 ? `${fmtInt(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

function facts(b) {
  const network = b.network == null ? null : b.network > 1 ? tr('bakery.network.many', { n: fmtInt(b.network) }) : t['bakery.network.one'];
  return `<dl class="pg-tiles">
    ${tile(t['bakery.since'], b.created ? monthYear(b.created) : t['card.notPublished'])}
    ${tile(t['bakery.legal'], b.legal || t['card.notPublished'])}
    ${tile(t['bakery.staff'], b.staff || t['card.notPublished'], b.staff && b.staff_year ? tr('bakery.staff.sub', { year: b.staff_year }) : '')}
    ${b.company_created ? tile(t['bakery.companySince'], String(b.company_created)) : ''}
    ${network ? tile(t['bakery.network'], network) : ''}
    ${tile(t['bakery.seat'], t[b.seat ? 'bakery.seat.yes' : 'bakery.seat.no'])}
  </dl>`;
}

function accounts(b) {
  if (!b.accounts) return '';
  const closed = tr('bakery.closed', { date: monthYear(b.accounts.closed) });
  return `<dl class="pg-tiles is-2">
    ${tile(t['bakery.revenue'], fmtEuro(b.accounts.revenue), closed)}
    ${b.accounts.net_income == null ? '' : tile(t['bakery.netIncome'], fmtEuro(b.accounts.net_income), closed)}
  </dl>`;
}

function hygieneBlock(b) {
  const h = hygiene(b);
  if (!h) return `<p class="pg-muted">${t['bakery.hygiene.none']}</p>`;
  return `<p class="pg-hyg-big is-${h.level}"><i aria-hidden="true">${'●'.repeat(5 - h.level)}${'○'.repeat(h.level - 1)}</i> ${hygieneText(h)}</p>`;
}

function near(b, p) {
  if (!b.near.length) return `<p class="pg-muted">${t['bakery.near.none']}</p>`;
  const rows = b.near
    .map((n, i) => {
      const page = n.path; // its own page (bakeries and pastry shops only), possibly in a neighbouring commune
      return `<li><button type="button" class="pg-point" data-i="${i}" aria-pressed="false">
          <span class="pg-dot" style="background:${KIND_COLOURS[n.kind]}"></span>
          <span>${n.name ? esc(n.name) : `<i>${t['page.bread.noName']}</i>`} <small>${t[`page.bread.${n.kind}`]}</small></span>
          <b>${metres(n.m)}</b></button>${
        page ? `<a class="pg-point-page" href="${page}" aria-label="${esc(tr('bakery.open', { name: n.name || t[`page.bread.${n.kind}`] }))}">→</a>` : ''}</li>`;
    })
    .join('');
  return `<ul class="pg-points">${rows}</ul>`;
}

/** OpenStreetMap opening hours ("Mo-Sa 07:00-19:30; Su 07:00-12:30") as French lines; anything unusual stays as written. */
const DAYS = { Mo: 'lun.', Tu: 'mar.', We: 'mer.', Th: 'jeu.', Fr: 'ven.', Sa: 'sam.', Su: 'dim.', PH: 'jours fériés' };
export function frenchHours(text) {
  return text
    .split(';')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) =>
      rule
        .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAYS[d])
        .replace(/(\.|s)-(\w)/g, '$1 – $2')
        .replace(/\boff\b|\bclosed\b/g, 'fermé')
        .replace(/(\d\d:\d\d)-(\d\d:\d\d)/g, '$1 – $2')
        .replace(/,(?=\d)/g, ', '),
    );
}

function contact(b) {
  const o = b.osm;
  if (!o || !(o.hours || o.website || o.phone)) return '';
  const web = o.website ? `<a href="${esc(o.website)}" rel="nofollow noopener">${esc(o.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : '';
  const tel = o.phone ? `<a href="tel:${esc(o.phone.replace(/\s+/g, ''))}">${esc(o.phone)}</a>` : '';
  const hours = o.hours ? `<ul class="bk-hours">${frenchHours(o.hours).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
  return `${cols(
    hours ? `<h3>${t['bakery.hours']}</h3>${hours}` : '',
    `${web ? row(t['bakery.website'], web) : ''}${tel ? row(t['bakery.phone'], tel) : ''}`,
  )}<p class="pg-muted small">${tr('bakery.osm.source', { date: o.updated ? new Date(o.updated).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '?' })}
    ${o.osm ? ` <a href="https://www.openstreetmap.org/${esc(o.osm)}">${t['bakery.osm.edit']}</a>` : ''}</p>`;
}

/**
 * Who ran a point of sale here. A closed one that ended before the current operator's start (one year of margin:
 * closures are registered late) is a predecessor; one that ran at the same time stood beside it (a neighbouring shop at the same address, or a
 * corner inside it) and is listed apart.
 */
function history(b) {
  const years = (from, to) => (from == null ? '' : to - from < 1 ? t['bakery.history.year'] : tr('bakery.history.years', { n: to - from }));
  const now = new Date().getFullYear();
  const since = b.created ? +b.created.slice(0, 4) : null;
  // A closure is often registered months after the takeover: one year of overlap still makes a predecessor.
  const before = b.history.filter((h) => since == null || h.to <= since + 1);
  const beside = b.history.filter((h) => since != null && h.to > since + 1);
  const line = (h) => `<li><span class="bk-hist-when">${tr('bakery.history.period', { from: h.from ?? '?', to: h.to })}</span>
      <span>${h.name ? esc(h.name) : `<i>${t['page.bread.noName']}</i>`} <small>${t[`page.bread.${h.kind}`]}${h.from ? ` · ${years(h.from, h.to)}` : ''}</small></span></li>`;
  const current = `<li class="is-current"><span class="bk-hist-when">${tr('bakery.history.since', { date: b.created ? monthYear(b.created) : '?' })}</span>
      <span>${esc(bakeryName(b))} <small>${t['bakery.history.current']} · ${years(since, now)}</small></span></li>`;
  const summary = !before.length ? t['bakery.history.none'] : before.length === 1 ? t['bakery.history.countOne'] : tr('bakery.history.count', { n: before.length });
  return `<p>${summary}</p><ol class="bk-history">${current}${before.map(line).join('')}</ol>${
    beside.length ? `<h3>${t['bakery.history.beside']}</h3><p class="pg-muted small">${t['bakery.history.besideHint']}</p><ol class="bk-history">${beside.map(line).join('')}</ol>` : ''}`;
}

function footfall(b) {
  const f = b.footfall || {};
  return `<div class="pg-cols">${['schools', 'colleges', 'lycees', 'stations', 'supermarkets', 'pharmacies', 'doctors', 'post']
    .reduce((acc, k, i) => {
      acc[i % 2].push(row(t[`bakery.footfall.${k}`], f[k] ? fmtInt(f[k]) : t['card.none']));
      return acc;
    }, [[], []])
    .map((c) => `<div>${c.join('')}</div>`)
    .join('')}</div>`;
}

/** Lines with a stop within 500 m: train stations by name, then metro, tram and bus lines grouped by network. */
function transit(b) {
  const tr_ = b.transit;
  if (!tr_.stations.length && !tr_.lines.length) return `<p class="pg-muted">${t['bakery.transit.none']}</p>`;
  const chips = (lines) => `<span class="bk-lines">${lines.map((l) => `<span class="bk-line">${esc(l)}</span>`).join('')}</span>`;
  const rows = [
    tr_.stations.length && row(t['bakery.transit.train'], esc(tr_.stations.join(' · '))),
    ...tr_.lines.map((g) => row(`${t[`bakery.transit.${g.mode}`]} <small>${esc(g.network)}</small>`, chips(g.lines))),
  ].filter(Boolean);
  return `<div class="bk-transit">${rows.join('')}</div>`;
}

function access(b) {
  const a = b.access;
  const w = b.osm?.wheelchair;
  if (!a && !w) return `<p class="pg-muted">${t['bakery.access.none']}</p>`;
  const yn = (v) => (v == null ? null : t[v ? 'bakery.yes' : 'bakery.no']);
  const rows = [
    a && yn(a.step_free) && row(t['bakery.access.stepFree'], yn(a.step_free)),
    a && a.steps != null && row(t['bakery.access.steps'], fmtInt(a.steps)),
    a && a.ramp != null && row(t['bakery.access.ramp'], yn(a.ramp)),
    a && a.width && row(t['bakery.access.width'], `${fmtInt(a.width)} cm`),
    a && a.door && row(t['bakery.access.door'], esc(a.door)),
    a && a.parking != null && row(t['bakery.access.parking'], yn(a.parking)),
    a && a.staff && row(t['bakery.access.staff'], esc(a.staff)),
    w && row(t['bakery.access.wheelchair'], t[`bakery.wheelchair.${w}`] || esc(w)),
  ].filter(Boolean);
  return rows.join('');
}

function commune(p, fonds) {
  const pct = Object.fromEntries(Object.entries(p.criteria).map(([k, v]) => [k, v.pct]));
  const s = score(pct, WEIGHTS);
  const prices = fonds.departements[p.dep] || fonds.france;
  return `${cols(
    `<dl class="pg-tiles is-2">
      ${tile(tr('bakery.communeScore', { name: esc(p.name) }), s == null ? t['cat.unknown'] : `${s} / 100`, s == null ? '' : t[`cat.${category(s)}`])}
      ${tile(t['card.inhabitants'], fmtInt(p.pop))}
      ${tile(t['card.perBakery'], p.bakeries ? fmtInt(p.pop / p.bakeries) : t['card.noBakery'])}
      ${tile(t['card.growthYearly'], fmtSigned(p.criteria.growth.v))}
    </dl>`,
    `${row(t['card.income'], fmtEuro(p.income.median))}
     ${row(t['card.bakeries'], p.bakeries ? fmtInt(p.bakeries) : t['card.none'])}
     ${row(t['card.fonds'], fmtEuro(prices.median))}
     <p><a class="pg-button" href="${communePath(p.dep_name, p.name, p.code)}">${tr('bakery.commune.link', { name: esc(p.name) })} →</a></p>`,
  )}`;
}

/** The whole page. */
export function bakeryHTML(b, p, meta, fonds) {
  const y = meta.years;
  const sirene = meta.sources.find((x) => x.id === 'sirene')?.published;
  const sireneMonth = sirene ? new Date(sirene).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '';
  const transitYear = meta.sources.find((x) => x.id === 'transit')?.fetched?.slice(0, 4) ?? '';
  return `
    <div class="pg-head bk-head">
      <div class="pg-head-id">
        <h1 class="page-title">${esc(bakeryName(b))}</h1>
        <p class="pg-muted">${kindLabel(b)} · ${esc(b.address)}, ${esc(b.cp || '')} ${esc(p.name)}</p>
      </div>
    </div>
    <div class="pg-grid">
      ${section('bk-shop', t['bakery.facts'], 'boutique', `<div class="bk-shop">
        <div>${facts(b)}<h3>${t['bakery.hygiene']}${helpLink('hygiene', t['bakery.hygiene'])}</h3>${hygieneBlock(b)}</div>
        <figure class="bk-map-wrap"><div class="bk-map" role="img" aria-label="${esc(t['bakery.mapLabel'])}"></div>
          <figcaption class="pg-legend"><span><i class="is-here"></i>${t['bakery.here']}</span>${Object.entries(KIND_COLOURS).map(([k, c]) => `<span><i style="background:${c}"></i>${t[`page.bread.${k}`]}</span>`).join('')}</figcaption>
        </figure></div>`)}
      ${contact(b) ? section('bk-contact', t['bakery.contact'], 'horaires', contact(b)) : ''}
      ${section('bk-history', t['bakery.history'], 'historique', history(b))}
      ${b.accounts ? section('bk-acc', t['bakery.accounts'], 'comptes', accounts(b)) : ''}
      ${section('bk-near', t['bakery.near'], 'concurrence-proche', near(b, p))}
      ${section('bk-footfall', t['bakery.footfall'], 'passage', footfall(b))}
      ${b.transit ? section('bk-transit', t['bakery.transit'], 'transports', transit(b)) : ''}
      ${section('bk-access', t['bakery.access'], 'accessibilite', access(b))}
      ${section('bk-commune', `${t['bakery.commune']} : ${esc(p.name)}`, 'note', commune(p, fonds))}
    </div>
    <p class="pg-sources">${tr('page.built', { built: new Date(meta.built_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) })} ${tr('bakery.sources', { sirene: sireneMonth, water: y.water, transit: transitYear })}<a href="aide/#boutique">${t['help.link']}</a></p>`;
}

/** Map of the shop (large ink-ringed marker) and its competitors within 2 km; list rows and markers linked. */
export async function wireBakery(root, b, p) {
  const el = root.querySelector('.bk-map');
  if (!el) return;
  const maplibregl = await loadMaplibre();
  const map = new maplibregl.Map({
    container: el,
    center: [b.lon, b.lat],
    zoom: 14.5,
    cooperativeGestures: true,
    attributionControl: { compact: true, customAttribution: t['page.bread.attribution'] },
    style: { version: 8, sources: { plan: { type: 'raster', tiles: [IGN_PLAN], tileSize: 256, maxzoom: 18 } }, layers: [{ id: 'plan', type: 'raster', source: 'plan' }] },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const pin = (kind, label) => {
    const e = document.createElement('button');
    e.type = 'button';
    e.className = 'bread-pin';
    e.style.background = KIND_COLOURS[kind];
    e.setAttribute('aria-label', label);
    return e;
  };
  const markers = b.near.map((n, i) => {
    const e = pin(n.kind, `${n.name || t['page.bread.noName']}, ${t[`page.bread.${n.kind}`]}, ${metres(n.m)}`);
    e.dataset.i = i;
    const link = n.path ? `<br><a href="${n.path}">${t['bakery.see']} →</a>` : '';
    const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(`<b>${n.name ? esc(n.name) : t['page.bread.noName']}</b><br>${t[`page.bread.${n.kind}`]} · ${metres(n.m)}${link}`);
    return new maplibregl.Marker({ element: e }).setLngLat([n.lon, n.lat]).setPopup(popup).addTo(map);
  });
  const here = pin(b.kind, bakeryName(b));
  here.classList.add('is-active', 'is-here');
  new maplibregl.Marker({ element: here }).setLngLat([b.lon, b.lat]).addTo(map);
  // Frame the shop and its competitors once the map has its final size (the page lays out after it is created).
  const frame = () => {
    map.resize();
    if (!b.near.length) return map.jumpTo({ center: [b.lon, b.lat], zoom: 15 });
    const lons = [b.lon, ...b.near.map((n) => n.lon)];
    const lats = [b.lat, ...b.near.map((n) => n.lat)];
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40, maxZoom: 16, duration: 0 });
  };
  map.once('load', frame);
  if ('ResizeObserver' in window) new ResizeObserver(() => map.resize()).observe(el);
  // The competitors list and their markers point at each other (same behaviour as the commune page).
  let current = null;
  const select = (i, fromList) => {
    if (current != null && current !== i) {
      markers[current].getElement().classList.remove('is-active');
      if (markers[current].getPopup().isOpen()) markers[current].togglePopup();
      root.querySelector(`#bk-near-sec .pg-point[data-i="${current}"]`)?.setAttribute('aria-pressed', 'false');
    }
    current = i;
    markers[i].getElement().classList.add('is-active');
    root.querySelector(`#bk-near-sec .pg-point[data-i="${i}"]`)?.setAttribute('aria-pressed', 'true');
    if (fromList && !markers[i].getPopup().isOpen()) markers[i].togglePopup();
  };
  root.querySelector('section[aria-labelledby="bk-near"]')?.setAttribute('id', 'bk-near-sec');
  root.addEventListener('click', (e) => {
    const row = e.target.closest('#bk-near-sec .pg-point');
    if (row) select(+row.dataset.i, true);
  });
  markers.forEach((m, i) => m.getElement().addEventListener('click', () => select(i, false)));
}
