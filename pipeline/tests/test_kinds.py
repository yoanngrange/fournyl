import pandas as pd

from pipeline.build_local import effective_naf


def test_trades_register_corrects_insee_kind():
    """A shop filed by Insee as bread retail or bake-off but registered as a bakery by the chambre de métiers is a bakery."""
    naf = pd.Series(["47.24Z", "47.24Z", "10.71B", "47.24Z", "10.71C", "10.71C"])
    aprm = pd.Series(["1071CB", "1071DZ", "1071CA", None, "5610CQ", "1071DZ"])
    assert effective_naf(naf, aprm).tolist() == ["10.71C", "10.71D", "10.71C", "47.24Z", "10.71C", "10.71C"]
