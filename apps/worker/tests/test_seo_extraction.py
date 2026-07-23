import pytest
from crawler import extract_seo_data

def test_seo_extraction_clean_page():
    html = """<!DOCTYPE html>
    <html lang="en">
    <head>
        <title>Clean Page Title</title>
        <meta name="description" content="This is a clean page meta description for testing SEO extraction.">
        <link rel="canonical" href="https://example.com/clean-page" />
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": "Clean Page Headline"
        }
        </script>
    </head>
    <body>
        <h1>Single Clean H1 Title</h1>
        <h2>Section Subhead 1</h2>
        <p>This is a paragraph with several visible words for testing word count calculation.</p>
        <h2>Section Subhead 2</h2>
        <img src="/img1.png" alt="Valid alt text 1" />
        <img src="/img2.png" alt="Valid alt text 2" />
        <a href="/internal-link">Internal Page</a>
        <a href="https://external.org/page">External Site</a>
    </body>
    </html>
    """
    url = "https://example.com/clean-page"
    data = extract_seo_data(html, url, status_code=200, target_hostname="example.com")

    assert data["url"] == url
    assert data["path"] == "/clean-page"
    assert data["title"] == "Clean Page Title"
    assert data["metaDescription"] == "This is a clean page meta description for testing SEO extraction."
    assert data["h1Text"] == ["Single Clean H1 Title"]
    assert len(data["h1Text"]) == 1
    assert data["h2Count"] == 2
    assert data["wordCount"] > 0
    assert data["imageCount"] == 2
    assert data["imagesWithAlt"] == 2
    assert data["imagesMissingAlt"] == 0
    assert data["internalLinkCount"] == 1
    assert data["externalLinkCount"] == 1
    assert data["hasStructuredData"] is True
    assert data["structuredDataTypes"] == ["Article"]
    assert data["canonicalUrl"] == "https://example.com/clean-page"
    assert data["isIndexable"] is True

def test_seo_extraction_missing_title_desc_multiple_h1():
    html = """<!DOCTYPE html>
    <html>
    <head></head>
    <body>
        <h1>First H1 Headline</h1>
        <h1>Second H1 Headline (Duplicate)</h1>
        <p>Page content without title tag or meta description.</p>
    </body>
    </html>
    """
    url = "https://example.com/no-title"
    data = extract_seo_data(html, url, status_code=200, target_hostname="example.com")

    assert data["title"] is None
    assert data["metaDescription"] is None
    assert len(data["h1Text"]) == 2
    assert data["h1Text"] == ["First H1 Headline", "Second H1 Headline (Duplicate)"]
    assert data["isIndexable"] is True

def test_seo_extraction_malformed_json_ld():
    html = """<!DOCTYPE html>
    <html>
    <head>
        <title>Malformed JSON-LD Test</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "WebPage",
          BROKEN JSON SYNTAX HERE WITHOUT QUOTES OR COMMAS
        }
        </script>
    </head>
    <body>
        <h1>Malformed JSON-LD Page</h1>
    </body>
    </html>
    """
    url = "https://example.com/malformed-jsonld"
    data = extract_seo_data(html, url, status_code=200, target_hostname="example.com")

    assert data["hasStructuredData"] is False
    assert data["structuredDataTypes"] == []

def test_seo_extraction_x_robots_tag_noindex():
    html = """<!DOCTYPE html>
    <html>
    <head>
        <title>X-Robots-Tag Test</title>
    </head>
    <body>
        <h1>Noindex via Header</h1>
    </body>
    </html>
    """
    url = "https://example.com/noindex-header"
    data = extract_seo_data(html, url, status_code=200, x_robots_tag="noindex, nofollow", target_hostname="example.com")

    assert data["isIndexable"] is False
