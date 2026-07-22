import os

os.environ["MONGODB_URI"] = "mongodb://localhost:27017/test_rankengine"
os.environ["REDIS_URL"] = "redis://localhost:6379"
os.environ["LLM_API_KEY"] = "mock-llm-api-key"
os.environ["PLAYWRIGHT_HEADLESS"] = "True"

import pytest
from unittest.mock import AsyncMock, patch
from crawler import (
    classify_lcp,
    classify_cls,
    classify_tbt,
    aggregate_severity,
    measure_core_web_vitals,
)




def make_mock_page(evaluate_return):
    page = AsyncMock()
    page.goto = AsyncMock()
    page.add_script_tag = AsyncMock()
    page.evaluate = AsyncMock(return_value=evaluate_return)
    page.close = AsyncMock()
    return page


def make_mock_browser(evaluate_return):
    page = make_mock_page(evaluate_return)
    context = AsyncMock()
    context.new_page = AsyncMock(return_value=page)
    context.close = AsyncMock()
    browser = AsyncMock()
    browser.new_context = AsyncMock(return_value=context)
    browser.close = AsyncMock()
    return browser, page


def make_mock_playwright(evaluate_return):
    browser, page = make_mock_browser(evaluate_return)
    pw = AsyncMock()
    pw.chromium.launch = AsyncMock(return_value=browser)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=pw)
    cm.__aexit__ = AsyncMock()
    return cm, page


# --- Pure function tests first ---

class TestClassifyLcp:
    def test_good(self):
        assert classify_lcp(1800) == "good"
        assert classify_lcp(2500) == "good"

    def test_needs_improvement(self):
        assert classify_lcp(2501) == "needs-improvement"
        assert classify_lcp(4000) == "needs-improvement"

    def test_poor(self):
        assert classify_lcp(4001) == "poor"
        assert classify_lcp(5000) == "poor"


class TestClassifyCls:
    def test_good(self):
        assert classify_cls(0.1) == "good"
        assert classify_cls(0.05) == "good"

    def test_needs_improvement(self):
        assert classify_cls(0.11) == "needs-improvement"
        assert classify_cls(0.25) == "needs-improvement"

    def test_poor(self):
        assert classify_cls(0.26) == "poor"
        assert classify_cls(0.5) == "poor"


class TestClassifyTbt:
    def test_good(self):
        assert classify_tbt(200) == "good"
        assert classify_tbt(50) == "good"

    def test_needs_improvement(self):
        assert classify_tbt(201) == "needs-improvement"
        assert classify_tbt(600) == "needs-improvement"

    def test_poor(self):
        assert classify_tbt(601) == "poor"
        assert classify_tbt(2000) == "poor"


class TestAggregateSeverity:
    def test_critical_when_majority_poor(self):
        assert aggregate_severity(["poor", "poor", "poor", "good", "good"]) == "critical"

    def test_warning_when_over_20_percent_poor_or_ni(self):
        assert aggregate_severity(["poor", "poor", "good", "good", "good"]) == "warning"
        assert aggregate_severity(["needs-improvement", "needs-improvement", "good", "good", "good"]) == "warning"

    def test_passed_when_under_threshold(self):
        assert aggregate_severity(["good", "good", "good", "good", "good"]) == "passed"

    def test_passed_on_empty(self):
        assert aggregate_severity([]) == "passed"


# --- Integration-style tests ---

@pytest.mark.asyncio
async def test_cwv_good_classification():
    mock_cm, mock_page = make_mock_playwright({"lcp": 1800, "cls": 0.05, "tbt": 100})

    crawled_pages = [
        {"url": "https://example.com/"},
        {"url": "https://example.com/about"},
        {"url": "https://example.com/contact"},
    ]

    with patch("crawler.async_playwright", return_value=mock_cm), \
         patch("crawler.db") as mock_db:

        mock_db.auditissues = AsyncMock()
        mock_db.auditissues.insert_many = AsyncMock()

        await measure_core_web_vitals(crawled_pages, "507f1f77bcf86cd799439011")

        inserted = mock_db.auditissues.insert_many.call_args[0][0]
        assert len(inserted) == 3  # LCP, CLS, TBT

        for issue in inserted:
            assert issue["severity"] == "passed"

        lcp_issue = inserted[0]
        assert lcp_issue["description"].startswith("LCP (Largest Contentful Paint)")
        assert all(d["rating"] == "good" for d in lcp_issue["details"])

        cls_issue = inserted[1]
        assert cls_issue["description"].startswith("CLS (Cumulative Layout Shift)")
        assert all(d["rating"] == "good" for d in cls_issue["details"])

        tbt_issue = inserted[2]
        assert tbt_issue["description"].startswith("TBT (proxy for INP — real INP requires field data)")
        assert all(d["rating"] == "good" for d in tbt_issue["details"])


@pytest.mark.asyncio
async def test_cwv_poor_lcp_yields_critical_severity():
    mock_cm, mock_page = make_mock_playwright({"lcp": 5000, "cls": 0.05, "tbt": 100})

    crawled_pages = [
        {"url": "https://example.com/"},
        {"url": "https://example.com/about"},
        {"url": "https://example.com/contact"},
        {"url": "https://example.com/blog"},
        {"url": "https://example.com/faq"},
    ]

    with patch("crawler.async_playwright", return_value=mock_cm), \
         patch("crawler.db") as mock_db:

        mock_db.auditissues = AsyncMock()
        mock_db.auditissues.insert_many = AsyncMock()

        await measure_core_web_vitals(crawled_pages, "507f1f77bcf86cd799439011")

        inserted = mock_db.auditissues.insert_many.call_args[0][0]
        lcp_issue = inserted[0]

        assert lcp_issue["severity"] == "critical"
        assert all(d["rating"] == "poor" for d in lcp_issue["details"])
        assert len(lcp_issue["details"]) == 5


@pytest.mark.asyncio
async def test_sampling_30_pages_selects_20_and_includes_homepage():
    crawled_pages = [
        {"url": f"https://example.com/page{i}"} for i in range(30)
    ]

    mock_cm, mock_page = make_mock_playwright({"lcp": 1000, "cls": 0.05, "tbt": 50})

    with patch("crawler.async_playwright", return_value=mock_cm), \
         patch("crawler.db") as mock_db:

        mock_db.auditissues = AsyncMock()
        mock_db.auditissues.insert_many = AsyncMock()

        await measure_core_web_vitals(crawled_pages, "507f1f77bcf86cd799439011")

        assert mock_page.evaluate.call_count == 20

        first_url = mock_page.goto.call_args_list[0][0][0]
        assert first_url == "https://example.com/page0"


@pytest.mark.asyncio
async def test_sampling_10_pages_measures_all():
    crawled_pages = [
        {"url": f"https://example.com/page{i}"} for i in range(10)
    ]

    mock_cm, mock_page = make_mock_playwright({"lcp": 1000, "cls": 0.05, "tbt": 50})

    with patch("crawler.async_playwright", return_value=mock_cm), \
         patch("crawler.db") as mock_db:

        mock_db.auditissues = AsyncMock()
        mock_db.auditissues.insert_many = AsyncMock()

        await measure_core_web_vitals(crawled_pages, "507f1f77bcf86cd799439011")

        assert mock_page.evaluate.call_count == 10
