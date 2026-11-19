"""Generated pages and human-readable URLs (pipeline/pages.py, src/lib/slug.js)."""

import json
import re
import shutil
import subprocess

import pytest

from pipeline.config import OUT, ROOT, SITE_URL
from pipeline.pages import Site, analytics_tag, at_place, commune_path, slugify

CASES = {
    "L'Abergement-Clémenciat": "l-abergement-clemenciat",
    "Saint-Étienne-de-Montluc": "saint-etienne-de-montluc",
    "Œuilly": "oeuilly",
    "Côtes-d'Armor": "cotes-d-armor",
    "Bourg-Saint-Andéol": "bourg-saint-andeol",
}


def test_slugify():
    for name, slug in CASES.items():
        assert slugify(name) == slug


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_slug_js_matches_python():
    script = (
        f"import('{(ROOT / 'src/lib/slug.js').as_uri()}').then(m => "
        f"console.log(JSON.stringify({json.dumps(list(CASES))}.map(m.slugify))))"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True)
    assert json.loads(out.stdout) == list(CASES.values())


@pytest.fixture(scope="module")
def site():
    if not (OUT / "communes-index.json").exists():
        pytest.skip("public/data not built")
    return Site()


def test_every_commune_has_a_unique_path(site):
    paths = {commune_path(site.dep_names[c["dep"]], c["name"], code) for code, c in site.communes.items()}
    assert len(paths) == len(site.communes)


def test_routes(site):
    clisson = site.route("loire-atlantique/clisson-44043/")
    assert clisson and "<title>Créer une boulangerie à Clisson (44190)" in clisson and 'content="44043"' in clisson
    assert f'rel="canonical" href="{SITE_URL}loire-atlantique/clisson-44043/"' in clisson
    assert site.route("loire-atlantique/") is not None
    assert site.route("loire-atlantique/clison-44043/") is None  # misspelt: 404 page redirects
    assert site.route("nowhere/") is None


def test_commune_page_has_footer_and_no_unfilled_placeholders(site):
    page = site.commune_page("44043")
    assert "{{" not in page
    assert 'href="aide/"' in page and "site-footer" in page


def test_analytics_tag_only_with_token():
    assert analytics_tag("") == ""
    tag = analytics_tag("abc123")
    assert "cloudflareinsights.com/beacon.min.js" in tag and '"token": "abc123"' in tag


def test_static_pages_get_analytics_marker_replaced(site, tmp_path, monkeypatch):
    import pipeline.pages as pages

    monkeypatch.setattr(pages, "ANALYTICS_TOKEN", "tok")
    for rel in pages.STATIC_PAGES:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / "public" / rel, tmp_path / rel)
        assert "<!-- analytics -->" in (tmp_path / rel).read_text()
    site.write(tmp_path)
    for rel in pages.STATIC_PAGES:
        text = (tmp_path / rel).read_text()
        assert "<!-- analytics -->" not in text and '"token": "tok"' in text
    assert "aide/" in (tmp_path / "sitemap.xml").read_text()


def test_at_place():
    assert at_place("Clisson") == "à Clisson"
    assert at_place("Le Pellerin") == "au Pellerin"
    assert at_place("Les Sorinières") == "aux Sorinières"
    assert at_place("La Baule-Escoublac") == "à La Baule-Escoublac"


def test_seo_tags(site, tmp_path):
    page = site.commune_page("44043")
    assert 'property="og:image" content="' + SITE_URL + 'img/og.png"' in page
    # The score follows the monthly SIRENE stock (bakery age): check its shape, not its value.
    assert '"@type":"BreadcrumbList"' in page and re.search(r"note \d{1,3}/100", page)
    dep = site.dep_page("44")
    assert dep.count("<title>") == 1 and "Loire-Atlantique (44)" in dep
    assert 'href="loire-atlantique/clisson-44043/"' in dep and "<!-- places -->" not in dep
    assert dep.count('property="og:title"') == 1  # the shell's generic tags are replaced, not duplicated
    for rel in ("index.html", "aide/index.html", "panier/index.html"):
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / "public" / rel, tmp_path / rel)
    site.write(tmp_path)
    home = (tmp_path / "index.html").read_text()
    assert f'<link rel="canonical" href="{SITE_URL}">' in home and 'href="loire-atlantique/"' in home
    assert '"@type":"Organization"' in home
    llms = (tmp_path / "llms.txt").read_text()
    assert llms.startswith("# Fournyl\n") and f"({SITE_URL}loire-atlantique/)" in llms
    sitemap = (tmp_path / "sitemap.xml").read_text()
    assert sitemap.count("<url>") == 2 + len(site.exported) + len(site.communes) and "<lastmod>" in sitemap
    assert "noindex" in (tmp_path / "panier/index.html").read_text()


def test_bakery_pages(site):
    """Each bakery has its page; a sole trader's page is kept out of search engines and sitemaps."""
    shops = site.shops("44043")
    if not shops:
        pytest.skip("no bakery data")
    page = site.route(site.bakery_path("44043", shops[0]))
    assert page and 'name="fournyl-bakery"' in page and "{{" not in page
    sole = next((b for code in site.communes for b in site.shops(code) if not b["indexed"]), None)
    if sole:
        code = next(c for c in site.communes if sole in site.shops(c))
        html_ = site.bakery_page(code, sole)
        assert '<meta name="robots" content="noindex">' in html_ and '"@type":"Bakery"' not in html_
        assert all(site.bakery_path(code, sole) not in sm for sm in site.bakery_sitemaps())
