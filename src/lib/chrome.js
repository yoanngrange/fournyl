// Header and footer shared by the text pages (help, basket). Commune pages get the same footer from
// pipeline/pages.py, as static HTML.
import t from '../i18n/fr.js';
import { mountBasketLinks } from './basket.js';
import { helpLink } from './format.js';

export const LINKS = [
  ['panier/', 'basket.link'],
  ['aide/', 'help.link'],
];

export function footerHTML() {
  const items = LINKS.map(([href, key]) => `<li><a href="${href}">${t[key]}</a></li>`).join('');
  return `<footer class="site-footer"><div class="site-footer-inner"><ul>${items}</ul><p>${t['footer.text']}</p></div></footer>`;
}

/** Adds the brand bar above <main> and the footer below it. Pages set <base href> to the site root. */
export function addChrome() {
  const main = document.querySelector('main');
  main.insertAdjacentHTML(
    'beforebegin',
    `<header class="doc-top"><div class="doc-top-inner">
      <a class="brand-link" href="./"><img class="brand-mark" src="img/mark.svg" alt="" width="32" height="32"><span class="brand-name">${t['app.name']}</span></a>
      <span class="doc-top-links"><a class="doc-top-back" href="./">${t['sources.back']}</a><a class="basket-link" href="panier/" data-basket-link>${t['basket.link']}</a>${helpLink('', t['help.link'])}</span>
    </div></header>`,
  );
  main.insertAdjacentHTML('afterend', footerHTML());
  mountBasketLinks();
}

export const fill = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => p[k] ?? `{${k}}`);
export const longDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
