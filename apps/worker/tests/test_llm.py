import os

# Synchronously set mock environment variables at the top of test suite to pass Pydantic validation checks
os.environ["MONGODB_URI"] = "mongodb://localhost:27017/test_rankengine"
os.environ["REDIS_URL"] = "redis://localhost:6379"
os.environ["LLM_API_KEY"] = "mock-groq-api-key"
os.environ["PLAYWRIGHT_HEADLESS"] = "True"

import pytest
import json
from unittest.mock import AsyncMock, patch, MagicMock
from llm import generate_fix_list, summarize_issues


def test_summarize_issues_keeps_passed_summary_as_positive_confirmation():
    summary = summarize_issues([
        {
            "category": "meta",
            "severity": "passed",
            "url": "N/A",
            "description": "4850 of 5000 crawled pages have a meta title present and well-formed",
        }
    ])

    assert "[PASSED] Category: meta | Positive confirmation:" in summary
    assert "Affected URLs" not in summary

@pytest.mark.asyncio
async def test_llm_fix_list_successful_generation():
    # Successful Groq JSON response structure
    valid_json = {
        "items": [
            {
                "title": "Fix 3 redirect loops on staging server",
                "category": "redirect",
                "severity": "critical",
                "affectedUrls": ["https://staging.com/about", "https://staging.com/contact"],
                "recommendation": "Correct routing setup",
                "whyItMatters": "Redirect loops confuse search engine crawlers and may prevent your pages from being indexed at all"
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
            {"category": "redirect", "severity": "critical", "url": "https://staging.com/contact", "description": "Redirect loop"}
        ]
        
        issues, count = await generate_fix_list("507f1f77bcf86cd799439011", raw_issues)
        
        # Verify Groq chat completion endpoint was requested once
        assert mock_client.chat.completions.create.call_count == 1
        
        # Verify old issues are deleted and new ones inserted (one per affected URL)
        assert mock_auditissues.delete_many.call_count == 1
        assert mock_auditissues.insert_many.call_count == 1
        inserted_list = mock_auditissues.insert_many.call_args[0][0]
        assert len(inserted_list) == 2
        assert inserted_list[0]["description"] == "Fix 3 redirect loops on staging server"
        assert inserted_list[0]["severity"] == "critical"
        assert inserted_list[0]["whyItMatters"] == "Redirect loops confuse search engine crawlers and may prevent your pages from being indexed at all"
        assert count == 2

@pytest.mark.asyncio
async def test_llm_fix_list_retry_mechanism():
    # Attempt 1: returns invalid content (missing bracket)
    # Attempt 2: returns valid JSON after stricter retry instruction
    invalid_content = "Here is your output: {\"items\": ["
    
    valid_json = {
        "items": [
            {
                "title": "Fix missing meta tags",
                "category": "meta",
                "severity": "warning",
                "affectedUrls": ["https://staging.com/home"],
                "recommendation": "Update tags",
                "whyItMatters": "Missing meta tags reduce your click-through rate from search results"
            }
        ]
    }
    
    mock_choice_1 = MagicMock()
    mock_choice_1.message.content = invalid_content
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
        
        raw_issues = [{"category": "meta", "severity": "warning", "url": "https://staging.com/home", "description": "Empty title"}]
        
        issues, count = await generate_fix_list("507f1f77bcf86cd799439011", raw_issues)
        
        # Verify it triggered retry (call count is 2)
        assert mock_client.chat.completions.create.call_count == 2
        
        # Verify insertion was successful on the second attempt
        assert mock_auditissues.insert_many.call_count == 1
        inserted = mock_auditissues.insert_many.call_args[0][0]
        assert len(inserted) == 1
        assert inserted[0]["description"] == "Fix missing meta tags"
        assert inserted[0]["severity"] == "warning"
        assert count == 1

@pytest.mark.asyncio
async def test_llm_fix_list_fallback_on_consecutive_failures():
    # Both attempts return invalid output
    mock_choice = MagicMock()
    mock_choice.message.content = "Prose text response that cannot be parsed as JSON."
    mock_completion = MagicMock()
    mock_completion.choices = [mock_choice]
    
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_completion)
    
    mock_auditissues = AsyncMock()
    
    with patch("llm.AsyncGroq", return_value=mock_client), \
         patch("llm.db") as mock_db:
         
        mock_db.auditissues = mock_auditissues
        
        raw_issues = [{"category": "meta", "severity": "warning", "url": "https://staging.com/home", "description": "Empty title"}]
        
        issues, count = await generate_fix_list("507f1f77bcf86cd799439011", raw_issues)
        
        # Verify 2 calls executed
        assert mock_client.chat.completions.create.call_count == 2
        
        # Verify fallback is triggered and database inserts are bypassed
        assert mock_auditissues.delete_many.call_count == 0
        assert mock_auditissues.insert_many.call_count == 0
        assert count == 0
