"""One record per bakery and pastry shop (SIRENE 10.71C and 10.71D), for its own page (docs/SPEC.md §3.7).

Only establishments released publicly in SIRENE. Privacy (CLAUDE.md):
- the SIRET never leaves the pipeline: pages use a stable short id derived from it (`bakery_id`);
- a sole trader (entreprise individuelle) is a person: never named (shop sign or usual name only);
- nothing about directors (no name, no age, no "likely to sell").
Every page is indexed by search engines. Published accounts (INPI ratios) are shown whenever filed as public.
"""

import math

import numpy as np
import pandas as pd
import pyarrow.compute as pc
import pyarrow.parquet as pq

from pipeline import cog, fetch
from pipeline.build_local import BREAD_KINDS, bakery_id, hygiene, legal_codes
from pipeline.config import BAKERY_NEAR_M, BAKERY_NEAR_MAX, BAKERY_PAGE_KINDS

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
            }
        )
    for lst in out.values():
        lst.sort(key=lambda b: (b["name"] is None, (b["name"] or "").lower(), b["id"]))
    return out
