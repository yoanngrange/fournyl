// Commune page: the sheet of one commune (src/lib/commune-view.js), with its map link and basket button.
import t from './i18n/fr.js';
import { communeHTML, getJSON, stickyHead, wireCommune } from './lib/commune-view.js';
import { inBasket, mountBasketLinks, setBasketButton, toggleBasket } from './lib/basket.js';

const code = document.querySelector('meta[name="fournyl-commune"]').content;
const main = document.getElementById('page');

async function start() {
  const [p, meta, fonds] = await Promise.all([getJSON(`commune/${code}.json`), getJSON('meta.json'), getJSON('fonds.json')]);
  main.innerHTML = communeHTML(p, meta, fonds, { inBasket: inBasket(code) });
  main.querySelector('.pg-basket').addEventListener('click', (e) => setBasketButton(e.currentTarget, toggleBasket(code, e.currentTarget)));
  mountBasketLinks();
  stickyHead(main);
  wireCommune(main, p);
}

start().catch((err) => {
  console.error(err);
  main.insertAdjacentHTML('beforeend', `<p class="pg-muted" role="alert">${t['page.error']}</p>`);
});
