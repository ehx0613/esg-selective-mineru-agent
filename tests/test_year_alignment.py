from esg_selective_mineru.extractor import _align_result_to_target_year
from esg_selective_mineru.quality import validate_and_score_result


def test_align_result_to_target_year_from_horizontal_table():
    field = {
        "field_key": "employee_training_hours",
        "name_cn": "员工培训小时",
        "indicator_type": "quantitative",
        "aliases": ["培训总时长", "年度培训总时长"],
    }
    result = {
        "field_key": "employee_training_hours",
        "matched": True,
        "value": "36500",
        "unit": "小时",
        "year": "2022",
        "evidence": "年度培训总时长 小时 35,000 36,500 38,700",
        "source_chunk_id": "c1",
        "reason": "",
    }
    contexts = {
        "employee_training_hours": [
            {
                "chunk_id": "c1",
                "text": "指标 单位 2020 2021 2022\n年度培训总时长 小时 35,000 36,500 38,700",
            }
        ]
    }

    aligned = _align_result_to_target_year(result, field, contexts, "2022")

    assert aligned["value"] == "38700"
    assert aligned["year"] == "2022"
    assert "2022" in aligned["evidence"]
    assert "year_aligned_from_table" in aligned["reason"]


def test_quantitative_result_warns_when_target_year_missing_from_evidence():
    row = {
        "field_key": "employee_training_hours",
        "name_cn": "员工培训小时",
        "category": "S",
        "indicator_type": "quantitative",
        "matched": True,
        "value": "36500",
        "unit": "小时",
        "year": "2022",
        "evidence": "年度培训总时长 小时 35,000 36,500 38,700",
        "source_page": 34,
        "confidence": 0.95,
    }

    checked = validate_and_score_result(row, target_year="2022")

    assert "target_year_not_in_evidence" in checked["quality_warnings"]
