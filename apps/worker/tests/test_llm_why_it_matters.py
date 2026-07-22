import os

os.environ["MONGODB_URI"] = "mongodb://localhost:27017/test_rankengine"
os.environ["REDIS_URL"] = "redis://localhost:6379"
os.environ["LLM_API_KEY"] = "mock-groq-api-key"
os.environ["PLAYWRIGHT_HEADLESS"] = "True"

import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch
from llm import generate_fix_list

pytestmark = pytest.mark.asyncio


async def test_all_items_have_why_it_matters():
    """Test that every parsed checklist item includes a non-empty whyItMatters field."""
    valid_json = {
        "items": [
            {
                "title": "Fix redirect loop on staging server",
                "category": "redirect",
                "severity": "critical",
                "affectedUrls": ["https://staging.com/about"],
                "recommendation": "Update the redirect chain in .htaccess to point directly to the final URL",
                "whyItMatters": "Redirect loops confuse search engine crawlers and may prevent your pages from being indexed at all"
            },
            {
                "title": "Add meta description to contact page",
                "category": "meta",
                "severity": "warning",
                "affectedUrls": ["https://staging.com/contact"],
                "recommendation": "Write a unique 150-160 character meta description summarising the page content",
                "whyItMatters": "Missing meta descriptions reduce click-through rates from search results because users see no context"
            },
            {
                "title": "All pages have valid meta titles",
                "category": "meta",
                "severity": "passed",
                "affectedUrls": ["N/A"],
                "recommendation": "No action needed",
                "whyItMatters": "Clear meta titles help both users and search engines quickly understand what each page is about"
            }
        ]
    }

    mock_choice = MagicMock()
    mock_choice.message.content = json.dumps(valid_json)
    mock_completion = MagicMock()
    mock_completion.choices = [mock_choice]

    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_completion)
    mock_auditissues = AsyncMock()

    with patch("llm.AsyncGroq", return_value=mock_client), \
         patch("llm.db") as mock_db:
        mock_db.auditissues = mock_auditissues

        raw_issues = [
            {"category": "redirect", "severity": "critical", "url": "https://staging.com/about", "description": "Redirect loop"},
            {"category": "meta", "severity": "warning", "url": "https://staging.com/contact", "description": "Missing description"},
            {"category": "meta", "severity": "passed", "url": "N/A", "description": "All pages have valid meta titles"},
        ]

        issues, count = await generate_fix_list("507f1f77bcf86cd799439011", raw_issues)

        assert mock_client.chat.completions.create.call_count == 1

        # Every returned issue (from the parsed response) must have non-empty whyItMatters
        inserted_list = mock_auditissues.insert_many.call_args[0][0]
        assert len(inserted_list) > 0
        for doc in inserted_list:
            wim = doc.get("whyItMatters", "")
            assert wim and wim.strip(), f"Document missing whyItMatters: {doc.get('description')}"
        assert count == len(inserted_list)


async def test_retry_when_why_it_matters_missing():
    """When the LLM omits whyItMatters on one item, Pydantic ValidationError fires and triggers the existing retry-once logic."""
    # Attempt 1: valid JSON but one item missing whyItMatters (triggers ValidationError)
    invalid_json = {
        "items": [
            {
                "title": "Fix redirect loop",
                "category": "redirect",
                "severity": "critical",
                "affectedUrls": ["https://staging.com/about"],
                "recommendation": "Fix the chain",
            }
        ]
    }

    # Attempt 2: fully valid JSON
    valid_json = {
        "items": [
            {
                "title": "Fix redirect loop",
                "category": "redirect",
                "severity": "critical",
                "affectedUrls": ["https://staging.com/about"],
                "recommendation": "Fix the chain",
                "whyItMatters": "Redirect loops confuse search engine crawlers and may prevent your pages from being indexed at all"
            }
        ]
    }

    mock_choice_1 = MagicMock()
    mock_choice_1.message.content = json.dumps(invalid_json)
    mock_completion_1 = MagicMock()
    mock_completion_1.choices = [mock_choice_1]

    mock_choice_2 = MagicMock()
    mock_choice_2.message.content = json.dumps(valid_json)
    mock_completion_2 = MagicMock()
    mock_completion_2.choices = [mock_choice_2]

    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=[mock_completion_1, mock_completion_2])
    mock_auditissues = AsyncMock()

    with patch("llm.AsyncGroq", return_value=mock_client), \
         patch("llm.db") as mock_db:
        mock_db.auditissues = mock_auditissues

        raw_issues = [{"category": "redirect", "severity": "critical", "url": "https://staging.com/about", "description": "Redirect loop"}]

        issues, count = await generate_fix_list("507f1f77bcf86cd799439011", raw_issues)

        # Retry should have been triggered — Groq called exactly twice
        assert mock_client.chat.completions.create.call_count == 2

        # Second attempt succeeded → insertion happened
        assert mock_auditissues.insert_many.call_count == 1
        inserted = mock_auditissues.insert_many.call_args[0][0]
        assert len(inserted) == 1
        assert inserted[0]["description"] == "Fix redirect loop"
        assert inserted[0]["whyItMatters"] == "Redirect loops confuse search engine crawlers and may prevent your pages from being indexed at all"
        assert count == 1
