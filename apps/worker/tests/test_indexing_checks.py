import os

os.environ["MONGODB_URI"] = "mongodb://localhost:27017/test_rankengine"
os.environ["REDIS_URL"] = "redis://localhost:6379"
os.environ["LLM_API_KEY"] = "mock-llm-api-key"
os.environ["PLAYWRIGHT_HEADLESS"] = "True"

import pytest
from unittest.mock import MagicMock
from urllib.robotparser import RobotFileParser
from crawler import identify_indexing_issues, is_path_excluded, EXCLUSION_PATTERNS


# --- Pure function tests ---

class TestIsPathExcluded:
    def test_excluded_paths_are_detected(self):
        for path in ["/admin", "/admin/dashboard", "/wp-admin", "/login", "/staging/foo", "/test", "/internal/bar"]:
            assert is_path_excluded(path), f"{path} should be excluded"

    def test_normal_paths_not_excluded(self):
        assert not is_path_excluded("/blog/post-1")
        assert not is_path_excluded("/products")
        assert not is_path_excluded("/about")
        assert not is_path_excluded("/")


def make_robots_parser(allowed_urls: set, disallowed_urls: set):
    """Create a RobotFileParser that allows/disallows specific URLs."""
    parser = RobotFileParser()
    lines = ["User-agent: *"]
    for url in disallowed_urls:
        lines.append(f"Disallow: {url}")
    for url in allowed_urls:
        lines.append(f"Allow: {url}")
    parser.parse(lines)
    return parser


# --- Integration tests ---

class TestIdentifyIndexingIssues:
    def test_meta_noindex_flagged_critical(self):
        crawled_pages = [
            {
                "url": "https://example.com/blog/post-1",
                "meta_noindex": True,
                "x_robots_tag": "",
                "canonical": "https://example.com/blog/post-1",
            },
            {
                "url": "https://example.com/about",
                "meta_noindex": False,
                "x_robots_tag": "",
                "canonical": "https://example.com/about",
            },
        ]
        robots_parser = make_robots_parser(set(), set())

        issues = identify_indexing_issues(crawled_pages, "507f1f77bcf86cd799439011", robots_parser)

        critical_issues = [i for i in issues if i["severity"] == "critical"]
        assert len(critical_issues) == 1
        assert critical_issues[0]["category"] == "indexing"

        urls = [d["url"] for d in critical_issues[0]["details"]]
        assert "https://example.com/blog/post-1" in urls
        assert "https://example.com/about" not in urls

    def test_excluded_path_not_flagged_even_with_noindex(self):
        crawled_pages = [
            {
                "url": "https://example.com/admin/dashboard",
                "meta_noindex": True,
                "x_robots_tag": "",
                "canonical": "https://example.com/admin/dashboard",
            },
        ]
        robots_parser = make_robots_parser(set(), set())

        issues = identify_indexing_issues(crawled_pages, "507f1f77bcf86cd799439011", robots_parser)

        critical_issues = [i for i in issues if i["severity"] == "critical"]
        assert len(critical_issues) == 0

    def test_canonical_mismatch_flagged_critical(self):
        crawled_pages = [
            {
                "url": "https://example.com/blog/post-1",
                "meta_noindex": False,
                "x_robots_tag": "",
                "canonical": "https://example.com/different-page",
            },
        ]
        robots_parser = make_robots_parser(set(), set())

        issues = identify_indexing_issues(crawled_pages, "507f1f77bcf86cd799439011", robots_parser)

        critical_issues = [i for i in issues if i["severity"] == "critical"]
        assert len(critical_issues) == 1

        assert critical_issues[0]["details"][0]["canonical_mismatch"] is True
        assert critical_issues[0]["details"][0]["url"] == "https://example.com/blog/post-1"

    def test_robots_txt_blocked_only_no_critical_or_warning(self):
        crawled_pages = [
            {
                "url": "https://example.com/internal/docs",
                "meta_noindex": False,
                "x_robots_tag": "",
                "canonical": "https://example.com/internal/docs",
            },
        ]
        robots_parser = make_robots_parser(set(), {"/internal/"})

        issues = identify_indexing_issues(crawled_pages, "507f1f77bcf86cd799439011", robots_parser)

        severities = {i["severity"] for i in issues}
        assert "critical" not in severities
        assert "warning" not in severities

        # robots blocked page should appear under a "passed" issue
        passed_issues = [i for i in issues if i["severity"] == "passed"]
        assert len(passed_issues) >= 1
        details = passed_issues[0]["details"]
        assert details[0]["robots_txt_blocked"] is True
