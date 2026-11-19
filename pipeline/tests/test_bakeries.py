import pandas as pd

from pipeline.build_bakeries import _address, _nice, legal_label
from pipeline.build_local import SOLE_TRADER, bakery_id, legal_codes


def test_sole_trader_code_matches_parquet_integers():
    """The Parquet stock stores legal forms as integers: a sole trader must still be recognised (privacy)."""
    codes = legal_codes(pd.Series([1000, 5710, None]))
    assert list(codes == SOLE_TRADER) == [True, False, False]


def test_bakery_id_is_stable_and_hides_the_siret():
    siret = "50873093400025"
    assert bakery_id(siret) == bakery_id(siret) and len(bakery_id(siret)) == 10 and siret not in bakery_id(siret)


def test_labels_and_address():
    assert legal_label("1000") == "Entreprise individuelle" and legal_label("5499") == "SARL" and legal_label("5720") == "SASU"
    assert _nice("AVENUE DU GENERAL DE GAULLE") == "Avenue du General de Gaulle"
    row = pd.Series({"num": "12", "rep": "B", "street_type": "RUE", "street": "DE LA GARE"})
    assert _address(row) == "12 bis rue de la Gare"
