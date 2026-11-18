from pipeline.build_water import hardness_class


def test_hardness_classes():
    assert hardness_class(0) == "very_soft"
    assert hardness_class(6.9) == "very_soft"
    assert hardness_class(7) == "soft"
    assert hardness_class(16.2) == "medium"
    assert hardness_class(25) == "hard"
    assert hardness_class(35) == "very_hard"
    assert hardness_class(120) == "very_hard"
