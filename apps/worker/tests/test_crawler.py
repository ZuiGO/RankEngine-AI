import os

# Synchronously set mock environment variables at the top of test suite to pass Pydantic validation checks
os.environ["MONGODB_URI"] = "mongodb://localhost:27017/test_rankengine"
os.environ["REDIS_URL"] = "redis://localhost:6379"
os.environ["LLM_API_KEY"] = "mock-llm-api-key"
os.environ["PLAYWRIGHT_HEADLESS"] = "True"

import pytest
import asyncio
from unittest.mock import AsyncMock, patch
from crawler import crawl_page_with_retry, identify_raw_seo_issues

# Mark all test cases in this file as async
pytestmark = pytest.mark.asyncio

async def test_retry_on_429_status():
    # Attempt 1: returns HTTP 429
    response_429 = AsyncMock()
    response_429.status = 429

    # Attempt 2: returns HTTP 200 (Success)
    response_200 = AsyncMock()
    response_200.status = 200

    page = AsyncMock()
    # Mock goto to return 429 then 200
    page.goto = AsyncMock(side_effect=[response_429, response_200])
    page.content = AsyncMock(return_value="<html><title>SEO Home</title><body>Sample content here</body></html>")
    page.close = AsyncMock()

    context = AsyncMock()
    context.new_page = AsyncMock(return_value=page)
    context.close = AsyncMock()

    browser = AsyncMock()
    browser.new_context = AsyncMock(return_value=context)

    # Patch asyncio.sleep to run instantly during test execution
    with patch("asyncio.sleep", AsyncMock()) as mock_sleep:
        result = await crawl_page_with_retry(browser, "https://test-site.com", "job-123")

        # Verify page successfully resolved on retry
        assert result is not None
        assert result["statusCode"] == 200
        assert result["metaTitle"] == "SEO Home"
        
        # Verify page.goto was called exactly twice (attempt 0, then retry 1)
        assert page.goto.call_count == 2
        
        # Verify exponential backoff sleep was called once with 2^0 = 1 second delay
        mock_sleep.assert_called_once_with(1)

async def test_retry_on_captcha_detection():
    # Mocks for browser, page, and context
    response_200 = AsyncMock()
    response_200.status = 200

    page = AsyncMock()
    page.goto = AsyncMock(return_value=response_200)
    # Attempt 1: returns page with Cloudflare CAPTCHA keywords
    # Attempt 2: returns normal page content
    page.content = AsyncMock(side_effect=[
        "<html><body>cloudflare challenge verify you are human to proceed</body></html>",
        "<html><title>Successful Page</title><body>Success</body></html>"
    ])
    page.close = AsyncMock()

    context = AsyncMock()
    context.new_page = AsyncMock(return_value=page)
    context.close = AsyncMock()

    browser = AsyncMock()
    browser.new_context = AsyncMock(return_value=context)

    # Patch asyncio.sleep to bypass waiting delay
    with patch("asyncio.sleep", AsyncMock()) as mock_sleep:
        result = await crawl_page_with_retry(browser, "https://test-site.com", "job-123")

        # Verify result parses correctly on second try
        assert result is not None
        assert result["statusCode"] == 200
        assert result["metaTitle"] == "Successful Page"

        # Verify page.goto was called twice due to CAPTCHA retry trigger
        assert page.goto.call_count == 2

        # Verify backoff sleep was called once for 1 second
        mock_sleep.assert_called_once_with(1)

async def test_exceed_max_retries():
    # Setup response that always returns 429
    response_429 = AsyncMock()
    response_429.status = 429

    page = AsyncMock()
    page.goto = AsyncMock(return_value=response_429)
    page.content = AsyncMock(return_value="<html><body>429 Too Many Requests</body></html>")
    page.close = AsyncMock()

    context = AsyncMock()
    context.new_page = AsyncMock(return_value=page)
    context.close = AsyncMock()

    browser = AsyncMock()
    browser.new_context = AsyncMock(return_value=context)

    # Patch asyncio.sleep to run fast
    with patch("asyncio.sleep", AsyncMock()) as mock_sleep:
        result = await crawl_page_with_retry(browser, "https://test-site.com", "job-123")

        # After exceeding max 3 retries (total 4 attempts), it returns status 500 error placeholder
        assert result is not None
        assert result["statusCode"] == 500
        assert "Crawl failed after" in result["metaDescription"]

        # page.goto called 4 times (attempt 0, retries 1, 2, 3)
        assert page.goto.call_count == 4

        # Backoff sleep called for attempts 1, 2, 3: delays 2^0=1s, 2^1=2s, 2^2=4s
        assert mock_sleep.call_count == 3
        mock_sleep.assert_any_call(1)
        mock_sleep.assert_any_call(2)
        mock_sleep.assert_any_call(4)


async def test_clean_page_emits_passed_seo_checks():
    issues = identify_raw_seo_issues(
        [
            {
                "url": "https://test-site.com/",
                "statusCode": 200,
                "metaTitle": "Test Site",
                "metaDescription": "A concise description of the test site.",
                "h1": ["Welcome"],
            }
        ],
        "507f1f77bcf86cd799439011",
    )

    assert [issue["severity"] for issue in issues] == ["passed", "passed", "passed"]
