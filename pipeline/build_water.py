"""Tap water hardness per commune, from the ARS sanitary control of distributed water (data.gouv.fr).

The archive holds three files for one year: samples (DIS_PLV, one per sample and water network),
results (DIS_RESULT, one per sample and parameter) and the networks serving each commune (DIS_COM_UDI).
Hardness = titre hydrotimétrique (TH) in degrés français (°f).

Per network: median of the year's samples. Per commune: median of the networks that serve it, with the
lowest and highest network so the page can say when hardness differs between parts of the commune.
"""

import zipfile

import pandas as pd

from pipeline import cog, fetch
from pipeline.config import WATER_CLASSES, WATER_PARAM, WATER_YEAR


def hardness_class(th: float) -> str:
    return next(name for bound, name in WATER_CLASSES if th < bound)


def _member(z: zipfile.ZipFile, prefix: str):
    return z.open(next(n for n in z.namelist() if n.startswith(prefix)))


def hardness(codes: set[str]) -> dict:
    """{code: {"th", "min", "max", "networks", "class"}} for communes with at least one measure."""
    with zipfile.ZipFile(fetch.path("eau_potable")) as z:
        chunks = pd.read_csv(
            _member(z, "DIS_RESULT_"),
            dtype=str,
            usecols=["referenceprel", "cdparametresiseeaux", "valtraduite"],
            chunksize=2_000_000,
        )
        res = pd.concat(c[c.cdparametresiseeaux == WATER_PARAM] for c in chunks)
        samples = pd.read_csv(_member(z, "DIS_PLV_"), dtype=str, usecols=["referenceprel", "cdreseau"])
        served = pd.read_csv(_member(z, "DIS_COM_UDI_"), dtype=str, usecols=["inseecommune", "cdreseau"])

    res["th"] = pd.to_numeric(res.valtraduite, errors="coerce")
    # A sample is listed once per upstream network feeding it: keep one row per sample and network.
    samples = samples.drop_duplicates()
    per_network = res.dropna(subset=["th"]).merge(samples, on="referenceprel").groupby("cdreseau").th.median()

    mapping = cog.code_mapping()  # merged communes -> current commune
    served["code"] = served.inseecommune.map(lambda c: mapping.get(c, c))
    served = served[served.code.isin(codes)].drop_duplicates(["code", "cdreseau"])
    c = served.merge(per_network.rename("th"), left_on="cdreseau", right_index=True)
    agg = c.groupby("code").th.agg(["median", "min", "max", "count"])
    return {
        code: {
            "year": WATER_YEAR,
            "th": round(float(r["median"]), 1),
            "min": round(float(r["min"]), 1),
            "max": round(float(r["max"]), 1),
            "networks": int(r["count"]),
            "class": hardness_class(r["median"]),
        }
        for code, r in agg.iterrows()
    }
