import pandas as pd

from pipeline.build_local import SOLE_TRADER, legal_codes


def test_sole_trader_code_matches_parquet_integers():
    """The Parquet stock stores legal forms as integers: a sole trader must still be recognised (privacy)."""
    codes = legal_codes(pd.Series([1000, 5710, None]))
    assert list(codes == SOLE_TRADER) == [True, False, False]
