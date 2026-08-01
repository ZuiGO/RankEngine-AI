import pytest
import io
import zipfile
import xml.etree.ElementTree as ET
from content_extractor import (
    inventory_content,
    extract_pdf_structured_data,
    extract_docx_text,
    extract_xlsx_data,
    extract_pptx_text,
)
from content_auditor import audit_content_inventory

def test_inventory_content_parses_text_images_videos_documents():
    html = """
    <html>
        <body>
            <h1>Main SEO Title</h1>
            <p>Welcome to our comprehensive SEO audit platform. We analyze websites efficiently.</p>
            <img src="/logo.png" alt="Company Logo" />
            <img src="/banner.jpg" />
            <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
            <a href="/report.pdf">Download Annual Report PDF</a>
            <a href="/data.xlsx">Download Financial Spreadsheet</a>
            <a href="/presentation.pptx">Download Slides</a>
            <a href="/doc.docx">Download Guide</a>
        </body>
    </html>
    """
    inv = inventory_content("https://example.com/page", html)

    assert inv['text']['hasH1'] is True
    assert inv['text']['h1Count'] == 1
    assert inv['imageCount'] == 2

    # Verify images
    imgs = inv['images']
    assert len(imgs) == 2
    assert imgs[0]['alt'] == 'Company Logo'
    assert imgs[0]['missingAlt'] is False
    assert imgs[1]['missingAlt'] is True

    # Verify video iframe
    vids = inv['videos']
    assert len(vids) == 1
    assert vids[0]['type'] == 'youtube'

    # Verify documents
    docs = inv['documents']
    assert len(docs) == 4
    doc_types = {d['type'] for d in docs}
    assert doc_types == {'pdf', 'xlsx', 'pptx', 'docx'}

def test_extract_docx_text():
    # Build minimal docx zip buffer in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('word/document.xml', """
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body>
                <w:p><w:t>Hello World Document</w:t></w:p>
            </w:body>
        </w:document>
        """)
        z.writestr('docProps/core.xml', """
        <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>Test Guide Title</dc:title>
        </cp:coreProperties>
        """)
    docx_bytes = buf.getvalue()

    res = extract_docx_text(docx_bytes)
    assert res['title'] == 'Test Guide Title'
    assert res['hasTitle'] is True
    assert 'Hello World Document' in res['text']

def test_extract_xlsx_data():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('xl/workbook.xml', """
        <workbook xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <sheets><sheet name="Sheet1"/><sheet name="Financials"/></sheets>
        </workbook>
        """)
        z.writestr('xl/sharedStrings.xml', """
        <sst xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <si><t>Revenue</t></si><si><t>Expenses</t></si>
        </sst>
        """)
    xlsx_bytes = buf.getvalue()

    res = extract_xlsx_data(xlsx_bytes)
    assert res['sheetNames'] == ['Sheet1', 'Financials']
    assert 'Revenue' in res['text']

def test_extract_pptx_text():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('ppt/slides/slide1.xml', """
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <a:t>Slide 1 Heading</a:t>
        </p:sld>
        """)
    pptx_bytes = buf.getvalue()

    res = extract_pptx_text(pptx_bytes)
    assert res['slideCount'] == 1
    assert 'Slide 1 Heading' in res['text']

def test_audit_content_inventory_generates_issues():
    inv = {
        'pageUrl': 'https://example.com/test',
        'text': {'wordCount': 100, 'hasH1': False, 'h1Count': 0},
        'images': [{'src': 'https://example.com/img1.png', 'missingAlt': True}],
        'videos': [{'type': 'vimeo', 'src': 'https://vimeo.com/12345', 'hasTranscript': False}],
        'documents': [
            {
                'url': 'https://example.com/file.pdf',
                'type': 'pdf',
                'fileSize': 12 * 1024 * 1024,
                'extracted': {'hasTitle': False, 'isScannedOnly': False}
            }
        ]
    }

    issues = audit_content_inventory(inv, '507f1f77bcf86cd799439011')
    categories = {i['category'] for i in issues}

    assert 'content-quality' in categories
    assert 'heading-structure' in categories
    assert 'image-alt' in categories
    assert 'video-transcript' in categories
    assert 'pdf-metadata' in categories
    assert 'pdf-performance' in categories
