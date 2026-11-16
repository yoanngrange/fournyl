// Basket page (/panier/): the communes kept aside in this browser, compared side by side (up to 5) and
// exported to PDF through the browser's print dialog: the comparison, then one full commune sheet per page.
// The list lives in localStorage only; data comes from data/communes-index.json and data/commune/<code>.json.
import t from './i18n/fr.js';
import { BIN_COLOURS, WEIGHTS, bin, category, score } from './lib/scoring.js';
import { fmtCriterion, fmtInt, fmtPostcode, fmtSigned, tr } from './lib/format.js';
import { readBasket, toggleBasket } from './lib/basket.js';
import { communeHTML, getJSON, wireCommune } from './lib/commune-view.js';
import { communePath } from './lib/slug.js';
import { addChrome } from './lib/chrome.js';

const MAX_COMPARE = 5;
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const crime = (v) => (v == null ? t['card.notPublished'] : `${fmtCriterion('crime', v)} ‰`);
const known = (key, v) => (v == null ? t['card.notPublished'] : fmtCriterion(key, v));

// Rows of the comparison: label, value, number used to find the best (null: no "best"), higher is better?
const ROWS = [
  ['basket.row.score', (c) => (c.score == null ? '–' : `${c.score} / 100`), (c) => c.score, true],
  ['basket.row.cp', (c) => fmtPostcode(c.cp) || '–', () => null, null],
  ['card.inhabitants', (c) => fmtInt(c.pop), (c) => c.pop, null],
  ['card.growthYearly', (c) => fmtSigned(c.v.growth), (c) => c.v.growth, true],
  ['card.bakeries', (c) => (c.bakeries ? fmtInt(c.bakeries) : t['card.none']), () => null, null],
  ['card.perBakery', (c) => (c.bakeries ? fmtInt(c.pop / c.bakeries) : t['card.noBakery']), (c) => (c.bakeries ? c.pop / c.bakeries : null), true],
  ['crit.bakery_age', (c) => (c.bakeries ? known('bakery_age', c.v.bakery_age) : '–'), (c) => c.v.bakery_age, true],
  ['card.income', (c) => known('income', c.v.income), (c) => c.v.income, true],
  ['card.crime', (c) => crime(c.v.crime), (c) => c.v.crime, false],
];

let chosen = null; // codes ticked for comparison

function compareTable(compared, { links = true } = {}) {
  const head = compared
    .map((c) => {
      const name = links ? `<a href="${communePath(c.depName, c.name, c.code)}">${esc(c.name)}</a>` : `<b>${esc(c.name)}</b>`;
      return `<th scope="col">${name}<br><small>${esc(c.depName)}</small></th>`;
    })
    .join('');
  const body = ROWS.map(([key, show, num, higher]) => {
    const vals = compared.map(num);
    const set = vals.filter((x) => x != null);
    const best = higher == null || set.length < 2 ? null : higher ? Math.max(...set) : Math.min(...set);
    const cells = compared
      .map((c, i) => {
        const isBest = best != null && vals[i] === best && new Set(set).size > 1;
        return `<td class="num${isBest ? ' is-best' : ''}">${show(c)}${isBest ? ` <span class="best-tag">${t['basket.best']}</span>` : ''}</td>`;
      })
      .join('');
    return `<tr><th scope="row">${t[key]}</th>${cells}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="sel-table">
    <thead><tr><th scope="col"><span class="visually-hidden">${t['basket.criterion']}</span></th>${head}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

async function start() {
  const [index, deps] = await Promise.all([getJSON('communes-index.json'), getJSON('departements.geojson')]);
  const depNames = Object.fromEntries(deps.features.map((f) => [f.properties.code, f.properties.name]));
  const pos = new Map(index.code.map((code, i) => [code, i]));
  const commune = (code) => {
    const i = pos.get(code);
    const v = {};
    const pct = {};
    for (const k of Object.keys(index.v)) {
      v[k] = index.v[k][i];
      pct[k] = index.pct[k][i];
    }
    const s = score(pct, WEIGHTS);
    return { code, cp: index.cp?.[i] ?? '', name: index.name[i], dep: index.dep[i], depName: depNames[index.dep[i]], pop: index.pop[i], bakeries: index.bakeries[i], v, score: s, cat: category(s), fill: BIN_COLOURS[bin(s)] };
  };

  const main = document.querySelector('main');
  addChrome();
  const printDoc = document.createElement('div');
  printDoc.id = 'print-doc';
  printDoc.setAttribute('aria-hidden', 'true');
  document.body.append(printDoc);
  let exporting = false;

  const basket = () => {
    const list = readBasket().filter((code) => pos.has(code)).map(commune);
    return list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  };

  /** Builds the printable document (comparison + every sheet, one per page), then opens the print dialog. */
  async function exportPdf(status, button) {
    if (exporting) return;
    exporting = true;
    button.disabled = true;
    const list = basket();
    const compared = list.filter((c) => chosen.includes(c.code));
    try {
      const [meta, fonds] = await Promise.all([getJSON('meta.json'), getJSON('fonds.json')]);
      const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      const stamp = (c) => `<p class="print-meta">${tr('basket.printMeta', { url: `fournyl.com/${communePath(c.depName, c.name, c.code)}`, date })}</p>`;
      printDoc.replaceChildren();
      if (compared.length > 1) {
        printDoc.insertAdjacentHTML(
          'beforeend',
          `<section class="print-sheet print-compare doc-main"><p class="print-meta">${tr('basket.printMeta', { url: 'fournyl.com/panier/', date })}</p>
            <h1>${t['basket.printCompare']}</h1>${compareTable(compared, { links: false })}<p class="help">${t['basket.note']}</p></section>`,
        );
      }
      for (const [i, c] of list.entries()) {
        status.textContent = tr('basket.exporting', { i: i + 1, n: list.length });
        const p = await getJSON(`commune/${c.code}.json`);
        const sheet = document.createElement('article');
        sheet.className = 'print-sheet page-main';
        sheet.innerHTML = stamp(c) + communeHTML(p, meta, fonds, { idp: `c${c.code}-`, actions: false });
        printDoc.append(sheet);
        await wireCommune(sheet, p, { print: true });
      }
      status.textContent = t['basket.exportReady'];
      const title = document.title;
      document.title = tr('basket.printTitle', { n: list.length }); // Chrome and Safari name the PDF after it
      document.body.classList.add('is-printing');
      addEventListener(
        'afterprint',
        () => {
          document.body.classList.remove('is-printing');
          document.title = title;
          printDoc.replaceChildren();
          status.textContent = '';
        },
        { once: true },
      );
      requestAnimationFrame(() => print());
    } catch (err) {
      console.error(err);
      status.textContent = t['basket.exportError'];
    } finally {
      exporting = false;
      button.disabled = false;
    }
  }

  function render() {
    const list = basket();
    chosen = (chosen ?? list.slice(0, MAX_COMPARE).map((c) => c.code)).filter((code) => list.some((c) => c.code === code));
    if (!list.length) {
      main.innerHTML = `<h1>${t['basket.title']}</h1><p class="doc-intro">${t['basket.intro']}</p>
        <div class="callout"><p>${t['basket.empty']}</p></div><p><a class="btn" href="./">${t['basket.toMap']}</a></p>`;
      return;
    }
    const compared = list.filter((c) => chosen.includes(c.code));
    const swatch = (c) => `<span class="swatch ${c.cat === 'avoid' ? 'is-hatched' : ''}" style="background:${c.fill}"></span>`;
    main.innerHTML = `<h1>${t['basket.title']}</h1>
      <p class="doc-intro">${t['basket.intro']}</p>
      <div class="basket-export">
        <button type="button" class="btn" id="export">${t['basket.export']}</button>
        <p class="help">${t['basket.exportHelp']}</p>
        <p class="help" id="export-status" role="status" aria-live="polite"></p>
      </div>
      <h2>${tr('basket.listTitle', { n: list.length })}</h2>
      <p class="help">${tr('basket.pick', { n: MAX_COMPARE })}</p>
      <ul class="sel-list">${list
        .map(
          (c) => `<li>
            <input type="checkbox" id="cmp-${c.code}" data-code="${c.code}" ${chosen.includes(c.code) ? 'checked' : ''}
              ${!chosen.includes(c.code) && chosen.length >= MAX_COMPARE ? 'disabled' : ''}>
            <label for="cmp-${c.code}" class="visually-hidden">${tr('basket.compareOne', { name: esc(c.name) })}</label>
            ${swatch(c)}
            <a href="${communePath(c.depName, c.name, c.code)}">${esc(c.name)}</a>
            <small>${[fmtPostcode(c.cp), esc(c.depName)].filter(Boolean).join(' · ')}</small>
            <b class="num">${c.score ?? '–'}</b>
            <button type="button" class="sel-remove" data-code="${c.code}" aria-label="${tr('basket.removeOne', { name: esc(c.name) })}">×</button>
          </li>`,
        )
        .join('')}</ul>
      ${compared.length ? `<h2>${t['basket.compareTitle']}</h2>${compareTable(compared)}<p class="help">${t['basket.note']}</p>` : ''}`;

    main.querySelector('#export').addEventListener('click', (e) => exportPdf(main.querySelector('#export-status'), e.currentTarget));
    for (const box of main.querySelectorAll('.sel-list input')) {
      box.addEventListener('change', () => {
        chosen = box.checked ? [...chosen, box.dataset.code] : chosen.filter((x) => x !== box.dataset.code);
        render();
        document.getElementById(`cmp-${box.dataset.code}`)?.focus();
      });
    }
    for (const btn of main.querySelectorAll('.sel-remove')) {
      btn.addEventListener('click', () => {
        toggleBasket(btn.dataset.code);
        render();
        main.querySelector('h2')?.setAttribute('tabindex', '-1');
        main.querySelector('h2')?.focus();
      });
    }
  }

  render();
}

start().catch((err) => {
  console.error(err);
  document.querySelector('main').insertAdjacentHTML('beforeend', `<p role="alert">${t['app.loadError']}</p>`);
});
