import pytest
from content_extractor import detect_page_contents

def test_1_detection_pdf_video_images_text():
    """
    Test 1: mock a page with 1 PDF link, 1 embedded YouTube video, 2 images (one missing alt text);
    assert 4 PageContent-equivalent records are created with correct contentType values:
    1 'text', 1 'pdf', 1 'video', 2 'image' records (total 5 items: text + pdf + video + 2 images).
    """
    html = """
    <!DOCTYPE html>
    <html>
      <head><title>Test Page</title></head>
      <body>
        <h1>Content Detection Test Page</h1>
        <p>This is test content paragraph for SEO detection.</p>
        <a href="/downloads/whitepaper.pdf">Download PDF Report</a>
        <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
        <img src="/images/hero.jpg" alt="Hero Header Graphic" />
        <img src="/images/icon.png" />
      </body>
    </html>
    """

    page_url = "https://example.com/test-page"
    project_id = "507f1f77bcf86cd799439011"
    crawl_job_id = "507f1f77bcf86cd799439012"

    records = detect_page_contents(page_url, html, project_id, crawl_job_id)

    # Assert record count and type distributions
    types = [r['contentType'] for r in records]
    assert 'text' in types
    assert 'pdf' in types
    assert 'video' in types
    assert 'image' in types

    assert types.count('text') == 1
    assert types.count('pdf') == 1
    assert types.count('video') == 1
    assert types.count('image') == 2
    assert len(records) == 5

    # Verify fields on generated records
    for r in records:
        assert r['pageUrl'] == page_url
        assert r['extractionStatus'] == 'pending'
        assert r['sourceUrl'] is not None

    # Assert image altText captured correctly
    img_records = [r for r in records if r['contentType'] == 'image']
    alt_map = {r['sourceUrl']: r.get('altText') for r in img_records}
    assert alt_map['https://example.com/images/hero.jpg'] == 'Hero Header Graphic'
    assert alt_map['https://example.com/images/icon.png'] is None

    # Assert video source URL captured correctly
    video_record = next(r for r in records if r['contentType'] == 'video')
    assert video_record['sourceUrl'] == 'https://www.youtube.com/embed/dQw4w9WgXcQ'

    # Assert PDF source URL captured correctly
    pdf_record = next(r for r in records if r['contentType'] == 'pdf')
    assert pdf_record['sourceUrl'] == 'https://example.com/downloads/whitepaper.pdf'


def test_2_detection_text_only_no_false_positives():
    """
    Test 2: mock a page with no linked files, only text and no images;
    assert only a 'text' record is created, no false positives.
    """
    html = """
    <!DOCTYPE html>
    <html>
      <head><title>Simple Text Page</title></head>
      <body>
        <h1>Simple Text Title</h1>
        <p>This page contains only standard text paragraphs and regular internal links.</p>
        <a href="/about-us">About Us</a>
        <a href="/contact">Contact</a>
      </body>
    </html>
    """

    page_url = "https://example.com/simple-page"
    project_id = "507f1f77bcf86cd799439011"
    crawl_job_id = "507f1f77bcf86cd799439012"

    records = detect_page_contents(page_url, html, project_id, crawl_job_id)

    # Assert only 1 record created for 'text'
    assert len(records) == 1
    assert records[0]['contentType'] == 'text'
    assert records[0]['sourceUrl'] == page_url
    assert records[0]['extractionStatus'] == 'pending'
