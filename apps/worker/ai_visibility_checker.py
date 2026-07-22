"""
ai_visibility_checker.py — Check whether a brand/domain is mentioned across
AI chat and search engines for a given prompt.

Reliability caveats (shared with users)
---------------------------------------
- **google_aio**: Most reliable — checks the live Google SERP for an AI Overview
  block via the SerpAPI provider. Results depend on SerpAPI coverage and Google's
  volatile AI Overview rollout (not all queries trigger one).
- **chatgpt / gemini / perplexity**: Approximate — we send the prompt as a user
  message and scan the response text for the brand term.  Models may mention a
  brand without naming it explicitly (e.g. "the leading project management tool"),
  so we also run a Groq-based LLM classifier as a secondary check.  API
  availability, rate limits, and model updates can affect results.  These checks
  are NOT a guaranteed audit of whether the brand actually appears in the real
  product — only whether the model's output text contains the term.
"""

import json
import re
import logging
from typing import Optional
from datetime import datetime, timezone

import httpx
from groq import AsyncGroq

from config import settings
from db import db
from http_utils import fetch_with_retry

logger = logging.getLogger(__name__)

# ─── Helpers ─────────────────────────────────────────────────────────────────

AI_ENGINES = ["chatgpt", "gemini", "perplexity", "google_aio"]

MAX_CONTEXT_CHARS = 200


def _truncate(text: str, max_chars: int = MAX_CONTEXT_CHARS) -> str:
    """Return the first `max_chars` characters of *text*, appending '…' if truncated."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "…"


def _substring_match(text: str, brand_term: str) -> bool:
    """Case-insensitive substring check."""
    return brand_term.lower() in text.lower()


async def _groq_classifier(text: str, brand_term: str) -> bool:
    """
    LLM-based fallback: ask Groq whether *text* mentions or recommends
    *brand_term*.  Returns True if the model answers "yes".
    """
    api_key = settings.LLM_API_KEY
    if not api_key:
        logger.warning("[AiVisibility] LLM_API_KEY not set — skipping Groq classifier")
        return False

    client = AsyncGroq(api_key=api_key)
    try:
        chat = await client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Does the following text mention or recommend "
                        f'"{brand_term}"? Answer only "yes" or "no".\n\n{text}'
                    ),
                }
            ],
            model="llama-3.1-8b-instant",
            temperature=0.0,
            max_tokens=10,
        )
        raw_answer = (chat.choices[0].message.content or "").strip().lower()
        cleaned = re.sub(r"[^\w\s]", "", raw_answer).strip()
        return cleaned.startswith("yes") or bool(re.search(r"\byes\b", cleaned))
    except Exception as exc:
        logger.warning("[AiVisibility] Groq classifier failed: %s", exc)
        return False


async def _store_snapshot(
    tracked_prompt_id: str,
    engine: str,
    mentioned: bool,
    mention_context: str,
    checked_at: Optional[datetime] = None,
):
    """Insert an AiVisibilitySnapshot document in MongoDB."""
    doc = {
        "trackedPromptId": tracked_prompt_id,
        "engine": engine,
        "mentioned": mentioned,
        "mentionContext": _truncate(mention_context),
        "checkedAt": checked_at or datetime.now(timezone.utc),
    }
    await db.aivisibilitysnapshots.insert_one(doc)


# ─── Engine-specific checks ─────────────────────────────────────────────────
# Each returns (mentioned: bool, context_snippet: str)
# Raises RuntimeError only on unrecoverable errors; logs warnings for skips.


async def check_google_aio(prompt_text: str, brand_term: str) -> tuple[bool, str]:
    """
    Check whether *brand_term* appears inside a Google AI Overview block for
    the given *prompt_text* search.

    Uses the SerpAPI provider (serpapi.com).  The response includes an
    ``ai_overview`` field when Google surfaces an AI-generated answer.
    """
    api_key = settings.SERP_API_KEY
    if not api_key:
        logger.warning("[AiVisibility] SERP_API_KEY not set — skipping google_aio check")
        return False, ""

    try:
        resp = await fetch_with_retry(
            "GET",
            "https://serpapi.com/search",
            params={
                "q": prompt_text,
                "api_key": api_key,
                "engine": "google",
                "google_domain": "google.com",
                "hl": "en",
            },
            timeout=30,
            log_context="SERP",
        )
        data = resp.json()
    except Exception as exc:
        logger.warning("[AiVisibility] google_aio SERP call failed: %s", exc)
        return False, ""

    # SerpAPI returns ai_overview as a dict with "text" or "answer" when present
    ai_overview = data.get("ai_overview")
    if not ai_overview:
        return False, ""

    overview_text = ai_overview.get("text") or ai_overview.get("answer") or ""
    if not overview_text:
        return False, ""

    mentioned = _substring_match(overview_text, brand_term)
    return mentioned, _truncate(overview_text)


async def check_chatgpt(prompt_text: str, brand_term: str) -> tuple[bool, str]:
    """
    Send *prompt_text* to OpenAI's chat completions endpoint and check whether
    *brand_term* appears in the response (substring + Groq fallback).
    """
    api_key = settings.OPENAI_API_KEY
    if not api_key:
        logger.warning("[AiVisibility] OPENAI_API_KEY not set — skipping chatgpt check")
        return False, ""

    try:
        resp = await fetch_with_retry(
            "POST",
            "https://api.openai.com/v1/chat/completions",
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt_text}],
                "temperature": 0.0,
                "max_tokens": 1024,
            },
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=30,
            log_context="OPENAI",
        )
        data = resp.json()
    except Exception as exc:
        logger.warning("[AiVisibility] chatgpt API call failed: %s", exc)
        return False, ""

    content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not content:
        return False, ""

    mentioned = _substring_match(content, brand_term)
    if not mentioned:
        mentioned = await _groq_classifier(content, brand_term)

    return mentioned, _truncate(content)


async def check_gemini(prompt_text: str, brand_term: str) -> tuple[bool, str]:
    """
    Send *prompt_text* to Google's Gemini API and check whether *brand_term*
    appears in the response (substring + Groq fallback).
    """
    api_key = settings.GEMINI_API_KEY
    if not api_key:
        logger.warning("[AiVisibility] GEMINI_API_KEY not set — skipping gemini check")
        return False, ""

    try:
        resp = await fetch_with_retry(
            "POST",
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
            params={"key": api_key},
            json={
                "contents": [{"parts": [{"text": prompt_text}]}],
                "generationConfig": {"temperature": 0.0, "maxOutputTokens": 1024},
            },
            headers={"Content-Type": "application/json"},
            timeout=30,
            log_context="GEMINI",
        )
        data = resp.json()
    except Exception as exc:
        logger.warning("[AiVisibility] gemini API call failed: %s", exc)
        return False, ""

    candidates = data.get("candidates") or []
    parts = (candidates[0].get("content", {}).get("parts") if candidates else []) or []
    content = " ".join(p.get("text", "") for p in parts)
    if not content:
        return False, ""

    mentioned = _substring_match(content, brand_term)
    if not mentioned:
        mentioned = await _groq_classifier(content, brand_term)

    return mentioned, _truncate(content)


async def check_perplexity(prompt_text: str, brand_term: str) -> tuple[bool, str]:
    """
    Send *prompt_text* to Perplexity's chat completions endpoint and check
    whether *brand_term* appears in the response (substring + Groq fallback).
    """
    api_key = settings.PERPLEXITY_API_KEY
    if not api_key:
        logger.warning("[AiVisibility] PERPLEXITY_API_KEY not set — skipping perplexity check")
        return False, ""

    try:
        resp = await fetch_with_retry(
            "POST",
            "https://api.perplexity.ai/chat/completions",
            json={
                "model": "sonar-pro",
                "messages": [{"role": "user", "content": prompt_text}],
                "temperature": 0.0,
                "max_tokens": 1024,
            },
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=30,
            log_context="PERPLEXITY",
        )
        data = resp.json()
    except Exception as exc:
        logger.warning("[AiVisibility] perplexity API call failed: %s", exc)
        return False, ""

    content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not content:
        return False, ""

    mentioned = _substring_match(content, brand_term)
    if not mentioned:
        mentioned = await _groq_classifier(content, brand_term)

    return mentioned, _truncate(content)


# ─── Engine registry ─────────────────────────────────────────────────────────

ENGINE_CHECKERS = {
    "google_aio": check_google_aio,
    "chatgpt": check_chatgpt,
    "gemini": check_gemini,
    "perplexity": check_perplexity,
}


# ─── Orchestrator ────────────────────────────────────────────────────────────

async def run_visibility_check(
    tracked_prompt_id: str,
    prompt_text: str,
    brand_term: str,
):
    """
    Run all enabled engine checks for a single tracked prompt and store
    the results as AiVisibilitySnapshot documents.
    """
    for engine in AI_ENGINES:
        checker = ENGINE_CHECKERS[engine]
        try:
            mentioned, context = await checker(prompt_text, brand_term)
        except Exception as exc:
            logger.error(
                "[AiVisibility] %s check crashed for prompt %s: %s",
                engine, tracked_prompt_id, exc,
            )
            mentioned, context = False, ""

        await _store_snapshot(tracked_prompt_id, engine, mentioned, context)
        logger.info(
            "[AiVisibility] %s → %s (mentioned=%s, context_len=%d)",
            engine, tracked_prompt_id, mentioned, len(context),
        )
