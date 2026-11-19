"""Checks on the files written to public/data by `python -m pipeline.run` (DATA.md §5).

Run the pipeline first, then: uv run pytest
Update the Clisson snapshot after a deliberate source change: UPDATE_SNAPSHOT=1 uv run pytest
"""

import json
import os
import re
from pathlib import Path

import pytest

from pipeline.config import CRITERIA, OUT

SNAPSHOT = Path(__file__).parent / "snapshots" / "44043.json"


def fetched(meta, sid):
    return any(s["id"] == sid and s.get("fetched") for s in meta["sources"])


def load(rel):
    return json.loads((OUT / rel).read_text())


@pytest.fixture(scope="module")
def meta():
    if not (OUT / "meta.json").exists():
        pytest.skip("public/data not built: run `uv run python -m pipeline.run --dep 44` first")
    return load("meta.json")


@pytest.fixture(scope="module")
def index(meta):
    return load("communes-index.json")


def test_meta_lists_every_source_with_vintage(meta):
    assert meta["cog_year"] == 2026
    assert len(meta["sources"]) >= 10
    for s in meta["sources"]:
        assert s["name"] and s["vintage"] and s["licence"] and s["url"].startswith("https://")


def test_index_one_row_per_commune(index, meta):
    codes = index["code"]
    assert len(codes) == len(set(codes)), "duplicate commune codes"
    assert all(len(c) == 5 for c in codes)
    assert {c[:2] for c in codes} <= set(meta["departements"])
    n = len(codes)
    for key in ["name", "dep", "lat", "lon", "pop", "bakeries"]:
        assert len(index[key]) == n
    for c in index["v"]:
        assert len(index["v"][c]) == n and len(index["pct"][c]) == n


def test_index_row_count_for_loire_atlantique(index, meta):
    if meta["departements"] == ["44"]:
        assert len(index["code"]) == 207  # communes of 44 in COG 2026


def test_value_ranges(index):
    assert all(p >= 0 for p in index["pop"])
    assert all(b >= 0 for b in index["bakeries"])
    assert all(41 < lat < 52 and -6 < lon < 10 for lat, lon in zip(index["lat"], index["lon"]))
    for c in index["pct"]:
        assert all(p is None or 0 <= p <= 1000 for p in index["pct"][c])
    assert all(v is None or 5_000 < v < 80_000 for v in index["v"]["income"])
    assert all(v is None or -20 < v < 25 for v in index["v"]["growth"])
    assert all(v is None or v >= 0 for v in index["v"]["crime"])
    assert all(v is None or 0 <= v < 150 for v in index["v"]["bakery_age"])
    # Mean bakery age only where the commune has a bakery.
    assert all(v is None or b > 0 for v, b in zip(index["v"]["bakery_age"], index["bakeries"]))


def test_missing_values_stay_missing(index):
    """Missing data is null, never 0, and its percentile is null too."""
    for c in index["v"]:
        for v, p, b, pop in zip(index["v"][c], index["pct"][c], index["bakeries"], index["pop"]):
            if c == "per_bakery" and b == 0 and pop > 0:
                assert v is None and p is not None  # no bakery: no ratio, but ranked (boost)
            else:
                assert (v is None) == (p is None)


def test_no_bakery_ranks_above_same_size_with_one(index):
    """SPEC §4: without a bakery, a commune ranks above one of similar size that has one."""
    rows = list(zip(index["pop"], index["bakeries"], index["pct"]["per_bakery"]))
    none = [(pop, p) for pop, b, p in rows if b == 0 and pop >= 1000]  # full boost from 1,000 inhabitants
    one = [(pop, p) for pop, b, p in rows if b == 1]
    for pop, p in none:
        similar = [q for pop1, q in one if abs(pop1 - pop) / pop < 0.1]
        if similar:
            assert p > max(similar)


def test_geometry_and_adjacency(index, meta):
    codes = set(index["code"])
    for dep in meta["departements"]:
        geo = load(f"geo/{dep}.geojson")
        geo_codes = {f["properties"]["code"] for f in geo["features"]}
        assert geo_codes == {c for c in codes if c.startswith(dep)}
        adj = load(f"adj/{dep}.json")
        assert set(adj) == geo_codes
        for code, nbs in adj.items():
            assert code not in nbs
            for nb in nbs:
                if nb in adj:
                    assert code in adj[nb], f"adjacency not symmetric: {code} / {nb}"
        islands = [c for c, nbs in adj.items() if not nbs]
        assert len(islands) <= 8, f"communes without neighbours: {islands}"  # islands (Morbihan has 5)


def test_departements_file(meta):
    d = load("departements.geojson")
    assert len(d["features"]) == 96  # metropolitan France + Corsica


def test_commune_pages_exist(index):
    for code in index["code"]:
        assert (OUT / "commune" / f"{code}.json").exists()


def test_bakery_pages(index, meta):
    """One record per bakery / pastry shop (a sole trader is never named by company: see build_local.bread_points)."""
    shops = [b for code in index["code"] if (OUT / "bakery" / f"{code}.json").exists() for b in load(f"bakery/{code}.json")]
    if not any(c.startswith("44") for c in index["code"]):
        pytest.skip("dep 44 not built")
    assert len(shops) > 500 and len({b["id"] for b in shops}) == len(shops)
    for b in shops:
        assert b["kind"] in {"bakery", "pastry"} and b["address"]
        assert len(b["near"]) <= 8 and all(n["m"] <= 2000 for n in b["near"])
        assert all((n["path"] is None) or n["path"].endswith("/") for n in b["near"])
        if b["accounts"]:
            assert b["accounts"]["revenue"] > 0 and len(b["accounts"]["closed"]) == 7
    if fetched(meta, "ratios_inpi"):
        assert sum(bool(b["accounts"]) for b in shops) >= 0.05 * len(shops)
    # Enrichments: OpenStreetMap (hours, contact), Accès Libre, location history, nearby facilities.
    if fetched(meta, "banco"):
        assert sum(bool(b["osm"]) for b in shops) >= 0.2 * len(shops)
    if fetched(meta, "acceslibre"):
        assert sum(bool(b["access"]) for b in shops) >= 0.1 * len(shops)
    assert sum(bool(b["history"]) for b in shops) >= 0.2 * len(shops)
    for b in shops:
        assert b["footfall"] is None or set(b["footfall"]) == {"schools", "secondary", "stations", "supermarkets", "pharmacies", "doctors", "post"}
        for h in b["history"]:
            assert h["to"] >= (h["from"] or 0) and h["kind"] in {"bakery", "pastry", "bake_off", "retail"}


def test_commune_risks(index, meta):
    if not fetched(meta, "gaspar"):
        pytest.skip("GASPAR not downloaded in this build (optional source)")
    for code in index["code"]:
        r = load(f"commune/{code}.json")["risks"]
        assert r is not None and r["catnat"]["total"] >= r["catnat"]["recent"] >= 0
        assert sum(r["catnat"]["by_kind"].values()) == r["catnat"]["total"]


def test_privacy_no_individual_data():
    """CLAUDE.md: never a SIRET, a director, a person's birth year (bakery pages use their own id)."""
    siret = re.compile(r"\b\d{14}\b")
    forbidden_keys = re.compile(r'"[^"]*(siret|birth|naissance|dirigeant|director)[^"]*"\s*:')
    url = re.compile(r"https?://[^\s\"]+")
    for path in OUT.rglob("*.json"):
        text = path.read_text().lower()
        # Web addresses from OpenStreetMap can hold long numbers (a Facebook page id), never a SIRET of ours.
        assert not siret.search(url.sub("", text)), path
        assert not forbidden_keys.search(text), path


def test_clisson_snapshot(meta):
    """Clisson (44043) values change only when a source changes."""
    if "44" not in meta["departements"]:
        pytest.skip("dep 44 not built")
    page = load("commune/44043.json")
    current = {
        "pop": page["pop"],
        "bakeries": page["bakeries"],
        # bakery_age follows the monthly SIRENE stock: left out so the snapshot changes only with the slower sources.
        "criteria": {k: v for k, v in page["criteria"].items() if k != "bakery_age"},
        "history": page["history"],
        "income": page["income"],
        "amenities": page["amenities"],
        "neighbours": page["neighbours"],
    }
    if os.environ.get("UPDATE_SNAPSHOT") or not SNAPSHOT.exists():
        SNAPSHOT.parent.mkdir(exist_ok=True)
        SNAPSHOT.write_text(json.dumps(current, indent=1, ensure_ascii=False))
        pytest.skip("snapshot written")
    assert current == json.loads(SNAPSHOT.read_text())


def test_bakery_history_counts(index):
    for code in index["code"]:
        h = load(f"commune/{code}.json")["bakery_history"]
        assert h["since"] == 2016
        assert all(isinstance(h[k], int) and h[k] >= 0 for k in ("takeovers", "openings", "closures"))
    # Casson (44027): the 2020 takeover of its only bakery.
    if (OUT / "commune" / "44027.json").exists():
        assert load("commune/44027.json")["bakery_history"]["takeovers"] >= 1


def test_business_prices_are_aggregates_only(meta):
    fonds = load("fonds.json")
    assert set(fonds) == {"since", "min_sales", "france", "departements"}
    assert fonds["france"]["n"] > 1000
    for stats in [fonds["france"], *fonds["departements"].values()]:
        assert set(stats) == {"n", "median", "q1", "q3"}
        assert stats["n"] >= fonds["min_sales"], "a price shown from too few sales could identify a sale"
        assert 5_000 <= stats["q1"] <= stats["median"] <= stats["q3"] <= 3_000_000


def test_local_context(index):
    for code in index["code"]:
        page = load(f"commune/{code}.json")
        sizes = page["businesses"]["by_size"]
        assert sum(sizes.values()) == page["businesses"]["total"]
        assert len(page["businesses"]["main_employers"]) <= 3
        pol = page["politics"]
        if pol:
            assert set(pol) == {"mayor", "list", "nuance", "rounds"}  # name only: no birth date, no occupation
            for r in pol["rounds"]:
                assert r["turnout"] is None or 0 < r["turnout"] <= 100
                assert r["blank_null"] is None or 0 <= r["blank_null"] <= 100
                for l in r["lists"]:
                    # Share of registered voters never exceeds the share of valid votes.
                    assert l["pct_reg"] is None or l["pct"] is None or l["pct_reg"] <= l["pct"] + 0.01
    clisson = load("commune/44043.json")
    assert clisson["politics"]["mayor"] and clisson["politics"]["rounds"]


def test_bread_points(index):
    for code in index["code"][:2000]:
        pts = load(f"commune/{code}.json")["bread_points"]
        assert len(pts) <= 300
        assert [p["km"] for p in pts] == sorted(p["km"] for p in pts)
        for p in pts:
            assert set(p) == {"lat", "lon", "km", "kind", "name", "year", "here", "hyg", "hyg_date", "id"}
            assert (p["id"] is not None) == (p["kind"] in {"bakery", "pastry"})
            assert p["hyg"] in {None, 1, 2, 3, 4}
            assert (p["hyg"] is None) == (p["hyg_date"] is None)
            assert p["hyg_date"] is None or re.fullmatch(r"20\d\d-[01]\d", p["hyg_date"])
            assert p["kind"] in {"bakery", "pastry", "bake_off", "retail"} and p["km"] <= 5.0
            assert p["year"] is None or 1900 <= p["year"] <= 2100
            assert isinstance(p["here"], bool)
    clisson = load("commune/44043.json")["bread_points"]
    assert any(p["here"] for p in clisson) and any(not p["here"] for p in clisson)
    assert sum(p["year"] is not None for p in clisson) >= 0.9 * len(clisson)


def test_hygiene_inspections(index, meta):
    """Alim'Confiance results reach the bread points (joined on SIRET, which is never exported)."""
    if not fetched(meta, "alimconfiance"):
        pytest.skip("Alim'Confiance not downloaded in this build (optional source)")
    pts = [pt for code in index["code"] for pt in load(f"commune/{code}.json")["bread_points"] if pt["here"]]
    rated = [pt for pt in pts if pt["hyg"]]
    if any(c.startswith("44") for c in index["code"]):
        assert 0.05 * len(pts) <= len(rated) <= 0.6 * len(pts), "inspections cover a minority of shops each year"
        assert sum(pt["hyg"] <= 2 for pt in rated) >= 0.7 * len(rated), "most results are (très) satisfaisant"


def test_water_hardness(index, meta):
    if not fetched(meta, "eau_potable"):
        pytest.skip("tap water file not downloaded in this build (optional source)")
    assert meta["years"]["water"] >= 2024
    classes = {"very_soft", "soft", "medium", "hard", "very_hard"}
    with_water = 0
    for code in index["code"]:
        w = load(f"commune/{code}.json")["water"]
        if w is None:
            continue
        with_water += 1
        assert set(w) == {"year", "th", "min", "max", "networks", "class"}
        assert 0 <= w["min"] <= w["th"] <= w["max"] <= 150 and w["networks"] >= 1 and w["class"] in classes
    assert with_water >= 0.8 * len(index["code"])
    if "44043" in index["code"]:  # Clisson: soft to medium water from the Vignoble network
        assert 10 <= load("commune/44043.json")["water"]["th"] <= 25


def test_postcodes(index):
    """Postcodes are display data: five digits, sorted, known for (almost) every commune."""
    cps = dict(zip(index["code"], index["cp"]))
    assert len(index["cp"]) == len(index["code"])
    known = [cp for cp in cps.values() if cp]
    assert len(known) >= 0.99 * len(cps)
    for cp in known:
        parts = cp.split()
        assert parts == sorted(set(parts)) and all(len(p) == 5 and p.isdigit() for p in parts)
    if "44043" in cps:  # Clisson
        assert cps["44043"] == "44190"
    if "44109" in cps:  # Nantes has several
        assert cps["44109"].split()[0] == "44000" and len(cps["44109"].split()) > 1
