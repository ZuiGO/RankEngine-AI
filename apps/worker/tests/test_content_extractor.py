import pytest
import io
import zipfile
import unittest.mock as mock
from contentExtractor import (
    process_page_content_record,
    extract_docx_content,
    extract_xlsx_content,
    extract_pptx_content,
)
from content_extractor import inventory_content, extract_pdf_structured_data
from content_auditor import audit_content_inventory

@pytest.mark.asyncio
async def test_1_mock_docx_download_extraction_success(tmp_path):
    """
    Test 1: mock a DOCX download; assert extractedText is populated and extractionStatus becomes 'success'.
    """
    # Create valid in-memory DOCX zip buffer
    docx_buf = io.BytesIO()
    with zipfile.ZipFile(docx_buf, 'w') as z:
        z.writestr('word/document.xml', """
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body>
                <w:p><w:t>RankEngine DOCX Content Test</w:t></w:p>
            </w:body>
        </w:document>
        """)
    docx_bytes = docx_buf.getvalue()

    record = {
        "pageUrl": "https://example.com/page",
        "sourceUrl": "https://example.com/guide.docx",
        "contentType": "docx",
        "extractionStatus": "pending"
    }

    # Mock download_content_file to return our in-memory buffer and a fake storage path
    fake_download = {
        "storagePath": str(tmp_path / "123_guide.docx"),
        "buffer": docx_bytes,
        "fileSize": len(docx_bytes)
    }

    with mock.patch("contentExtractor.download_content_file", mock.AsyncMock(return_value=fake_download)):
        result = await process_page_content_record(record, str(tmp_path))

    assert result["extractionStatus"] == "success"
    assert "RankEngine DOCX Content Test" in result["extractedText"]
    assert result["storagePath"] == str(tmp_path / "123_guide.docx")
    assert result["extractionError"] is None

@pytest.mark.asyncio
async def test_2_mock_xlsx_two_sheets_structured_tables(tmp_path):
    """
    Test 2: mock an XLSX with 2 sheets; assert extractedTables has 2 entries with correct headers/rows.
    """
    xlsx_buf = io.BytesIO()
    with zipfile.ZipFile(xlsx_buf, 'w') as z:
        z.writestr('xl/workbook.xml', """
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <sheets>
                <sheet name="Overview" sheetId="1"/>
                <sheet name="Metrics" sheetId="2"/>
            </sheets>
        </workbook>
        """)
        z.writestr('xl/sharedStrings.xml', """
        <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <si><t>Domain</t></si><si><t>Score</t></si><si><t>acme.com</t></si><si><t>95</t></si>
            <si><t>Metric</t></si><si><t>Value</t></si><si><t>LCP</t></si><si><t>1.2s</t></si>
        </sst>
        """)
        # Sheet 1 XML
        z.writestr('xl/worksheets/sheet1.xml', """
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <sheetData>
                <row r="1"><c r="A1"><v>0</v></c><c r="B1"><v>1</v></c></row>
                <row r="2"><c r="A2"><v>2</v></c><c r="B2"><v>3</v></c></row>
            </sheetData>
        </worksheet>
        """)
        # Sheet 2 XML
        z.writestr('xl/worksheets/sheet2.xml', """
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <sheetData>
                <row r="1"><c r="A1"><v>4</v></c><c r="B1"><v>5</v></c></row>
                <row r="2"><c r="A2"><v>6</v></c><c r="B2"><v>7</v></c></row>
            </sheetData>
        </worksheet>
        """)
    xlsx_bytes = xlsx_buf.getvalue()

    record = {
        "pageUrl": "https://example.com/page",
        "sourceUrl": "https://example.com/data.xlsx",
        "contentType": "xlsx",
        "extractionStatus": "pending"
    }

    fake_download = {
        "storagePath": str(tmp_path / "456_data.xlsx"),
        "buffer": xlsx_bytes,
        "fileSize": len(xlsx_bytes)
    }

    with mock.patch("contentExtractor.download_content_file", mock.AsyncMock(return_value=fake_download)):
        result = await process_page_content_record(record, str(tmp_path))

    assert result["extractionStatus"] == "success"
    assert len(result["extractedTables"]) == 2

    # Assert Sheet 1 details
    sheet1 = result["extractedTables"][0]
    assert sheet1["sheetName"] == "Overview"
    assert sheet1["headers"] == ["Domain", "Score"]
    assert sheet1["rows"] == [["acme.com", "95"]]

    # Assert Sheet 2 details
    sheet2 = result["extractedTables"][1]
    assert sheet2["sheetName"] == "Metrics"
    assert sheet2["headers"] == ["Metric", "Value"]
    assert sheet2["rows"] == [["LCP", "1.2s"]]

@pytest.mark.asyncio
async def test_3_mock_download_network_failure_sets_failed_status(tmp_path):
    """
    Test 3: mock a download failure (network error); assert extractionStatus becomes 'failed'
    with a real error message, not silently retried forever or left pending.
    """
    record = {
        "pageUrl": "https://example.com/page",
        "sourceUrl": "https://example.com/broken-link.pdf",
        "contentType": "pdf",
        "extractionStatus": "pending"
    }

    error_msg = "Download error: HTTP download failed with status 500"
    with mock.patch("contentExtractor.download_content_file", mock.AsyncMock(side_effect=Exception("HTTP download failed with status 500"))):
        result = await process_page_content_record(record, str(tmp_path))

    assert result["extractionStatus"] == "failed"
    assert result["extractionError"] is not None
    assert "HTTP download failed with status 500" in result["extractionError"]

@pytest.mark.asyncio
async def test_4_image_record_marked_success_without_download(tmp_path):
    """
    Test 4: an 'image' type record; assert it's marked 'success' immediately without attempting a download.
    """
    record = {
        "pageUrl": "https://example.com/page",
        "sourceUrl": "https://example.com/logo.png",
        "contentType": "image",
        "altText": "Company Logo",
        "extractionStatus": "pending"
    }

    mock_download = mock.AsyncMock()
    with mock.patch("contentExtractor.download_content_file", mock_download):
        result = await process_page_content_record(record, str(tmp_path))

    # Assert no download attempted
    mock_download.assert_not_called()
    assert result["extractionStatus"] == "success"
    assert result["extractionError"] is None

# Additional helper tests
def test_inventory_content_parses_text_images_videos_documents():
    html = "<html><body><h1>SEO Title</h1><img src='/logo.png' alt='Logo'/><a href='/doc.pdf'>PDF</a></body></html>"
    inv = inventory_content("https://example.com", html)
    assert inv['text']['hasH1'] is True
    assert inv['imageCount'] == 1
    assert inv['documentCount'] == 1

def test_audit_content_inventory_generates_issues():
    inv = {
        'pageUrl': 'https://example.com/test',
        'text': {'wordCount': 50, 'hasH1': False, 'h1Count': 0},
        'images': [{'src': 'https://example.com/img1.png', 'missingAlt': True}],
        'videos': [],
        'documents': []
    }
    issues = audit_content_inventory(inv, '507f1f77bcf86cd799439011')
    assert len(issues) >= 2
