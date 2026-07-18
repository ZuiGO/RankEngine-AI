import os

# Set dummy env vars for import validation
os.environ["MONGODB_URI"] = "mongodb://localhost:27017/test_rankengine"
os.environ["REDIS_URL"] = "redis://localhost:6379"
os.environ["LLM_API_KEY"] = "mock-key"
os.environ["PLAYWRIGHT_HEADLESS"] = "True"

import pytest
from schema_validator import validate_json_ld

def test_valid_faqpage_schema():
    html = """
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "mainEntity": [{
            "@type": "Question",
            "name": "What is RankEngine?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "An advanced AI-powered technical SEO platform."
            }
          }]
        }
        </script>
      </head>
      <body>
        <h1>FAQ Page</h1>
      </body>
    </html>
    """
    issues = validate_json_ld(html, "https://site.com/faq", "507f1f77bcf86cd799439011")
    assert len(issues) == 1
    assert issues[0]["severity"] == "passed"
    assert issues[0]["description"] == "Page has valid FAQPage structured data"

def test_faqpage_missing_accepted_answer():
    html = """
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "mainEntity": [{
            "@type": "Question",
            "name": "What is RankEngine?"
          }]
        }
        </script>
      </head>
      <body>
        <h1>FAQ Page</h1>
      </body>
    </html>
    """
    issues = validate_json_ld(html, "https://site.com/faq", "507f1f77bcf86cd799439011")
    # Missing acceptedAnswer should trigger a critical issue
    assert len(issues) == 1
    assert issues[0]["severity"] == "critical"
    assert issues[0]["category"] == "schema"
    assert "missing the 'acceptedAnswer' property" in issues[0]["description"]

def test_page_with_faq_heading_but_no_schema():
    html = """
    <html>
      <body>
        <h2>Frequently Asked Questions</h2>
        <p>Some content describing search engine rank tracking.</p>
      </body>
    </html>
    """
    issues = validate_json_ld(html, "https://site.com/faq", "507f1f77bcf86cd799439011")
    # Missing recommended schema but containing keyword heading should trigger a warning
    assert len(issues) == 1
    assert issues[0]["severity"] == "warning"
    assert issues[0]["category"] == "schema"
    assert "Missed AI Overview eligibility opportunity" in issues[0]["description"]
