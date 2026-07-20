import os

# Set mock env vars before importing the module under test
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/test_rankengine")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("LLM_API_KEY", "mock-groq-api-key")
os.environ.setdefault("SERP_API_KEY", "mock-serp-api-key")
os.environ.setdefault("OPENAI_API_KEY", "mock-openai-key")
os.environ.setdefault("GEMINI_API_KEY", "mock-gemini-key")
os.environ.setdefault("PERPLEXITY_API_KEY", "mock-perplexity-key")

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import Response as HttpxResponse

from ai_visibility_checker import (
    _substring_match,
    _groq_classifier,
    check_google_aio,
    check_chatgpt,
    check_gemini,
    check_perplexity,
    run_visibility_check,
)

pytestmark = pytest.mark.asyncio


# ─── Substring match ─────────────────────────────────────────────────────────

class TestSubstringMatch:
    def test_exact_match(self):
        assert _substring_match("Best SEO tools for rankengine", "rankengine") is True

    def test_case_insensitive(self):
        assert _substring_match("Try RankEngine AI today", "rankengine") is True

    def test_no_match(self):
        assert _substring_match("No brand mentioned here", "rankengine") is False


# ─── Groq classifier fallback ───────────────────────────────────────────────

class TestGroqClassifier:
    async def test_returns_true_when_groq_says_yes(self):
        mock_choice = MagicMock()
        mock_choice.message.content = "yes"
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_completion)

        with patch("ai_visibility_checker.AsyncGroq", return_value=mock_client):
            result = await _groq_classifier("Some text about AcmeTool", "acmetool")
            assert result is True

    async def test_returns_false_when_groq_says_no(self):
        mock_choice = MagicMock()
        mock_choice.message.content = "no"
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_completion)

        with patch("ai_visibility_checker.AsyncGroq", return_value=mock_client):
            result = await _groq_classifier("Some text about something else", "acmetool")
            assert result is False

    async def test_returns_false_on_groq_exception(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API down"))

        with patch("ai_visibility_checker.AsyncGroq", return_value=mock_client):
            result = await _groq_classifier("Some text", "brand")
            assert result is False


# ─── google_aio check ───────────────────────────────────────────────────────

class TestGoogleAio:
    async def test_mentioned_when_brand_in_ai_overview(self):
        mock_response = MagicMock(spec=HttpxResponse)
        mock_response.json.return_value = {
            "ai_overview": {
                "text": "Many users recommend RankEngine for SEO automation."
            }
        }

        with patch("ai_visibility_checker.fetch_with_retry", AsyncMock(return_value=mock_response)):
            mentioned, ctx = await check_google_aio("best seo tool", "rankengine")
            assert mentioned is True
            assert "RankEngine" in ctx

    async def test_not_mentioned_when_no_ai_overview(self):
        mock_response = MagicMock(spec=HttpxResponse)
        mock_response.json.return_value = {"organic_results": [{"title": "some result"}]}

        with patch("ai_visibility_checker.fetch_with_retry", AsyncMock(return_value=mock_response)):
            mentioned, ctx = await check_google_aio("some query", "brand")
            assert mentioned is False
            assert ctx == ""

    async def test_not_mentioned_when_brand_absent_from_overview(self):
        mock_response = MagicMock(spec=HttpxResponse)
        mock_response.json.return_value = {
            "ai_overview": {"text": "The best tool is something else entirely."}
        }

        with patch("ai_visibility_checker.fetch_with_retry", AsyncMock(return_value=mock_response)):
            mentioned, ctx = await check_google_aio("best tool", "rankengine")
            assert mentioned is False
            assert "something else" in ctx

    async def test_skipped_when_no_api_key(self):
        with patch("ai_visibility_checker.settings", SERP_API_KEY=""):
            mentioned, ctx = await check_google_aio("query", "brand")
            assert mentioned is False
            assert ctx == ""


# ─── chatgpt check ──────────────────────────────────────────────────────────

class TestChatgpt:
    async def test_substring_match_detects_brand(self):
        """Brand appears directly in ChatGPT's response — no Groq fallback needed."""
        mock_response = MagicMock(spec=HttpxResponse)
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "You should try RankEngine for SEO."}}]
        }

        with patch("ai_visibility_checker.fetch_with_retry", AsyncMock(return_value=mock_response)):
            mentioned, ctx = await check_chatgpt("best seo tool", "rankengine")
            assert mentioned is True
            assert "RankEngine" in ctx

    async def test_groq_fallback_when_substring_misses(self):
        """
        Brand not in response text, but Groq classifier confirms it's mentioned
        indirectly.  Tests the substring-miss → Groq-fallback path.
        """
        # ChatGPT response does NOT contain "rankengine"
        mock_response = MagicMock(spec=HttpxResponse)
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "The leading SEO platform is AcmeTool."}}]
        }

        # Groq says "yes" to "does this mention rankengine?"
        mock_choice = MagicMock()
        mock_choice.message.content = "yes"
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]

        mock_groq = AsyncMock()
        mock_groq.chat.completions.create = AsyncMock(return_value=mock_completion)

        with (
            patch("ai_visibility_checker.fetch_with_retry", AsyncMock(return_value=mock_response)),
            patch("ai_visibility_checker.AsyncGroq", return_value=mock_groq),
        ):
            mentioned, ctx = await check_chatgpt("best seo tool", "rankengine")
            assert mentioned is True, "Groq fallback should catch indirect mentions"
            assert mock_groq.chat.completions.create.call_count == 1

    async def test_not_mentioned_when_both_substring_and_groq_miss(self):
        mock_response = MagicMock(spec=HttpxResponse)
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Completely unrelated content."}}]
        }

        mock_choice = MagicMock()
        mock_choice.message.content = "no"
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]

        mock_groq = AsyncMock()
        mock_groq.chat.completions.create = AsyncMock(return_value=mock_completion)

        with (
            patch("ai_visibility_checker.fetch_with_retry", AsyncMock(return_value=mock_response)),
            patch("ai_visibility_checker.AsyncGroq", return_value=mock_groq),
        ):
            mentioned, ctx = await check_chatgpt("some query", "rankengine")
            assert mentioned is False


# ─── gemini check ───────────────────────────────────────────────────────────

class TestGemini:
    async def test_substring_match_detects_brand(self):
        mock_response = MagicMock(spec=HttpxResponse)
        mock_response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "Gemini recommends RankEngine for SEO."}]
                    }
                }
            ]
        }

        with patch("ai_visibility_checker.fetch_with_retry", AsyncMock(return_value=mock_response)):
            mentioned, ctx = await check_gemini("best seo tool", "rankengine")
            assert mentioned is True

    async def test_groq_fallback_called(self):
        mock_response = MagicMock(spec=HttpxResponse)
        mock_response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "The best tool is SomeBrand."}]
                    }
                }
            ]
        }

        mock_choice = MagicMock()
        mock_choice.message.content = "yes"
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]

        mock_groq = AsyncMock()
        mock_groq.chat.completions.create = AsyncMock(return_value=mock_completion)

        with (
            patch("ai_visibility_checker.fetch_with_retry", AsyncMock(return_value=mock_response)),
            patch("ai_visibility_checker.AsyncGroq", return_value=mock_groq),
        ):
            mentioned, ctx = await check_gemini("best tool", "rankengine")
            # "rankengine" not in "The best tool is SomeBrand.", so Groq is called
            assert mentioned is True
            assert mock_groq.chat.completions.create.call_count == 1

    async def test_skipped_when_no_api_key(self):
        with patch("ai_visibility_checker.settings", GEMINI_API_KEY=""):
            mentioned, ctx = await check_gemini("query", "brand")
            assert mentioned is False
            assert ctx == ""


# ─── perplexity check ───────────────────────────────────────────────────────

class TestPerplexity:
    async def test_substring_match_detects_brand(self):
        mock_response = MagicMock(spec=HttpxResponse)
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Perplexity mentions RankEngine as a top tool."}}]
        }

        with patch("ai_visibility_checker.fetch_with_retry", AsyncMock(return_value=mock_response)):
            mentioned, ctx = await check_perplexity("best seo tool", "rankengine")
            assert mentioned is True

    async def test_groq_fallback_called(self):
        mock_response = MagicMock(spec=HttpxResponse)
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "A popular platform is AcmeCorp."}}]
        }

        mock_choice = MagicMock()
        mock_choice.message.content = "yes"
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]

        mock_groq = AsyncMock()
        mock_groq.chat.completions.create = AsyncMock(return_value=mock_completion)

        with (
            patch("ai_visibility_checker.fetch_with_retry", AsyncMock(return_value=mock_response)),
            patch("ai_visibility_checker.AsyncGroq", return_value=mock_groq),
        ):
            mentioned, ctx = await check_perplexity("best tool", "rankengine")
            assert mentioned is True
            assert mock_groq.chat.completions.create.call_count == 1


# ─── Full orchestrator ───────────────────────────────────────────────────────

class TestRunVisibilityCheck:
    async def test_stores_snapshot_for_each_engine(self, monkeypatch):
        """
        Verify that run_visibility_check calls _store_snapshot once per engine
        with the correct mentioned/context values.
        """
        # Mock all engine checkers to return deterministic values
        async def mock_google_aio(pt, bt):
            return (True, "AI Overview mentions BrandX")

        async def mock_chatgpt(pt, bt):
            return (False, "")

        async def mock_gemini(pt, bt):
            return (True, "Gemini mentions BrandX implicitly")

        async def mock_perplexity(pt, bt):
            return (False, "No mention here")

        monkeypatch.setattr(
            "ai_visibility_checker.ENGINE_CHECKERS",
            {
                "google_aio": mock_google_aio,
                "chatgpt": mock_chatgpt,
                "gemini": mock_gemini,
                "perplexity": mock_perplexity,
            },
        )

        # Mock _store_snapshot to track calls
        store_calls = []

        async def fake_store(prompt_id, engine, mentioned, context, checked_at=None):
            store_calls.append((engine, mentioned))

        monkeypatch.setattr(
            "ai_visibility_checker._store_snapshot", fake_store
        )

        await run_visibility_check("prompt-123", "best seo tool", "brandx")

        assert len(store_calls) == 4
        assert ("google_aio", True) in store_calls
        assert ("chatgpt", False) in store_calls
        assert ("gemini", True) in store_calls
        assert ("perplexity", False) in store_calls
