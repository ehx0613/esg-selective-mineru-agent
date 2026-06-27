from esg_selective_mineru.chunks import _words_to_visual_lines


def test_words_to_visual_lines_sorts_by_visual_position():
    words = [
        (300, 10, 330, 20, "2021", 0, 0, 2),
        (400, 10, 430, 20, "2022", 0, 0, 3),
        (200, 10, 230, 20, "2020", 0, 0, 1),
        (10, 10, 90, 20, "指标名称", 0, 0, 0),
        (10, 30, 110, 40, "年度培训总时长", 0, 1, 0),
        (200, 30, 260, 40, "35,000", 0, 1, 1),
        (300, 30, 360, 40, "36,500", 0, 1, 2),
        (400, 30, 460, 40, "38,700", 0, 1, 3),
    ]

    text = _words_to_visual_lines(words)

    assert "指标名称 2020 2021 2022" in text
    assert "年度培训总时长 35,000 36,500 38,700" in text
