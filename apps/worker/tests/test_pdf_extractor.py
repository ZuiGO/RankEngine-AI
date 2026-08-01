import pytest
import os
import unittest.mock as mock
from pdfExtractor import extract_pdf_content

def test_1_text_based_pdf_with_table(tmp_path):
    """
    Test 1: mock a text-based PDF with one table; assert both extractedText and
    extractedTables (matching the shared XLSX shape: {sheetName: "Table N", headers, rows})
    are populated correctly.
    """
    # Create raw PDF text stream containing structured text & tab/space separated grid table
    pdf_text_stream = (
        "RankEngine PDF Report Title\n\n"
        "Keyword\tVolume\tCPC\n"
        "seo audit\t12000\t$4.50\n"
        "rank tracker\t8500\t$3.20\n"
    )

    pdf_bytes = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n"
        b"4 0 obj\n<< /Length 200 >>\nstream\n"
        b"BT /F1 12 Tf 100 700 Td ("
        + pdf_text_stream.encode('latin-1')
        + b") Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n"
        b"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n300\n%%EOF"
    )

    res = extract_pdf_content(pdf_bytes, str(tmp_path))

    assert "RankEngine PDF Report Title" in res["extractedText"]
    assert res["isScannedOnly"] is False
    assert len(res["extractedTables"]) >= 1

    # Assert exact shared table shape matching XLSX format
    table = res["extractedTables"][0]
    assert "sheetName" in table
    assert table["sheetName"] == "Table 1"
    assert "headers" in table
    assert "rows" in table
    assert table["headers"] == ["Keyword", "Volume", "CPC"]
    assert table["rows"] == [["seo audit", "12000", "$4.50"], ["rank tracker", "8500", "$3.20"]]


def test_2_pdf_with_embedded_images(tmp_path):
    """
    Test 2: mock a PDF with 2 embedded images; assert both are extracted and stored,
    extractedImages has 2 entries.
    """
    pdf_bytes = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Img1 4 0 R /Img2 5 0 R >> >> >>\nendobj\n"
        b"4 0 obj\n<< /Type /XObject /Subtype /Image /Width 10 /Height 10 >>\nstream\nfakeimage1\nendstream\nendobj\n"
        b"5 0 obj\n<< /Type /XObject /Subtype /Image /Width 20 /Height 20 >>\nstream\nfakeimage2\nendstream\nendobj\n"
        b"trailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF"
    )

    res = extract_pdf_content(pdf_bytes, str(tmp_path))

    assert len(res["extractedImages"]) == 2
    for img_entry in res["extractedImages"]:
        assert "storagePath" in img_entry
        assert os.path.exists(img_entry["storagePath"])


def test_3_scanned_image_only_pdf_detected_as_distinct_case(tmp_path):
    """
    Test 3 (important): mock a scanned/image-only PDF (no text layer);
    assert this is detected distinctly (isScannedOnly is True), not treated as a normal empty-content success.
    """
    # PDF with 2 pages containing image objects but zero extractable text operators
    scanned_pdf_bytes = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Count 2 /Kids [3 0 R, 4 0 R] >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Scan1 5 0 R >> >> >>\nendobj\n"
        b"4 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Scan2 6 0 R >> >> >>\nendobj\n"
        b"5 0 obj\n<< /Type /XObject /Subtype /Image >>\nstream\nscannedpage1\nendstream\nendobj\n"
        b"6 0 obj\n<< /Type /XObject /Subtype /Image >>\nstream\nscannedpage2\nendstream\nendobj\n"
        b"trailer\n<< /Size 7 /Root 1 0 R >>\n%%EOF"
    )

    res = extract_pdf_content(scanned_pdf_bytes, str(tmp_path))

    # Assert distinct detection
    assert res["isScannedOnly"] is True
    assert res["pageCount"] >= 1
    assert res["wordCount"] < 10
