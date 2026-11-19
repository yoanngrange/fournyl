import pytest

from pipeline import fetch


def test_optional_source_failure_does_not_stop_the_build(monkeypatch):
    sources = {"core": {"url": "x"}, "extra": {"url": "y", "optional": True}}
    monkeypatch.setattr(fetch, "SOURCES", sources)

    def fake(sid, refresh=False):
        if sid == "extra":
            raise ValueError("truncated parquet (no footer)")
        return {"file": "core.csv"}

    monkeypatch.setattr(fetch, "fetch", fake)
    assert set(fetch.fetch_all()) == {"core"}


def test_required_source_failure_stops_the_build(monkeypatch):
    monkeypatch.setattr(fetch, "SOURCES", {"core": {"url": "x"}})
    monkeypatch.setattr(fetch, "fetch", lambda sid, refresh=False: (_ for _ in ()).throw(ValueError("cut")))
    with pytest.raises(ValueError):
        fetch.fetch_all()
