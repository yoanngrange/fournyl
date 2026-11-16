// Pinned commune card on the map: score and the four key figures, then a link to the full commune page.
import t from './i18n/fr.js';
import { fmtCriterion, fmtInt, fmtPostcode, tr } from './lib/format.js';
import { ROAD_FACTOR, ROAD_SPEED_KMH, roadTrip } from './lib/delivery.js';
import { readShortlist, toggleShortlist } from './lib/shortlist.js';
import { communePath } from './lib/slug.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export function createCard(root, { onClose, meta }) {
  let current = null;

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onClose();
  });

  const kpi = (label, value, sub = '') =>
    `<div class="kpi"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

  /** Estimated road trip across the area: "≈ 39 km", sub "≈ 47 min de route". */
  function trip(label, straightKm) {
    const { km, minutes } = roadTrip(straightKm);
    const m = Math.round(minutes);
    const time = m < 60 ? tr('card.zone.min', { m }) : tr('card.zone.hmin', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
    return kpi(label, tr('card.zone.km', { km: fmtInt(km) }), tr('card.zone.time', { time }));
  }

  /** Delivery mode: totals of the whole delivery area, under the bakehouse's own figures. */
  function zoneBlock(z, y) {
    if (!z) return '';
    return `<section class="card-zone" aria-labelledby="card-zone-title">
        <h3 id="card-zone-title">${z.radius ? tr('card.zone.titleKm', { km: z.radius }) : tr('card.zone.titleN', { n: z.n })}</h3>
        <div class="kpis">
          ${kpi(t['card.zone.communes'], fmtInt(z.n), tr('card.zone.noBakery', { n: fmtInt(z.noBakery) }))}
          ${kpi(t['card.inhabitants'], fmtInt(z.pop), tr('card.inYear', { year: y.census }))}
          ${kpi(t['card.bakeries'], z.bakeries ? fmtInt(z.bakeries) : t['card.none'], tr('card.inYear', { year: y.bpe }))}
          ${kpi(t['card.perBakery'], z.bakeries ? fmtInt(z.pop / z.bakeries) : '—', t['card.zone.average'])}
          ${trip(t['card.zone.northSouth'], z.northSouthKm)}
          ${trip(t['card.zone.eastWest'], z.eastWestKm)}
        </div>
        <p class="card-source">${tr('card.zone.estimate', { factor: String(ROAD_FACTOR).replace('.', ','), speed: ROAD_SPEED_KMH })}</p>
      </section>`;
  }

  function render(c, view) {
    const scoreText =
      view.score == null
        ? t['cat.unknown']
        : tr(view.filteredOut ? 'card.outOfFiltered' : 'card.outOf', { cat: t[`cat.${view.cat}`] });
    const starred = readShortlist().has(c.code);
    const y = meta.years;

    root.innerHTML = `
      <div class="card-head">
        <div>
          <h2 class="card-name" id="card-title" tabindex="-1">${esc(c.name)}</h2>
          <div class="card-muted">${[fmtPostcode(c.cp), esc(view.depName)].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" class="card-close" aria-label="${t['card.close']}">×</button>
      </div>
      <div class="card-score">
        <span class="swatch ${view.cat === 'avoid' && !view.filteredOut ? 'is-hatched' : ''}" style="background:${view.fill}"></span>
        <b>${view.score == null ? '–' : view.score}</b>
        <span class="card-muted">${scoreText}</span>
      </div>
      <div class="kpis">
        ${kpi(t['card.inhabitants'], fmtInt(c.pop), tr('card.inYear', { year: y.census }))}
        ${kpi(t['card.bakeries'], c.bakeries ? fmtInt(c.bakeries) : t['card.none'], tr('card.inYear', { year: y.bpe }))}
        ${kpi(t['card.perBakery'], c.bakeries ? fmtInt(c.pop / c.bakeries) : '—')}
        ${kpi(t['card.income'], fmtCriterion('income', c.v.income), tr('card.inYear', { year: y.income }))}
      </div>
      <p class="card-source">${tr('card.src.short', { census: y.census, bpe: y.bpe, income: y.income })}</p>
      ${zoneBlock(view.zone, y)}
      <div class="card-actions">
        <a class="card-page" href="${communePath(view.depName, c.name, c.code)}">${t['card.page']}</a>
        <button type="button" class="card-star" aria-pressed="${starred}" aria-label="${starred ? t['card.shortlistRemove'] : t['card.shortlistAdd']}">${starred ? '★' : '☆'}</button>
      </div>`;

    root.querySelector('.card-close').addEventListener('click', onClose);
    root.querySelector('.card-star').addEventListener('click', () => {
      toggleShortlist(c.code);
      render(c, view);
      root.querySelector('.card-star').focus();
    });
  }

  return {
    show(c, view, { focus = false } = {}) {
      current = c.code;
      root.hidden = false;
      root.setAttribute('aria-label', tr('card.label', { name: c.name }));
      render(c, view);
      if (focus) root.querySelector('#card-title').focus();
    },
    hide() {
      current = null;
      root.hidden = true;
      root.replaceChildren();
    },
    get code() {
      return current;
    },
  };
}
