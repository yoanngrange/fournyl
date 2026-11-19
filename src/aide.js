// Help page (/aide/): method, sources and data updates, terms of use, legal notice and privacy on one page,
// with a sticky table of contents on the left (a collapsible one on phones). Every "?" in the app links here.
// Copy from fr.js (`sources.*`, `updates.*`, `doc.*`); figures and dates from data/meta.json.
import t from './i18n/fr.js';
import { addChrome, fill, longDate } from './lib/chrome.js';
import { ROAD_FACTOR, ROAD_SPEED_KMH } from './lib/delivery.js';

const pct = (x) => `${(100 * x).toFixed(1).replace('.', ',')} %`;
const int = (n) => Math.round(n).toLocaleString('fr-FR');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const STALE_DAYS = 40;

/** The deploy workflow runs on the 3rd of each month at 05:00 UTC (.github/workflows/deploy.yml). */
export function nextBuild(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 3, 5));
  if (d <= now) d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** A list of explanations; items with an id can be linked from a "?" in the app. */
const items = (list, params) =>
  `<ul>${list.map((x) => (typeof x === 'string' ? `<li>${fill(x, params)}</li>` : `<li id="${x.id}">${fill(x.html, params)}</li>`)).join('')}</ul>`;

/** A part of the page: { id, title, intro?, subs: [{ id, title, html }], outro? }. */
const part = (p) => `<section class="help-part" id="${p.id}" aria-labelledby="${p.id}-title">
    <h2 id="${p.id}-title">${p.title}</h2>${p.intro ?? ''}
    ${p.subs.map((s) => `<h3 id="${s.id}">${s.title}</h3>${s.html}`).join('')}${p.outro ?? ''}
  </section>`;

function method(params) {
  return {
    id: 'methode',
    title: t['help.method'],
    subs: [
      { id: 'note', title: t['sources.how.title'], html: items(t['sources.how'], params) },
      { id: 'criteres', title: t['sources.choices.title'], html: items(t['sources.choices'], params) },
      { id: 'limites', title: t['sources.bias.title'], html: items(t['sources.bias'], params) },
    ],
  };
}

function sources(meta, index) {
  const built = new Date(meta.built_at);
  const late = (Date.now() - built) / 86400000 > STALE_DAYS;
  const fact = (label, value) => `<div><span>${label}</span><b>${value}</b></div>`;
  const rhythm = t['updates.rhythm'];
  const rows = meta.sources
    .map(
      (s) => `<tr>
        <th scope="row"><a href="${esc(s.url)}">${esc(s.name)}</a><br><small>${esc(s.producer)} · ${esc(s.licence)}</small></th>
        <td>${esc(s.vintage)}</td>
        <td class="num">${s.published ? longDate(s.published) : t['updates.unknown']}</td>
        <td class="num">${longDate(s.fetched)}</td>
        <td>${rhythm[s.id] ?? t['updates.unknown']}</td>
      </tr>`,
    )
    .join('');
  const c = meta.checks;
  return {
    id: 'sources',
    title: t['help.sources'],
    subs: [
      {
        id: 'calendrier',
        title: t['help.calendar'],
        html: `<p>${t['updates.intro']}</p>
          ${late ? `<div class="callout" role="status"><p>${t['updates.late']}</p></div>` : ''}
          <div class="facts">
            ${fact(t['updates.built'], longDate(meta.built_at))}
            ${fact(t['updates.next'], longDate(nextBuild().toISOString()))}
            ${fact(t['updates.communes'], int(index.code.length))}
            ${fact(t['updates.oldest'], Math.min(...Object.values(meta.years)))}
          </div>`,
      },
      {
        id: 'liste',
        title: t['sources.list.title'],
        html: `<div class="table-wrap"><table class="stack-rows" style="--cols:4">
            <thead><tr>${['source', 'vintage', 'published', 'fetched', 'rhythm'].map((k) => `<th scope="col">${t[`updates.col.${k}`]}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
          <p class="help-small">${fill(t['sources.footer'], { cog: meta.cog_year, built: longDate(meta.built_at) })}</p>`,
      },
      {
        id: 'controles',
        title: t['updates.checks'],
        html: `<ul>
            <li>${fill(t['updates.check.pop'], { total: int(c.population.total), official: int(c.population.official), gap: pct(c.population.gap) })}</li>
            <li>${fill(t['updates.check.bakeries'], { bpe: int(c.bakeries.bpe), sirene: int(c.bakeries.sirene_10_71_c_d), gap: pct(c.bakeries.gap) })}</li>
            <li>${fill(t['updates.check.missing'], { income: pct(c.missing_share.income), crime: pct(c.missing_share.crime) })}</li>
          </ul>`,
      },
    ],
  };
}

/** Terms, legal notice, privacy: { id, title, intro, callout, sections: [{ title, paras }], updated }. */
function legal(doc, params) {
  const para = (p) => (p.startsWith('<ul') ? fill(p, params) : `<p>${fill(p, params)}</p>`);
  return {
    id: doc.id,
    title: doc.title,
    intro: `${doc.intro ? `<p>${fill(doc.intro, params)}</p>` : ''}${doc.callout ? `<div class="callout">${doc.callout.map(para).join('')}</div>` : ''}`,
    subs: doc.sections.map((s) => ({ id: `${doc.id}-${slug(s.title)}`, title: s.title, html: s.paras.map(para).join('') })),
    outro: `<p class="help-small">${fill(t['doc.updated'], { updated: longDate(doc.updated) })}</p>`,
  };
}

function toc(parts) {
  const link = (id, title) => `<a href="aide/#${id}" data-target="${id}">${title}</a>`;
  return `<nav class="help-toc" aria-label="${t['help.nav']}">
    <details open><summary>${t['help.nav']}</summary><ol>
      ${parts.map((p) => `<li>${link(p.id, p.title)}<ol>${p.subs.map((s) => `<li>${link(s.id, s.title)}</li>`).join('')}</ol></li>`).join('')}
    </ol></details>
  </nav>`;
}

/** Highlight the table-of-contents entry of the heading at the top of the screen. */
function followScroll(nav) {
  const links = new Map([...nav.querySelectorAll('a')].map((a) => [a.dataset.target, a]));
  const heads = [...document.querySelectorAll('.help-part h2, .help-part h3')];
  const update = () => {
    let current = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top < 120) current = h;
    const id = current.tagName === 'H2' ? current.parentElement.id : current.id;
    for (const [target, a] of links) a.toggleAttribute('aria-current', target === id);
  };
  let queued = false;
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; update(); }); } }, { passive: true });
  update();
}

async function start() {
  const [meta, index] = await Promise.all([
    fetch('data/meta.json').then((r) => r.json()),
    fetch('data/communes-index.json').then((r) => r.json()),
  ]);
  const params = {
    census: meta.years.census,
    growthFrom: meta.years.growth_from,
    crime: meta.years.crime,
    water: meta.years.water,
    bakeryGap: pct(meta.checks.bakeries.gap),
    crimeMissing: pct(meta.checks.missing_share.crime),
    roadFactor: String(ROAD_FACTOR).replace('.', ','),
    roadSpeed: ROAD_SPEED_KMH,
    contact: t['contact.email'],
  };
  const docs = [t['doc.terms'], t['doc.legal'], t['doc.privacy']].map((d) => legal(d, params));
  const parts = [method(params), sources(meta, index), ...docs];
  const main = document.querySelector('main');
  main.innerHTML = `<div class="help-layout">
      ${toc(parts)}
      <div class="help-body">
        <h1>${t['help.title']}</h1>
        <p class="doc-intro">${t['help.intro']}</p>
        ${parts.map(part).join('')}
      </div>
    </div>`;
  // Former addresses (/infos-legales/#donnees) keep working.
  document.getElementById('sources').insertAdjacentHTML('afterbegin', '<span id="donnees"></span>');
  const nav = main.querySelector('.help-toc');
  // Phones: the table of contents starts closed, and closes again after a jump.
  const phone = matchMedia('(max-width: 900px)');
  const details = nav.querySelector('details');
  if (phone.matches) details.open = false;
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a') && phone.matches) details.open = false;
  });
  addChrome();
  followScroll(nav);
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}

start().catch((err) => {
  console.error(err);
  document.querySelector('main').insertAdjacentHTML('beforeend', `<p role="alert">${t['app.loadError']}</p>`);
});
