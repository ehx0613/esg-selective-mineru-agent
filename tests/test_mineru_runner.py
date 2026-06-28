import fitz

from esg_selective_mineru.mineru_runner import _create_page_subset_pdf


def test_create_page_subset_pdf_keeps_only_selected_pages(tmp_path):
    source_path = tmp_path / "source.pdf"
    doc = fitz.open()
    try:
        for page_number in range(1, 6):
            page = doc.new_page()
            page.insert_text((72, 72), f"page {page_number}")
        doc.save(source_path)
    finally:
        doc.close()

    subset_path = _create_page_subset_pdf(source_path, [2, 4], tmp_path)

    subset = fitz.open(subset_path)
    try:
        assert len(subset) == 2
        assert "page 2" in subset[0].get_text()
        assert "page 4" in subset[1].get_text()
    finally:
        subset.close()
