import os

os.environ["MONGODB_URI"] = "mongodb://localhost:27017/test_rankengine"
os.environ["REDIS_URL"] = "redis://localhost:6379"
os.environ["LLM_API_KEY"] = "mock-llm-api-key"
os.environ["PLAYWRIGHT_HEADLESS"] = "True"

import pytest
from crawler import extract_outbound_links


class TestExtractOutboundLinks:
    def test_internal_links_only(self):
        html = """
        <html>
        <body>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
            <a href="/blog/post-1">Blog Post</a>
            <a href="https://external.com">External</a>
            <a href="https://another-external.org">Another External</a>
        </body>
        </html>
        """
        base_url = "https://example.com"
        target_hostname = "example.com"

        links = extract_outbound_links(html, base_url, target_hostname)

        assert len(links) == 3
        assert "https://example.com/about" in links
        assert "https://example.com/contact" in links
        assert "https://example.com/blog/post-1" in links
        assert "https://external.com" not in links
        assert "https://another-external.org" not in links
