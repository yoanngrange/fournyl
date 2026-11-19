// Bakery page: one bakery or pastry shop (src/lib/bakery-view.js), found by its id in its commune's file.
import t from './i18n/fr.js';
import { getJSON, stickyHead } from './lib/commune-view.js';
import { bakeryHTML, wireBakery } from './lib/bakery-view.js';
import { mountBasketLinks } from './lib/basket.js';

const code = document.querySelector('meta[name="fournyl-commune"]').content;
const id = document.querySelector('meta[name="fournyl-bakery"]').content;
const main = document.getElementById('page');

async function start() {
  mountBasketLinks();
  const [shops, p, meta, fonds] = await Promise.all([
    getJSON(`bakery/${code}.json`).catch(() => []),
    getJSON(`commune/${code}.json`),
    getJSON('meta.json'),
    getJSON('fonds.json'),
  ]);
  const b = shops.find((x) => x.id === id);
  if (!b) {
    main.insertAdjacentHTML('beforeend', `<p class="callout" role="alert">${t['bakery.notFound']}</p>`);
    return;
  }
  main.innerHTML = bakeryHTML(b, p, meta, fonds);
  stickyHead(main);
  wireBakery(main, b, p);
}

start().catch((err) => {
  console.error(err);
  main.insertAdjacentHTML('beforeend', `<p class="pg-muted" role="alert">${t['page.error']}</p>`);
});
