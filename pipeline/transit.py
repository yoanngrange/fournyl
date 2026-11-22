"""Public transport stops and the lines that serve them, from every GTFS feed listed on transport.data.gouv.fr.

The ~480 feeds weigh ~1.7 GB: they are downloaded to a temporary folder, reduced to one small table
(one row per stop and line) and deleted, so only that table reaches pipeline/raw (and the CI cache).

Rows: mode (train, metro, tram, bus), network (agency name), line (short name, else long name),
stop (stop or parent-station name), lat, lon. Metropolitan France and Corsica only.
"""

import io
import json
import re
import shutil
import tempfile
import time
import unicodedata
import urllib.request
import zipfile
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path

import pandas as pd

from pipeline.config import TRANSIT_CATALOGUE, TRANSIT_EXCLUDE

UA = {"User-Agent": "fournyl-pipeline"}
BBOX = (41.2, 51.2, -5.3, 9.7)  # lat min, lat max, lon min, lon max: metropolitan France and Corsica

# GTFS route_type (basic and extended) -> mode shown on bakery pages; anything else (ferry, cable car…) is dropped.
MODES = {0: "tram", 900: "tram", 901: "tram", 902: "tram", 1: "metro", 400: "metro", 401: "metro", 2: "train", 3: "bus", 11: "bus", 800: "bus"}
MODES |= {k: "train" for k in range(100, 118)} | {k: "bus" for k in range(200, 210)} | {k: "bus" for k in range(700, 717)}
del MODES[712], MODES[713]  # school buses: not for a bakery's customers
SCHOOL = r"\bSCO\b|scolaire|\bscol"  # school lines published as ordinary buses (name or operator)


def feeds() -> list[dict]:
    """Latest available GTFS file of every public-transit dataset, minus the excluded kinds (TAD, ferries…)."""
    with urllib.request.urlopen(urllib.request.Request(TRANSIT_CATALOGUE, headers=UA), timeout=120) as r:
        datasets = json.load(r)
    out = []
    for d in datasets:
        if d.get("type") != "public-transit" or re.search(TRANSIT_EXCLUDE, d["title"], re.I):
            continue
        gtfs = [r for r in d.get("resources", []) if r.get("format") == "GTFS" and r.get("is_available")]
        if gtfs:
            r = max(gtfs, key=lambda r: r.get("updated") or "")
            out.append({"id": d["id"], "title": d["title"], "url": r["url"], "updated": (r.get("updated") or "")[:10]})
    return out


def _get(feed: dict, folder: Path) -> Path | None:
    target = folder / f"{feed['id']}.zip"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(feed["url"], headers=UA), timeout=600) as r, open(target, "wb") as f:
                shutil.copyfileobj(r, f)
            if zipfile.is_zipfile(target):
                return target
        except OSError:
            pass
        time.sleep(5 * (attempt + 1))
    return None


def _member(z: zipfile.ZipFile, name: str) -> str | None:
    """Path of a GTFS table in the archive (some feeds put the files in a sub-folder)."""
    return next((n for n in z.namelist() if n.split("/")[-1] == name), None)


def _clean(c: str) -> str:
    return c.strip().lstrip("\ufeff")  # headers may carry spaces or a byte-order mark


def _csv(z: zipfile.ZipFile, name: str, cols: list[str]) -> pd.DataFrame | None:
    """One GTFS table with the wanted columns (missing optional ones are empty), or None if the table is absent."""
    member = _member(z, name)
    if member is None:
        return None
    with z.open(member) as f:
        df = pd.read_csv(f, dtype=str, usecols=lambda c: _clean(c) in cols, encoding_errors="replace",
                         on_bad_lines="skip", skipinitialspace=True)
    df.columns = [_clean(c) for c in df.columns]
    return df.reindex(columns=cols)


def norm(s: str) -> str:
    """Key used to merge the same network or line published in two feeds (a regional aggregate and the local one)."""
    s = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def reduce_feed(path: Path, title: str) -> pd.DataFrame | None:
    """One feed -> (mode, network, line, stop, lat, lon) rows; None if the feed has no fixed stops (on-demand zones)."""
    try:
        z = zipfile.ZipFile(path)
        stops = _csv(z, "stops.txt", ["stop_id", "stop_name", "stop_lat", "stop_lon", "parent_station"])
        routes = _csv(z, "routes.txt", ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"])
        trips = _csv(z, "trips.txt", ["trip_id", "route_id"])
        agency = _csv(z, "agency.txt", ["agency_id", "agency_name"])
        member = _member(z, "stop_times.txt")
        if stops is None or routes is None or trips is None or member is None:
            return None
        pairs = []
        with z.open(member) as f:
            for ch in pd.read_csv(f, dtype=str, chunksize=2_000_000, encoding_errors="replace", on_bad_lines="skip",
                                  usecols=lambda c: _clean(c) in ("trip_id", "stop_id")):
                ch.columns = [_clean(c) for c in ch.columns]
                if not {"trip_id", "stop_id"} <= set(ch.columns):
                    return None
                pairs.append(ch.drop_duplicates())
        st = pd.concat(pairs).drop_duplicates().merge(trips, on="trip_id")[["stop_id", "route_id"]].drop_duplicates()
        routes["mode"] = pd.to_numeric(routes.route_type, errors="coerce").map(MODES)
        st = st.merge(routes[routes["mode"].notna()], on="route_id").merge(stops, on="stop_id")
    except (zipfile.BadZipFile, KeyError, ValueError, pd.errors.ParserError, UnicodeDecodeError, EOFError):
        return None
    if st.empty:
        return None
    # Network: the agency of the route; a feed with one agency and no agency_id on its routes uses that one.
    names = agency.dropna(subset=["agency_name"]) if agency is not None else pd.DataFrame(columns=["agency_id", "agency_name"])
    by_id = dict(zip(names.agency_id.fillna(""), names.agency_name.str.strip()))
    single = names.agency_name.iloc[0].strip() if len(names) == 1 else None
    operator = st.agency_id.fillna("").map(by_id).fillna(single or "")
    st["network"] = operator.replace("", title)
    # The dataset title is not used here: "Réseau urbain et scolaire TBM" also runs ordinary lines.
    school = (st.route_long_name.fillna("") + " " + st.route_short_name.fillna("") + " " + operator).str.contains(SCHOOL, case=False)
    st = st[~school].copy()
    st["line"] = st.route_short_name.fillna("").str.strip()
    st.loc[st.line == "", "line"] = st.route_long_name.fillna("").str.strip().str[:60]
    # Stations are named after their parent (a platform is "Ancenis quai 2").
    parent = dict(zip(stops.stop_id, stops.stop_name))
    st["stop"] = st.parent_station.map(parent).fillna(st.stop_name).fillna("").str.strip()
    st["lat"] = pd.to_numeric(st.stop_lat, errors="coerce").round(5)
    st["lon"] = pd.to_numeric(st.stop_lon, errors="coerce").round(5)
    st = st[st.lat.between(BBOX[0], BBOX[1]) & st.lon.between(BBOX[2], BBOX[3]) & (st.line != "")]
    return st[["mode", "network", "line", "stop", "lat", "lon"]].drop_duplicates()


def _reduce(args):
    return reduce_feed(*args)


def download(target: Path) -> dict:
    """Build the stops table at `target` (parquet); returns counts for the build log."""
    listed = feeds()
    print(f"  {len(listed)} GTFS feeds listed on transport.data.gouv.fr", flush=True)
    with tempfile.TemporaryDirectory(prefix="gtfs-") as tmp:
        folder = Path(tmp)
        with ThreadPoolExecutor(12) as ex:
            paths = list(ex.map(lambda f: _get(f, folder), listed))
        jobs = [(p, f["title"]) for p, f in zip(paths, listed) if p is not None]
        jobs.sort(key=lambda j: j[0].stat().st_size, reverse=True)  # big feeds first: better use of the workers
        with ProcessPoolExecutor(4) as ex:
            parts = [df for df in ex.map(_reduce, jobs) if df is not None]
    if not parts:
        raise RuntimeError("no usable GTFS feed")
    rows = pd.concat(parts, ignore_index=True)
    # The same line in two feeds (regional aggregate + local network) counts once.
    rows["k"] = rows["mode"] + "|" + rows.network.map(norm) + "|" + rows.line.map(norm)
    rows = rows.drop_duplicates(subset=["k", "lat", "lon"]).drop(columns="k")
    rows.to_parquet(target, index=False)
    stats = {"listed": len(listed), "downloaded": len(jobs), "usable": len(parts), "rows": len(rows)}
    print(f"    {stats}", flush=True)
    return stats
