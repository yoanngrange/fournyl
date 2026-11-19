// The basket ("panier"): communes the user keeps aside to compare and export, in this browser only
// (localStorage). It replaced the starred shortlist in Nov 2026 and reads the same storage key.
import t from '../i18n/fr.js';
import { tr } from './format.js';

const KEY = 'fournyl.shortlist';
const OLD_KEY = 'fournil.shortlist'; // before the Fournyl rename (Nov 2026): still read so nobody loses a list

export function readBasket() {
  try {
    return [...new Set(JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY) || '[]'))];
  } catch {
    return [];
  }
}

export const inBasket = (code) => readBasket().includes(code);

/** One market study holds up to 5 communes (one price for 1 to 5). */
export const MAX_BASKET = 5;

/**
 * Adds or removes a commune (kept in the order they were added); returns whether it is now in the basket.
 * A full basket refuses a sixth commune and says so next to `btn`, if given.
 */
export function toggleBasket(code, btn = null) {
  const list = readBasket();
  const on = !list.includes(code);
  if (on && list.length >= MAX_BASKET) {
    if (btn) fullNotice(btn);
    return false;
  }
  const next = on ? [...list, code] : list.filter((x) => x !== code);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: the button still toggles for this visit */
  }
  window.dispatchEvent(new CustomEvent('basketchange', { detail: { size: next.length } }));
  return on;
}


const BASKET_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M3 9h18l-2 11H5L3 9Zm5 0 4-6 4 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 13v4M15 13v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/** "Ajouter au panier" / "Dans le panier" toggle (aria-pressed); cls: pg-basket (page) or card-basket (map card). */
export const basketButton = (inBasket, cls = 'pg-basket', withText = true) =>
  `<button type="button" class="${cls}" aria-pressed="${inBasket}"${withText ? '' : ` aria-label="${t[inBasket ? 'basket.remove' : 'basket.add']}"`}>${BASKET_ICON}${
    withText ? `<span>${t[inBasket ? 'basket.in' : 'basket.add']}</span>` : ''
  }</button>`;

/** "Panier plein" under the button for a few seconds (announced to screen readers). */
function fullNotice(btn) {
  const host = btn.parentElement;
  let note = host.nextElementSibling?.classList.contains('basket-full') ? host.nextElementSibling : null;
  if (!note) {
    note = document.createElement('p');
    note.className = 'basket-full';
    note.setAttribute('role', 'status');
    host.after(note);
  }
  note.innerHTML = tr('basket.full', { n: MAX_BASKET });
  clearTimeout(note.timer);
  note.timer = setTimeout(() => note.remove(), 6000);
}

/** Updates a basket button after a toggle. */
export function setBasketButton(btn, inBasket) {
  btn.setAttribute('aria-pressed', String(inBasket));
  const text = btn.querySelector('span');
  if (text) text.textContent = t[inBasket ? 'basket.in' : 'basket.add'];
  else btn.setAttribute('aria-label', t[inBasket ? 'basket.remove' : 'basket.add']);
}

/** Header links to the basket show how many communes it holds, kept current across tabs too. */
export function mountBasketLinks(root = document) {
  const update = () => {
    const n = readBasket().length;
    for (const a of root.querySelectorAll('[data-basket-link]')) {
      a.textContent = n ? tr('basket.linkCount', { n }) : t['basket.link'];
      a.classList.toggle('has-items', n > 0);
    }
  };
  update();
  addEventListener('basketchange', update);
  addEventListener('storage', (e) => e.key === KEY && update());
}
