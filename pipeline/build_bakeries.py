"""One record per bakery and pastry shop (SIRENE 10.71C and 10.71D), for its own page (docs/SPEC.md §3.7).

Only establishments released publicly in SIRENE. Privacy (CLAUDE.md):
- the SIRET never leaves the pipeline: pages use a stable short id derived from it (`bakery_id`);
- a sole trader (entreprise individuelle) is a person: never named (shop sign or usual name only);
- nothing about directors (no name, no age, no "likely to sell").
Every page is indexed by search engines. Published accounts (INPI ratios) are shown whenever filed as public.
"""

import math
import re

import numpy as np
import pandas as pd
import pyarrow.compute as pc
import pyarrow.parquet as pq

from pipeline import cog, fetch, transit
from pipeline.build_local import BREAD_KINDS, bakery_id, hygiene, legal_codes
from pipeline.config import (
    BAKERY_NEAR_M, BAKERY_NEAR_MAX, BAKERY_PAGE_KINDS, FOOTFALL, FOOTFALL_M, HISTORY_NEAR_M, OSM_MATCH_M,
    TRANSIT_M, TRANSIT_MAX_LINES, TRANSIT_SKIP_DEPS,
)

SOLE_TRADER = "1000"

# Legal form (catégorie juridique, level III) -> short label; the first matching prefix wins.
LEGAL_FORMS = [
    ("1000", "Entreprise individuelle"),
    ("5498", "EURL"),
    ("54", "SARL"),
    ("5720", "SASU"),
    ("57", "SAS"),
    ("55", "SA"),
    ("56", "SA"),
    ("52", "SNC"),
    ("65", "Société civile"),
    ("9", "Association ou autre"),
]

# Workforce bracket (trancheEffectifsEtablissement) -> label.
STAFF = {
    "00": "0 salarié", "01": "1 ou 2", "02": "3 à 5", "03": "6 à 9", "11": "10 à 19", "12": "20 à 49",
    "21": "50 à 99", "22": "100 à 199", "31": "200 à 249", "32": "250 à 499",
}


def legal_label(code) -> str | None:
    code = str(code) if code is not None and not (isinstance(code, float) and math.isnan(code)) else ""
    return next((label for prefix, label in LEGAL_FORMS if code.startswith(prefix)), "Société" if code else None)


STREET_TYPES = {
    "AV": "avenue", "BD": "boulevard", "CHE": "chemin", "IMP": "impasse", "PL": "place", "QUAI": "quai", "RTE": "route",
    "RUE": "rue", "ALL": "allée", "CRS": "cours", "SQ": "square", "FG": "faubourg", "PROM": "promenade", "PASS": "passage",
    "RPT": "rond-point", "CHEM": "chemin", "LD": "lieu-dit", "HAM": "hameau", "VOIE": "voie", "ZA": "ZA", "ZI": "ZI",
}
SMALL_WORDS = {"de", "du", "des", "la", "le", "les", "et", "à", "aux", "en", "sur", "sous", "d", "l"}
REPEAT = {"B": "bis", "T": "ter", "Q": "quater"}


def _nice(text: str) -> str:
    """'RUE DE LA GARE' -> 'Rue de la Gare'; SIRENE writes street names in capitals."""
    words = text.lower().split()
    out = []
    for i, w in enumerate(words):
        if i and w in SMALL_WORDS:
            out.append(w)
        elif "'" in w:
            head, tail = w.split("'", 1)
            out.append(f"{head}'{tail.capitalize()}" if head in SMALL_WORDS else w.capitalize())
        else:
            out.append("-".join(p if k and p in SMALL_WORDS else p.capitalize() for k, p in enumerate(w.split("-"))))
    return " ".join(out)


def _address(r) -> str | None:
    """'12 bis rue de la Gare' from the SIRENE address fields (missing parts skipped)."""
    s = lambda v: v.strip() if isinstance(v, str) and v.strip() else None  # noqa: E731
    num, rep, kind, street = s(r.num), s(r.rep), s(r.street_type), s(r.street)
    if not street:
        return None
    name = _nice(f"{STREET_TYPES.get(kind, kind) if kind else ''} {street}".strip())
    if num:  # "12 bis rue de la Gare", but "Rue de la Gare" when there is no number
        name = name[0].lower() + name[1:]
    return " ".join(x for x in (num, REPEAT.get(rep, rep.lower() if rep else None), name) if x)


def _accounts(sirens: set[str]) -> pd.DataFrame:
    """Latest published revenue (and net income) per company: last closing date with a revenue figure."""
    if not fetch.available("ratios_inpi"):
        return pd.DataFrame(columns=["closed", "chiffre_d_affaires", "resultat_net"])
    a = pq.read_table(
        fetch.path("ratios_inpi"),
        columns=["siren", "date_cloture_exercice", "chiffre_d_affaires", "resultat_net", "confidentiality"],
        filters=pc.field("siren").isin(sorted(sirens)),
    ).to_pandas()
    a = a[a.chiffre_d_affaires.notna() & (a.chiffre_d_affaires > 0)]
    a = a.sort_values("date_cloture_exercice").drop_duplicates("siren", keep="last")
    a["closed"] = pd.to_datetime(a.date_cloture_exercice).dt.strftime("%Y-%m")
    return a.set_index("siren")[["closed", "chiffre_d_affaires", "resultat_net"]]


def _nearest(x: np.ndarray, y: np.ndarray, targets: np.ndarray) -> dict[int, list[tuple[int, float]]]:
    """For each target index: the other points within BAKERY_NEAR_M (index, metres), nearest first (grid buckets)."""
    cell = BAKERY_NEAR_M
    keys = list(zip((x // cell).astype(int), (y // cell).astype(int)))
    grid: dict[tuple[int, int], list[int]] = {}
    for i, k in enumerate(keys):
        grid.setdefault(k, []).append(i)
    out = {}
    for i in targets:
        kx, ky = keys[i]
        cand = [j for dx in (-1, 0, 1) for dy in (-1, 0, 1) for j in grid.get((kx + dx, ky + dy), ()) if j != i]
        if not cand:
            out[i] = []
            continue
        cand = np.array(cand)
        d = np.hypot(x[cand] - x[i], y[cand] - y[i])
        keep = d <= BAKERY_NEAR_M
        order = np.argsort(d[keep])[:BAKERY_NEAR_MAX]
        out[i] = [(int(cand[keep][o]), float(d[keep][o])) for o in order]
    return out


def _within(sx: np.ndarray, sy: np.ndarray, tx: np.ndarray, ty: np.ndarray, radius: float) -> list[list[tuple[int, float]]]:
    """For each target point: the source points within `radius` metres (index, distance), nearest first."""
    cell = radius
    grid: dict[tuple[int, int], list[int]] = {}
    for i, k in enumerate(zip((sx // cell).astype(int), (sy // cell).astype(int))):
        grid.setdefault(k, []).append(i)
    out = []
    for x, y in zip(tx, ty):
        kx, ky = int(x // cell), int(y // cell)
        cand = [j for dx in (-1, 0, 1) for dy in (-1, 0, 1) for j in grid.get((kx + dx, ky + dy), ())]
        if not cand:
            out.append([])
            continue
        cand = np.array(cand)
        d = np.hypot(sx[cand] - x, sy[cand] - y)
        keep = d <= radius
        order = np.argsort(d[keep])
        out.append([(int(cand[keep][o]), float(d[keep][o])) for o in order])
    return out


def _lambert(lon: pd.Series, lat: pd.Series) -> tuple[np.ndarray, np.ndarray]:
    import geopandas as gpd

    g = gpd.GeoSeries(gpd.points_from_xy(pd.to_numeric(lon, errors="coerce"), pd.to_numeric(lat, errors="coerce")), crs=4326).to_crs(2154)
    return g.x.to_numpy(), g.y.to_numpy()


def _match(pages: pd.DataFrame, other: pd.DataFrame, x: np.ndarray, y: np.ndarray) -> dict[int, int]:
    """Page index -> row of `other` describing the same shop: same SIRET, or the nearest in the same commune
    within OSM_MATCH_M. `other` has columns siret (may be empty) and code (INSEE commune)."""
    by_siret = {s: i for i, s in enumerate(other.siret) if isinstance(s, str) and len(s) == 14}
    near = _within(x, y, pages.x.to_numpy(), pages.y.to_numpy(), OSM_MATCH_M)
    out, taken = {}, set()
    for (i, r), cands in zip(pages.iterrows(), near):
        j = by_siret.get(r.siret)
        if j is None:
            j = next((c for c, _ in cands if other.code.iat[c] == r.home and c not in taken and not isinstance(other.siret.iat[c], str)), None)
        if j is not None:
            out[i] = j
            taken.add(j)
    return out


def _osm(pages: pd.DataFrame) -> dict[int, dict]:
    """Opening hours, website, phone and wheelchair access from OpenStreetMap (BANCO export)."""
    import zipfile

    if not fetch.available("banco"):
        return {}

    with zipfile.ZipFile(fetch.path("banco")) as z:
        o = pd.read_csv(z.open("data.csv"), sep=";", dtype=str, usecols=[
            "X", "Y", "osm_id", "type", "opening_hours", "website", "phone", "wheelchair", "siret", "com_insee", "last_update"])
    o = o[o.type.isin(["bakery", "pastry"])].reset_index(drop=True)
    o["code"] = o.com_insee.str.strip('"')
    x, y = _lambert(o.X, o.Y)
    keep = lambda v: v.strip() if isinstance(v, str) and v.strip() else None  # noqa: E731
    out = {}
    for i, j in _match(pages, o, x, y).items():
        r = o.iloc[j]
        info = {
            "hours": keep(r.opening_hours),
            "website": keep(r.website),
            "phone": keep(r.phone),
            "wheelchair": keep(r.wheelchair),
            "osm": keep(r.osm_id),
            "updated": keep(r.last_update),
        }
        if any(info[k] for k in ("hours", "website", "phone", "wheelchair")):
            out[i] = info
    return out


def _bool(v):
    return True if v == "True" else False if v == "False" else None


def _access(pages: pd.DataFrame) -> dict[int, dict]:
    """Accessibility of the entrance, from Accès Libre (filled in by shops, councils and volunteers)."""
    if not fetch.available("acceslibre"):
        return {}
    cols = ["id", "siret", "activite", "code_insee", "longitude", "latitude", "entree_plain_pied", "entree_marches",
            "entree_marches_rampe", "entree_largeur_mini", "entree_porte_type", "stationnement_pmr", "stationnement_ext_pmr",
            "accueil_personnels", "cheminement_ext_plain_pied"]
    a = pd.read_csv(fetch.path("acceslibre"), dtype=str, usecols=cols, low_memory=False)
    a = a[a.activite.str.contains("oulangerie|âtisserie", na=False) & a.longitude.notna()].reset_index(drop=True)
    a["code"] = a.code_insee
    x, y = _lambert(a.longitude, a.latitude)
    out = {}
    for i, j in _match(pages, a, x, y).items():
        r = a.iloc[j]
        steps = pd.to_numeric(r.entree_marches, errors="coerce")
        width = pd.to_numeric(r.entree_largeur_mini, errors="coerce")
        out[i] = {
            "step_free": _bool(r.entree_plain_pied),
            "steps": None if pd.isna(steps) else int(steps),
            "ramp": None if not isinstance(r.entree_marches_rampe, str) else r.entree_marches_rampe != "aucune",
            "width": None if pd.isna(width) else int(width),
            "door": r.entree_porte_type if isinstance(r.entree_porte_type, str) else None,
            "parking": _bool(r.stationnement_pmr) or _bool(r.stationnement_ext_pmr),
            "staff": r.accueil_personnels if isinstance(r.accueil_personnels, str) else None,
        }
    return out


def _history(pages: pd.DataFrame) -> dict[int, list[dict]]:
    """Closed points of sale of bread at the same place (within HISTORY_NEAR_M, or the same address): who ran a
    shop here before, from when to when. A sole trader is never named (CLAUDE.md)."""
    cols = {
        "siren": "siren", "siret": "siret", "activitePrincipaleEtablissement": "naf", "statutDiffusionEtablissement": "public",
        "enseigne1Etablissement": "sign", "denominationUsuelleEtablissement": "usual_name",
        "coordonneeLambertAbscisseEtablissement": "x", "coordonneeLambertOrdonneeEtablissement": "y",
        "dateCreationEtablissement": "created", "dateDebut": "closed", "numeroVoieEtablissement": "num",
        "libelleVoieEtablissement": "street", "codePostalEtablissement": "cp",
    }
    f = pq.read_table(
        fetch.path("sirene"), columns=list(cols),
        filters=(pc.field("etatAdministratifEtablissement") == "F") & pc.field("activitePrincipaleEtablissement").isin(list(BREAD_KINDS)),
    ).to_pandas().rename(columns=cols)
    f = f[f.public == "O"].reset_index(drop=True)
    f["x"] = pd.to_numeric(f.x, errors="coerce")
    f["y"] = pd.to_numeric(f.y, errors="coerce")
    ul = pq.read_table(
        fetch.path("sirene_ul"), columns=["siren", "denominationUniteLegale", "categorieJuridiqueUniteLegale", "statutDiffusionUniteLegale"],
        filters=pc.field("siren").isin(f.siren.unique().tolist()),
    ).to_pandas()
    ul.columns = ["siren", "company", "legal_form", "ul_public"]
    ul["legal_form"] = legal_codes(ul.legal_form)
    f = f.merge(ul, on="siren", how="left")
    company = f.company.where((f.legal_form != SOLE_TRADER) & (f.ul_public == "O"))
    f["name"] = f.usual_name.fillna(f.sign).fillna(company)
    key = lambda num, street, cp: f"{num}|{street}|{cp}" if all(isinstance(v, str) and v for v in (num, street, cp)) else None  # noqa: E731
    by_address: dict[str, list[int]] = {}
    for j, k in enumerate(map(key, f.num, f.street, f.cp)):
        if k:
            by_address.setdefault(k, []).append(j)
    located = f.x.notna() & f.y.notna()
    fx, fy = f.x.where(located, -1e9).to_numpy(), f.y.where(located, -1e9).to_numpy()
    near = _within(fx, fy, pages.x.to_numpy(), pages.y.to_numpy(), HISTORY_NEAR_M)
    out = {}
    for (i, r), cands in zip(pages.iterrows(), near):
        js = {c for c, _ in cands} | set(by_address.get(key(r.num, r.street, r.cp), []))
        rows = []
        for j in js:
            q = f.iloc[j]
            if q.siren == r.siren:  # the same company moving or renumbered: not a previous operator
                continue
            start, end = pd.to_datetime(q.created, errors="coerce"), pd.to_datetime(q.closed, errors="coerce")
            if pd.isna(end):
                continue
            rows.append({
                "kind": BREAD_KINDS[q.naf],
                "name": q["name"] if isinstance(q["name"], str) else None,
                "from": int(start.year) if pd.notna(start) else None,
                "to": int(end.year),
            })
        if rows:
            out[i] = sorted(rows, key=lambda h: (h["to"], h["from"] or 0), reverse=True)
    return out


def _footfall(pages: pd.DataFrame) -> dict[int, dict]:
    """Facilities that bring passers-by within FOOTFALL_M of the shop (BPE 2025, geolocated)."""
    if not fetch.available("bpe_xy"):
        return {}
    codes = {c: k for k, lst in FOOTFALL.items() for c in lst}
    b = pq.read_table(
        fetch.path("bpe_xy"), columns=["TYPEQU", "LAMBERT_X", "LAMBERT_Y", "EPSG"],
        filters=pc.field("TYPEQU").isin(list(codes)),
    ).to_pandas()
    b = b[(b.EPSG.astype(str) == "2154") & b.LAMBERT_X.notna()].reset_index(drop=True)  # metropolitan France (Lambert-93)
    kinds = b.TYPEQU.map(codes).to_numpy()
    near = _within(b.LAMBERT_X.astype(float).to_numpy(), b.LAMBERT_Y.astype(float).to_numpy(), pages.x.to_numpy(), pages.y.to_numpy(), FOOTFALL_M)
    out = {}
    for i, cands in zip(pages.index, near):
        counts = {k: 0 for k in FOOTFALL}
        for j, _ in cands:
            counts[kinds[j]] += 1
        out[i] = counts
    return out


MODE_ORDER = {"train": 0, "metro": 1, "tram": 2, "bus": 3}


def _line_key(line: str):
    """Natural order: 2 before 10, numbers before letters (C1, C2…)."""
    return [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in re.findall(r"\d+|\D+", line.lower())]


def _transit(pages: pd.DataFrame) -> dict[int, dict | None]:
    """Public transport within TRANSIT_M of the shop: train stations by name, other lines grouped by network.

    None (block hidden) where the data is known to be incomplete (TRANSIT_SKIP_DEPS) or the source is missing.
    """
    if not fetch.available("transit"):
        return {}
    s = pd.read_parquet(fetch.path("transit"))
    sx, sy = _lambert(s.lon, s.lat)
    near = _within(sx, sy, pages.x.to_numpy(), pages.y.to_numpy(), TRANSIT_M)
    modes, networks, lines_, stops = (s[c].tolist() for c in ("mode", "network", "line", "stop"))
    # A "train" stop is kept as a station only if the BPE lists a station within 300 m: some feeds code a
    # coach or a tram stop as rail (Nantes Pirmil in the Aléop TER feed).
    real = set()
    if fetch.available("bpe_xy"):
        g = pq.read_table(fetch.path("bpe_xy"), columns=["TYPEQU", "LAMBERT_X", "LAMBERT_Y", "EPSG"],
                          filters=pc.field("TYPEQU").isin(FOOTFALL["stations"])).to_pandas()
        g = g[(g.EPSG.astype(str) == "2154") & g.LAMBERT_X.notna()]
        train = np.flatnonzero(s["mode"].to_numpy() == "train")
        hits = _within(g.LAMBERT_X.astype(float).to_numpy(), g.LAMBERT_Y.astype(float).to_numpy(), sx[train], sy[train], 300)
        real = {int(j) for j, h in zip(train, hits) if h}
    norm_net = {n: transit.norm(n) for n in set(networks)}
    out = {}
    for (i, r), cands in zip(pages.iterrows(), near):
        if str(r.home)[:2] in TRANSIT_SKIP_DEPS:
            out[i] = None
            continue
        stations, kept, groups, seen = [], [], {}, set()
        for j, _ in cands:  # nearest stops first
            mode, network, line, stop = modes[j], networks[j], lines_[j], stops[j]
            if mode == "train":  # one name per station: feeds name it "Clisson" or "Gare de Clisson"
                if re.search(r"routi[eè]re", stop, re.I):  # a coach station next to the railway station
                    continue
                name = re.sub(r"^gare (de |d'|d’|du |des )?", "", stop, flags=re.I).strip()
                if name and j in real and all(np.hypot(sx[j] - sx[k], sy[j] - sy[k]) > 300 for k in kept):
                    stations.append(name[:1].upper() + name[1:])
                    kept.append(j)
                continue
            key = (mode, norm_net[network], line.casefold())
            if key in seen or len(seen) >= TRANSIT_MAX_LINES:
                continue
            seen.add(key)
            groups.setdefault((mode, network), []).append(line)
        out[i] = {
            "stations": stations[:3],
            "lines": [
                {"mode": m, "network": n, "lines": sorted(lines, key=_line_key)}
                for (m, n), lines in sorted(groups.items(), key=lambda kv: (MODE_ORDER[kv[0][0]], -len(kv[1]), kv[0][1]))
            ],
        }
    return out


def bakeries(codes: set[str]) -> dict[str, list[dict]]:
    """Per commune (INSEE code): its bakeries and pastry shops, each with what its page shows."""
    import geopandas as gpd  # heavy import kept local to this step

    cols = {
        "siren": "siren", "siret": "siret", "activitePrincipaleEtablissement": "naf", "statutDiffusionEtablissement": "public",
        "enseigne1Etablissement": "sign", "denominationUsuelleEtablissement": "usual_name",
        "coordonneeLambertAbscisseEtablissement": "x", "coordonneeLambertOrdonneeEtablissement": "y",
        "dateCreationEtablissement": "created", "codeCommuneEtablissement": "commune", "etablissementSiege": "seat",
        "trancheEffectifsEtablissement": "staff", "anneeEffectifsEtablissement": "staff_year",
        "numeroVoieEtablissement": "num", "indiceRepetitionEtablissement": "rep", "typeVoieEtablissement": "street_type",
        "libelleVoieEtablissement": "street", "codePostalEtablissement": "cp",
    }
    t = pq.read_table(
        fetch.path("sirene"),
        columns=list(cols),
        filters=(pc.field("etatAdministratifEtablissement") == "A") & pc.field("activitePrincipaleEtablissement").isin(list(BREAD_KINDS)),
    ).to_pandas().rename(columns=cols)
    t["x"] = pd.to_numeric(t.x, errors="coerce")
    t["y"] = pd.to_numeric(t.y, errors="coerce")
    t = t[(t.public == "O") & t.x.notna() & t.y.notna()].reset_index(drop=True)
    t["siret"] = t.siret.astype(str)

    ul = pq.read_table(
        fetch.path("sirene_ul"),
        columns=["siren", "denominationUniteLegale", "categorieJuridiqueUniteLegale", "statutDiffusionUniteLegale", "dateCreationUniteLegale"],
        filters=pc.field("siren").isin(t.siren.unique().tolist()),
    ).to_pandas()
    ul.columns = ["siren", "company", "legal_form", "ul_public", "company_created"]
    ul["legal_form"] = legal_codes(ul.legal_form)
    t = t.merge(ul, on="siren", how="left")
    t["sole_trader"] = t.legal_form == SOLE_TRADER
    company = t.company.where(~t.sole_trader & (t.ul_public == "O"))
    t["name"] = t.usual_name.fillna(t.sign).fillna(company)

    mapping = cog.code_mapping()
    t["home"] = t.commune.map(lambda c: mapping.get(c, c) if isinstance(c, str) else None)
    pts = gpd.GeoDataFrame(t[["siret"]], geometry=gpd.points_from_xy(t.x, t.y), crs=2154).to_crs(4326)
    t["lat"] = pts.geometry.y.round(5).values
    t["lon"] = pts.geometry.x.round(5).values

    # Pages: bakeries and pastry shops of the communes in scope. Neighbours: every point of sale of bread.
    pages = t.index[t.naf.isin(list(BAKERY_PAGE_KINDS)) & t.home.isin(codes)].to_numpy()
    near = _nearest(t.x.to_numpy(), t.y.to_numpy(), pages)
    network = t[t.naf.isin(list(BAKERY_PAGE_KINDS))].groupby("siren").size()
    acc = _accounts(set(t.loc[pages].siren))
    hyg = hygiene()
    shop_rows = t.loc[pages]
    osm = _osm(shop_rows)
    access = _access(shop_rows)
    history = _history(shop_rows)
    footfall = _footfall(shop_rows)
    transit_near = _transit(shop_rows)

    out: dict[str, list[dict]] = {}
    for i in pages:
        r = t.loc[i]
        a = acc.loc[r.siren] if r.siren in acc.index else None
        h = hyg.loc[r.siret] if r.siret in hyg.index else None
        street = _address(r)
        created = pd.to_datetime(r.created, errors="coerce")
        company_created = pd.to_datetime(r.company_created, errors="coerce")
        out.setdefault(r.home, []).append(
            {
                "id": bakery_id(r.siret),
                "kind": BAKERY_PAGE_KINDS[r.naf],
                "name": r["name"] if isinstance(r["name"], str) else None,
                "sole_trader": bool(r.sole_trader),
                "address": street or None,
                "cp": r.cp if isinstance(r.cp, str) else None,
                "lat": float(r.lat),
                "lon": float(r.lon),
                "created": created.strftime("%Y-%m") if pd.notna(created) else None,
                "company_created": None if pd.isna(company_created) else int(company_created.year),
                "legal": legal_label(r.legal_form),
                "seat": r.seat in (True, "true", "O"),
                "staff": STAFF.get(r.staff) if isinstance(r.staff, str) else None,
                "staff_year": int(r.staff_year) if pd.notna(pd.to_numeric(r.staff_year, errors="coerce")) else None,
                "network": int(network.get(r.siren, 1)),
                "accounts": None if a is None else {
                    "closed": a.closed,
                    "revenue": int(a.chiffre_d_affaires),
                    "net_income": None if pd.isna(a.resultat_net) else int(a.resultat_net),
                },
                "hyg": int(h.level) if h is not None else None,
                "hyg_date": h.date if h is not None else None,
                "near": [
                    {
                        "kind": BREAD_KINDS[t.at[j, "naf"]],
                        "name": t.at[j, "name"] if isinstance(t.at[j, "name"], str) else None,
                        "lat": float(t.at[j, "lat"]),
                        "lon": float(t.at[j, "lon"]),
                        "m": int(round(d, -1)),
                        "id": bakery_id(t.at[j, "siret"]) if t.at[j, "naf"] in BAKERY_PAGE_KINDS else None,
                        "home": t.at[j, "home"],
                    }
                    for j, d in near[i]
                ],
                "osm": osm.get(i),
                "access": access.get(i),
                "history": history.get(i, []),
                "footfall": footfall.get(i),
                "transit": transit_near.get(i),
            }
        )
    for lst in out.values():
        lst.sort(key=lambda b: (b["name"] is None, (b["name"] or "").lower(), b["id"]))
    return out
