// Bakery page: one bakery or pastry shop (data/bakery/<commune>.json), with the context of its commune
// (data/commune/<commune>.json). Same building blocks as the commune page (src/lib/commune-view.js).
import * as maplibregl from '../../vendor/maplibre-gl-6.11.2/maplibre-gl.mjs';
import t from '../i18n/fr.js';
import { BIN_COLOURS, WEIGHTS, bin, category, score } from './scoring.js';
import { fmtEuro, fmtInt, fmtSigned, helpLink, tr } from './format.js';
import { communePath } from './slug.js';
import { IGN_PLAN, KIND_COLOURS, cols, esc, hygiene, hygieneText, monthYear, row, section, tile, water } from './commune-view.js';

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
  if (!b.accounts) return `<p class="pg-muted">${t[b.sole_trader ? 'bakery.accounts.soleTrader' : 'bakery.accounts.none']}</p>`;
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

function commune(p, fonds) {
  const pct = Object.fromEntries(Object.entries(p.criteria).map(([k, v]) => [k, v.pct]));
  const s = score(pct, WEIGHTS);
  const prices = fonds.departements[p.dep] || fonds.france;
  return `${cols(
    `<dl class="pg-tiles is-2">
      ${tile(t['basket.row.score'], s == null ? t['cat.unknown'] : `${s} / 100`, s == null ? '' : t[`cat.${category(s)}`])}
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
  const pct = Object.fromEntries(Object.entries(p.criteria).map(([k, v]) => [k, v.pct]));
  const s = score(pct, WEIGHTS);
  return `
    <div class="pg-head bk-head">
      <div class="pg-head-id">
        <h1 class="page-title">${esc(bakeryName(b))}</h1>
        <p class="pg-muted">${kindLabel(b)} · ${esc(b.address)}, ${esc(b.cp || '')} ${esc(p.name)}</p>
      </div>
      <div class="pg-score" title="${esc(t['basket.row.score'])} ${esc(p.name)}">
        <span class="swatch ${category(s) === 'avoid' ? 'is-hatched' : ''}" style="background:${BIN_COLOURS[bin(s)]}"></span>
        <b>${s ?? '–'}</b><span>${s == null ? t['cat.unknown'] : tr('card.outOf', { cat: t[`cat.${category(s)}`] })} · ${esc(p.name)}</span>
      </div>
    </div>
    <div class="pg-grid">
      ${section('bk-shop', t['bakery.facts'], 'boutique', `<div class="bk-shop">
        <div>${facts(b)}<h3>${t['bakery.hygiene']}${helpLink('hygiene', t['bakery.hygiene'])}</h3>${hygieneBlock(b)}</div>
        <figure class="bk-map-wrap"><div class="bk-map" role="img" aria-label="${esc(t['bakery.mapLabel'])}"></div>
          <figcaption class="pg-legend"><span><i class="is-here"></i>${t['bakery.here']}</span>${Object.entries(KIND_COLOURS).map(([k, c]) => `<span><i style="background:${c}"></i>${t[`page.bread.${k}`]}</span>`).join('')}</figcaption>
        </figure></div>`)}
      ${section('bk-acc', t['bakery.accounts'], 'comptes', accounts(b))}
      ${section('bk-near', t['bakery.near'], 'concurrence-proche', near(b, p))}
      ${section('bk-commune', `${t['bakery.commune']} : ${esc(p.name)}`, 'note', commune(p, fonds))}
      ${section('bk-water', t['page.water'], 'eau', water(p))}
    </div>
    <p class="pg-sources">${tr('page.built', { built: new Date(meta.built_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) })} ${tr('bakery.sources', { sirene: sireneMonth, water: y.water })}<a href="aide/#boutique">${t['help.link']}</a></p>`;
}

/** Map of the shop (large ink-ringed marker) and its competitors within 2 km; list rows and markers linked. */
export function wireBakery(root, b, p) {
  const el = root.querySelector('.bk-map');
  if (!el) return;
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
