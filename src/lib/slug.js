// Human-readable URLs (docs/SPEC.md §3.6). Mirror of slugify/dep_path/commune_path in pipeline/pages.py.

/** "L'Abergement-Clémenciat" -> "l-abergement-clemenciat" */
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const depPath = (depName) => `${slugify(depName)}/`;

export const communePath = (depName, name, code) => `${slugify(depName)}/${slugify(name)}-${code.toLowerCase()}/`;

/** Last part of a bakery page URL: "boulangerie-du-port-8cc71a418c/" (a shop without a known name: its kind). */
export const bakerySlug = (b) => `${slugify(b.name || (b.kind === 'pastry' ? 'patisserie' : 'boulangerie'))}-${b.id}/`;

/** "loire-atlantique/clisson-44043/frangins-a15fb72f9c/" */
export const bakeryPath = (depName, communeName, code, b) => communePath(depName, communeName, code) + bakerySlug(b);

/** Site root ("/" on fournyl.com, "/fournyl/" on github.io), whatever page we are on: every page sets <base href> to it. */
export const siteRoot = () => new URL('./', document.baseURI).pathname;
