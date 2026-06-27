from esg_selective_mineru.extractor import _align_result_to_target_year
from esg_selective_mineru.quality import validate_and_score_result


FIELD = {
    "field_key": "employee_training_hours",
    "name_cn": "\u5458\u5de5\u57f9\u8bad\u5c0f\u65f6",
    "indicator_type": "quantitative",
    "aliases": ["\u57f9\u8bad\u603b\u65f6\u957f", "\u5e74\u5ea6\u57f9\u8bad\u603b\u65f6\u957f"],
}


def _result(value: str = "36500"):
    return {
        "field_key": "employee_training_hours",
        "matched": True,
        "value": value,
        "unit": "\u5c0f\u65f6",
        "year": "2022",
        "evidence": "\u5e74\u5ea6\u57f9\u8bad\u603b\u65f6\u957f\n\u5c0f\u65f6\n35,000\n36,500\n38,700",
        "source_chunk_id": "c1",
        "reason": "",
    }


def test_align_result_to_target_year_from_horizontal_table():
    contexts = {
        "employee_training_hours": [
            {
                "chunk_id": "c1",
                "text": "\u6307\u6807 \u5355\u4f4d 2020 2021 2022\n\u5e74\u5ea6\u57f9\u8bad\u603b\u65f6\u957f \u5c0f\u65f6 35,000 36,500 38,700",
            }
        ]
    }

    aligned = _align_result_to_target_year(_result(), FIELD, contexts, "2022")

    assert aligned["value"] == "38700"
    assert aligned["year"] == "2022"
    assert "2022" in aligned["evidence"]
    assert "year_aligned_from_table" in aligned["reason"]


def test_align_result_to_target_year_from_wrapped_table_header():
    contexts = {
        "employee_training_hours": [
            {
                "chunk_id": "c1",
                "text": "2020 \u5e74\n2021 \u5e74\n2022 \u5e74\n\u5e74\u5ea6\u57f9\u8bad\u603b\u65f6\u957f\n\u5c0f\u65f6\n35,000\n36,500\n38,700",
            }
        ]
    }

    aligned = _align_result_to_target_year(_result(), FIELD, contexts, "2022")

    assert aligned["value"] == "38700"
    assert aligned["year"] == "2022"
    assert "2022" in aligned["evidence"]
    assert "year_aligned_from_table" in aligned["reason"]


def test_align_result_corrects_non_monotonic_pdf_year_order():
    contexts = {
        "employee_training_hours": [
            {
                "chunk_id": "c1",
                "text": "\u6307\u6807\u540d\u79f0\n\u5355\u4f4d\n2021 \u5e74\n2022 \u5e74\n2020 \u5e74\n\u5e74\u5ea6\u57f9\u8bad\u603b\u65f6\u957f\n\u5c0f\u65f6\n35,000\n36,500\n38,700",
            }
        ]
    }

    aligned = _align_result_to_target_year(_result(), FIELD, contexts, "2022")

    assert aligned["value"] == "38700"
    assert aligned["year"] == "2022"
    assert "2021" in aligned["evidence"]
    assert "2022" in aligned["evidence"]
    assert "year_aligned_from_table" in aligned["reason"]


def test_align_result_ignores_numbers_before_current_field_and_dedupes_years():
    contexts = {
        "employee_training_hours": [
            {
                "chunk_id": "c1",
                "text": (
                    "2020 2020 2021 2021 2022 2022 "
                    "\u517c\u804c\u5458\u5de5\u4eba\u6570 \u4eba 0 0 0 "
                    "\u5e74\u5ea6\u57f9\u8bad\u603b\u65f6\u957f \u5c0f\u65f6 35,000 36,500 38,700 "
                    "\u4e2d\u56fd\u5927\u9646\u5458\u5de5\u4eba\u6570 \u4eba 7,981 8,049 8,276"
                ),
            }
        ]
    }

    aligned = _align_result_to_target_year(_result(), FIELD, contexts, "2022")

    assert aligned["value"] == "38700"
    assert aligned["year"] == "2022"
    assert "year_aligned_from_table" in aligned["reason"]


def test_quantitative_result_warns_when_target_year_missing_from_evidence():
    row = {
        "field_key": "employee_training_hours",
        "name_cn": "\u5458\u5de5\u57f9\u8bad\u5c0f\u65f6",
        "category": "S",
        "indicator_type": "quantitative",
        "matched": True,
        "value": "36500",
        "unit": "\u5c0f\u65f6",
        "year": "2022",
        "evidence": "\u5e74\u5ea6\u57f9\u8bad\u603b\u65f6\u957f \u5c0f\u65f6 35,000 36,500 38,700",
        "source_page": 34,
        "confidence": 0.95,
    }

    checked = validate_and_score_result(row, target_year="2022")

    assert "target_year_not_in_evidence" in checked["quality_warnings"]
    assert "ambiguous_multi_number_evidence_without_target_year" in checked["quality_warnings"]
    assert "weak_evidence" in checked["quality_warnings"]
    assert checked["confidence"] == 0.45
