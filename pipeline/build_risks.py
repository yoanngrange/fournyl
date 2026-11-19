"""Natural risks and climate exposure per commune (GASPAR, Géorisques).

- Known risks: the risks listed for the commune in the departmental file of major risks (DDRM), top level only.
- Natural disaster declarations (arrêtés CatNat) since 1982, by kind, in total and over the last 10 years: how
  often floods, droughts (clay shrink-swell) or storms have actually hit the commune. Our measure of climate
  exposure; it says nothing about one building.
"""

import zipfile

import pandas as pd

from pipeline import cog, fetch

# CatNat kinds (num_risque_jo) grouped for display.
CATNAT = {
    "flood": ["ICB", "IRN", "COB", "LVT"],  # inondations, coulées de boue, remontées de nappe
    "drought": ["SEC"],  # sécheresse : retrait-gonflement des argiles
    "ground": ["MVT", "GLT", "EFA", "ECB", "GET", "GER", "AVA"],  # mouvements de terrain, éboulements, avalanches
    "storm": ["TMP", "GRL", "PDN", "VCY"],  # tempêtes, grêle, poids de la neige, vents cycloniques
    "sea": ["CMV", "RAZ"],  # vagues, raz de marée
    "quake": ["SEI", "VOL"],
}
RECENT_YEARS = 10


def _member(z: zipfile.ZipFile, prefix: str):
    return z.open(next(n for n in z.namelist() if n.startswith(prefix)))


def risks(codes: set[str]) -> dict:
    """{code: {"known": [labels], "catnat": {"since", "total", "recent", "by_kind": {kind: n}}}}."""
    mapping = cog.code_mapping()
    with zipfile.ZipFile(fetch.path("gaspar")) as z:
        c = pd.read_csv(_member(z, "catnat_gaspar"), sep=";", dtype=str, usecols=["code_commune", "num_risque_jo", "date_debut"])
        d = pd.read_csv(_member(z, "ddrm_risq_gaspar"), sep=";", dtype=str, usecols=["cod_commune", "lib_risque", "num_risque"])

    c["code"] = c.code_commune.map(lambda x: mapping.get(x, x))
    c = c[c.code.isin(codes)].drop_duplicates()
    c["year"] = pd.to_datetime(c.date_debut, errors="coerce").dt.year
    kind_of = {code: kind for kind, lst in CATNAT.items() for code in lst}
    c["kind"] = c.num_risque_jo.map(kind_of).fillna("other")
    since = int(c.year.min()) if len(c) else 1982
    recent_from = pd.Timestamp.now().year - RECENT_YEARS

    d["code"] = d.cod_commune.map(lambda x: mapping.get(x, x))
    d["num_risque"] = d.num_risque.str.strip()
    d = d[d.code.isin(codes) & (d.num_risque.str.len() == 2)]  # top-level risks (11 inondation, 13 mouvement…)

    out = {}
    for code in codes:
        cc = c[c.code == code]
        known = sorted(set(d.lib_risque[d.code == code]))
        out[code] = {
            "known": known,
            "catnat": {
                "since": since,
                "total": int(len(cc)),
                "recent": int((cc.year >= recent_from).sum()),
                "recent_from": recent_from,
                "by_kind": {k: int(n) for k, n in cc.kind.value_counts().items()},
            },
        }
    return out
