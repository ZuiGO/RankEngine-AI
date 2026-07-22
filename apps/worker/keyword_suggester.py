import json
import datetime
import asyncio
from typing import List
from pydantic import BaseModel, Field, ValidationError
import groq
from groq import AsyncGroq
from config import settings
from db import db
from bson import ObjectId


class KeywordSuggestion(BaseModel):
    keyword: str = Field(description="A likely search query a user would type into Google")
    rationale: str = Field(description="Brief note on why this keyword fits the site content")


class KeywordSuggestionResponse(BaseModel):
    suggestions: List[KeywordSuggestion] = Field(
        description="List of 5-10 suggested target keywords derived from page titles and H1s"
    )


async def call_groq_with_backoff(client: AsyncGroq, **kwargs):
    max_retries = 3
    base_delay = 1.0
    for attempt in range(max_retries + 1):
        try:
            return await client.chat.completions.create(**kwargs)
        except Exception as e:
            is_transient = isinstance(
                e, (groq.APIConnectionError, groq.APITimeoutError, groq.RateLimitError, groq.InternalServerError)
            ) or "Rate limit" in str(e)
            if (is_transient or isinstance(e, groq.GroqError)) and attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                print(f"[KeywordSuggester]: Transient Groq error: {e}. Retrying in {delay}s (attempt {attempt + 1}/{max_retries + 1})...")
                await asyncio.sleep(delay)
            else:
                raise e


def build_page_summary(crawled_pages: list) -> str:
    lines = []
    for page in crawled_pages[:50]:
        url = page.get("url", "unknown")
        title = page.get("metaTitle", "").strip()
        h1s = page.get("h1", [])
        desc = page.get("metaDescription", "").strip()
        parts = [f"URL: {url}"]
        if title:
            parts.append(f"Title: {title}")
        if h1s:
            parts.append(f"H1: {' | '.join(h1s[:3])}")
        if desc:
            parts.append(f"Meta: {desc[:200]}")
        lines.append(" | ".join(parts))
    return "\n".join(lines)


async def generate_keyword_suggestions(crawl_job_id: str, crawled_pages: list):
    if not crawled_pages:
        print("[KeywordSuggester]: No pages to derive keywords from.")
        return

    api_key = settings.LLM_API_KEY
    if not api_key:
        print("[KeywordSuggester]: LLM_API_KEY is not configured. Skipping.")
        return

    pages_summary = build_page_summary(crawled_pages)

    client = AsyncGroq(api_key=api_key)

    prompt = f"""You are an SEO keyword research expert. Below is a list of page URLs, titles, H1 headings, and meta descriptions from a recently crawled website.

Pages:
{pages_summary}

Your task:
Analyze these pages and suggest 5-10 likely search queries that a user would type into Google to find content on this site. Focus on the most promising, high-intent keywords that reflect the site's core topics. Do NOT suggest branded terms unless the brand name is self-evident from the page data.

Return ONLY valid JSON in the following schema. No explanations, no markdown wrappers.

{{
  "suggestions": [
    {{
      "keyword": "example search query",
      "rationale": "Brief reason why this keyword fits"
    }}
  ]
}}"""

    model_name = "llama-3.1-8b-instant"
    parsed_response = None
    attempts = 2

    for attempt in range(attempts):
        try:
            print(f"[KeywordSuggester]: Requesting Groq LLM completion (attempt {attempt + 1})...")
            chat_completion = await call_groq_with_backoff(
                client,
                messages=[
                    {
                        "role": "user",
                        "content": prompt if attempt == 0 else prompt + "\n\nSTRICT RE-INSTRUCTION: Return ONLY valid JSON matching the schema. No markdown, no prose."
                    }
                ],
                model=model_name,
                temperature=0.3,
            )

            content = chat_completion.choices[0].message.content or ""
            content_clean = content.strip()
            if content_clean.startswith("```"):
                lines = content_clean.splitlines()
                if lines[0].startswith("```json") or lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                content_clean = "\n".join(lines).strip()

            parsed_data = json.loads(content_clean)
            validated = KeywordSuggestionResponse(**parsed_data)
            parsed_response = validated.suggestions
            break
        except (json.JSONDecodeError, ValidationError) as err:
            print(f"[KeywordSuggester]: Attempt {attempt + 1} validation failed: {str(err)}")
            if attempt == attempts - 1:
                print("[KeywordSuggester]: All LLM attempts failed. Skipping keyword suggestions.")
                return

    if not parsed_response:
        return

    # Retrieve the CrawlJob to find the projectId
    crawl_job_doc = await db.crawljobs.find_one({"_id": ObjectId(crawl_job_id)})
    if not crawl_job_doc:
        print(f"[KeywordSuggester]: CrawlJob {crawl_job_id} not found. Skipping.")
        return

    project_id = crawl_job_doc.get("projectId")
    if not project_id:
        print(f"[KeywordSuggester]: CrawlJob {crawl_job_id} has no projectId. Skipping.")
        return

    # Build suggested keyword docs
    now = datetime.datetime.now(datetime.timezone.utc)
    suggested = [
        {
            "keyword": s.keyword,
            "dismissed": False,
            "source": "audit",
            "createdAt": now,
        }
        for s in parsed_response
    ]

    # Push onto the Project's suggestedKeywords array, avoiding exact duplicates
    for kw in suggested:
        await db.projects.update_one(
            {
                "_id": ObjectId(project_id),
                "suggestedKeywords.keyword": {"$ne": kw["keyword"]},
            },
            {"$push": {"suggestedKeywords": kw}},
        )

    print(f"[KeywordSuggester]: Added {len(suggested)} keyword suggestions to project {project_id}")
