// Basket page (/panier/): one market study of 1 to 5 communes kept aside in this browser, compared side by side
// and exported to PDF in one go through the browser's print dialog: the comparison, then one full sheet per commune.
// One price for 1 to 5 communes (1 €, free during the launch: no payment yet).
// The list lives in localStorage only; data comes from data/communes-index.json and data/commune/<code>.json.
import t from './i18n/fr.js';
import { BIN_COLOURS, WEIGHTS, bin, category, score } from './lib/scoring.js';
import { fmtCriterion, fmtInt, fmtPostcode, fmtSigned, tr } from './lib/format.js';
import { MAX_BASKET, readBasket, toggleBasket } from './lib/basket.js';
import { communeHTML, getJSON, wireCommune } from './lib/commune-view.js';
import { compareHTML, wireCompare } from './lib/compare-view.js';
import { communePath } from './lib/slug.js';
import { addChrome } from './lib/chrome.js';

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
  return `<div class="table-wrap"><table class="sel-table stack-rows" style="--cols:${compared.length}">
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
    try {
      const [meta, fonds] = await Promise.all([getJSON('meta.json'), getJSON('fonds.json')]);
      const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      const stamp = (c) => `<p class="print-meta">${tr('basket.printMeta', { url: `fournyl.com/${communePath(c.depName, c.name, c.code)}`, date })}</p>`;
      printDoc.replaceChildren();
      const pages = [];
      for (const [i, c] of list.entries()) {
        status.textContent = tr('basket.exporting', { i: i + 1, n: list.length });
        pages.push(await getJSON(`commune/${c.code}.json`));
      }
      if (list.length > 1) {
        // 2 to 5 communes: every theme confronted side by side, in landscape.
        const doc = document.createElement('article');
        doc.className = 'print-sheet print-compare doc-main';
        doc.innerHTML = `<p class="print-meta">${tr('basket.printMeta', { url: 'fournyl.com/panier/', date })}</p>
          <h1>${t['basket.cmp.title']}</h1>
          ${compareHTML(pages, meta, fonds)}`;
        printDoc.append(doc);
        await wireCompare(doc, pages);
      } else {
        const sheet = document.createElement('article');
        sheet.className = 'print-sheet page-main';
        sheet.innerHTML = stamp(list[0]) + communeHTML(pages[0], meta, fonds, { idp: `c${list[0].code}-`, actions: false });
        printDoc.append(sheet);
        await wireCommune(sheet, pages[0], { print: true });
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

  /** "3 / 5": five squares, filled for each commune in the study, and the single price. */
  function counter(n) {
    const r = MAX_BASKET - n;
    const boxes = Array.from({ length: MAX_BASKET }, (_, i) => `<i class="${i < n ? 'is-on' : ''}"></i>`).join('');
    const left = r > 1 ? tr('basket.left', { r }) : r === 1 ? t['basket.leftOne'] : tr('basket.complete', { max: MAX_BASKET });
    return `<div class="basket-counter" role="status">
        <div class="basket-meter" aria-hidden="true">${boxes}</div>
        <p><b class="num">${tr('basket.counter', { n: Math.min(n, MAX_BASKET), max: MAX_BASKET })}</b> ${t['basket.counterLabel']}</p>
        <p class="basket-price"><b>${tr('basket.price', { max: MAX_BASKET })}</b> · ${t['basket.free']}</p>
        <p>${n > MAX_BASKET ? '' : left}</p>
      </div>`;
  }

  const contents = () => `<h2>${t['basket.contentsTitle']}</h2><ul>${t['basket.contents'].map((x) => `<li>${x}</li>`).join('')}</ul>`;

  function render() {
    const list = basket();
    if (!list.length) {
      main.innerHTML = `<h1>${t['basket.title']}</h1><p class="doc-intro">${t['basket.intro']}</p>
        ${counter(0)}<div class="callout"><p>${t['basket.empty']}</p></div><p><a class="btn" href="./">${t['basket.toMap']}</a></p>${contents()}`;
      return;
    }
    // Baskets filled before the 5-commune limit (Nov 2026) can hold more: the export waits until some are removed.
    const tooMany = list.length > MAX_BASKET;
    const swatch = (c) => `<span class="swatch ${c.cat === 'avoid' ? 'is-hatched' : ''}" style="background:${c.fill}"></span>`;
    main.innerHTML = `<h1>${t['basket.title']}</h1>
      <p class="doc-intro">${t['basket.intro']}</p>
      ${counter(list.length)}
      ${tooMany ? `<div class="callout" role="alert"><p>${tr('basket.tooMany', { n: list.length, max: MAX_BASKET, r: list.length - MAX_BASKET })}</p></div>` : ''}
      <div class="basket-export">
        <button type="button" class="btn" id="export"${tooMany ? ' disabled' : ''}>${t['basket.export']}</button>
        <p class="help-small">${t['basket.exportHelp']}</p>
        <p class="help-small" id="export-status" role="status" aria-live="polite"></p>
      </div>
      <h2>${t['basket.listTitle']}</h2>
      <ul class="sel-list">${list
        .map(
          (c) => `<li>
            ${swatch(c)}
            <a href="${communePath(c.depName, c.name, c.code)}">${esc(c.name)}</a>
            <small>${[fmtPostcode(c.cp), esc(c.depName)].filter(Boolean).join(' · ')}</small>
            <b class="num">${c.score ?? '–'}</b>
            <button type="button" class="sel-remove" data-code="${c.code}" aria-label="${tr('basket.removeOne', { name: esc(c.name) })}">×</button>
          </li>`,
        )
        .join('')}</ul>
      ${list.length > 1 ? `<h2>${t['basket.compareTitle']}</h2>${compareTable(list)}` : ''}
      ${contents()}`;

    main.querySelector('#export').addEventListener('click', (e) => exportPdf(main.querySelector('#export-status'), e.currentTarget));
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
