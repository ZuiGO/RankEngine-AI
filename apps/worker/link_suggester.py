import json
import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, ValidationError
from groq import AsyncGroq
from config import settings
from db import db
from bson import ObjectId


class PageInCluster(BaseModel):
    url: str = Field(description="The page URL")
    title: str = Field(description="The page title or H1")


class TopicCluster(BaseModel):
    topicName: str = Field(description="Descriptive cluster name")
    pages: List[PageInCluster] = Field(description="Pages belonging to this cluster")


class ClusterResponse(BaseModel):
    clusters: List[TopicCluster]


class LinkSuggestion(BaseModel):
    sourcePage: str = Field(description="URL where the link should be added")
    targetPage: str = Field(description="URL of the page to link to")
    suggestedAnchorText: str = Field(description="Suggested anchor text")


async def call_groq_with_backoff(client: AsyncGroq, **kwargs):
    import groq
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
                print(f"[LinkSuggester]: Transient Groq error: {e}. Retrying in {delay}s (attempt {attempt + 1}/{max_retries + 1})...")
                await asyncio.sleep(delay)
            else:
                raise e


import asyncio


def build_page_title_list(crawled_pages: list) -> str:
    lines = []
    for page in crawled_pages:
        url = page.get("url", "unknown")
        title = page.get("metaTitle", "").strip()
        h1s = page.get("h1", [])
        display_title = title or (h1s[0] if h1s else url)
        lines.append(f"[{url}] {display_title}")
    return "\n".join(lines)


def get_page_title(crawled_pages: list, target_url: str) -> str:
    for page in crawled_pages:
        if page.get("url") == target_url:
            title = page.get("metaTitle", "").strip()
            h1s = page.get("h1", [])
            return title or (h1s[0] if h1s else target_url)
    return target_url


async def cluster_pages_by_topic(crawled_pages: list) -> Optional[List[TopicCluster]]:
    api_key = settings.LLM_API_KEY
    if not api_key:
        print("[LinkSuggester]: LLM_API_KEY is not configured. Skipping.")
        return None

    if len(crawled_pages) < 2:
        print("[LinkSuggester]: Fewer than 2 pages crawled, skipping topic clustering.")
        return None

    pages_text = build_page_title_list(crawled_pages)

    client = AsyncGroq(api_key=api_key)

    prompt = f"""You are an expert SEO strategist. Group the following web pages into topic clusters based on their content relevance and search intent.

Return valid JSON with this exact schema:
{{
  "clusters": [
    {{
      "topicName": "string (descriptive cluster name)",
      "pages": [
        {{"url": "string", "title": "string"}}
      ]
    }}
  ]
}}

Requirements:
- Every input page must appear in exactly one cluster
- No page should be duplicated across clusters
- No page should be left out
- Create 2 to 8 clusters depending on the variety of topics
- The url field must match the URL exactly as provided

Pages:
{pages_text}"""

    model_name = "llama-3.1-8b-instant"
    attempts = 2

    for attempt in range(attempts):
        try:
            print(f"[LinkSuggester]: Requesting topic clustering (attempt {attempt + 1})...")
            chat_completion = await call_groq_with_backoff(
                client,
                messages=[
                    {
                        "role": "user",
                        "content": prompt if attempt == 0 else prompt + "\n\nSTRICT RE-INSTRUCTION: Return ONLY valid JSON matching the schema. No markdown, no prose."
                    }
                ],
                model=model_name,
                temperature=0.1,
                response_format={"type": "json_object"},
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
            validated = ClusterResponse(**parsed_data)
            return validated.clusters
        except (json.JSONDecodeError, ValidationError) as err:
            print(f"[LinkSuggester]: Attempt {attempt + 1} clustering validation failed: {str(err)}")
            if attempt == attempts - 1:
                print("[LinkSuggester]: All clustering LLM attempts failed. Skipping.")
                return None

    return None


def generate_link_suggestions(crawled_pages: list, clusters: List[TopicCluster]) -> List[LinkSuggestion]:
    if not clusters:
        return []

    url_to_outbound = {}
    for page in crawled_pages:
        url = page.get("url", "")
        outbound = page.get("outboundLinks", [])
        url_to_outbound[url] = set(outbound)

    suggestions_by_source: dict[str, list[LinkSuggestion]] = {}
    cluster_sizes = {c.topicName: len(c.pages) for c in clusters}

    for cluster in clusters:
        pages_in_cluster = [p.url for p in cluster.pages]
        url_to_title = {p.url: p.title for p in cluster.pages}

        outbound_sets = {}
        for url in pages_in_cluster:
            outbound_sets[url] = url_to_outbound.get(url, set())

        for source_url in pages_in_cluster:
            source_outbound = outbound_sets[source_url]

            for target_url in pages_in_cluster:
                if source_url == target_url:
                    continue
                if target_url in source_outbound:
                    continue

                other_links_to_target = any(
                    other_url != source_url and target_url in outbound_sets[other_url]
                    for other_url in pages_in_cluster
                )

                if other_links_to_target:
                    title = url_to_title.get(target_url, "") or get_page_title(crawled_pages, target_url)
                    suggestion = LinkSuggestion(
                        sourcePage=source_url,
                        targetPage=target_url,
                        suggestedAnchorText=title,
                    )
                    suggestions_by_source.setdefault(source_url, []).append(suggestion)

    capped_suggestions = []
    for source_url, suggestions in suggestions_by_source.items():
        if len(suggestions) <= 5:
            capped_suggestions.extend(suggestions)
        else:
            sorted_suggestions = sorted(
                suggestions,
                key=lambda s: cluster_sizes.get(
                    next((c.topicName for c in clusters if s.targetPage in [p.url for p in c.pages]), ""),
                    0
                ),
                reverse=True,
            )
            capped_suggestions.extend(sorted_suggestions[:5])

    return capped_suggestions


async def store_link_suggestions(crawl_job_id: str, project_id: str, suggestions: List[LinkSuggestion]):
    if not suggestions:
        print(f"[LinkSuggester]: No link suggestions to store for crawl job {crawl_job_id}.")
        return

    suggestion_dicts = [
        {
            "sourcePage": s.sourcePage,
            "targetPage": s.targetPage,
            "suggestedAnchorText": s.suggestedAnchorText,
        }
        for s in suggestions
    ]

    doc = {
        "crawlJobId": ObjectId(crawl_job_id),
        "projectId": ObjectId(project_id),
        "suggestions": suggestion_dicts,
        "createdAt": datetime.datetime.utcnow(),
    }

    await db.link_suggestions.insert_one(doc)
    print(f"[LinkSuggester]: Stored {len(suggestions)} link suggestions for project {project_id}.")


async def generate_internal_link_suggestions(crawl_job_id: str, crawled_pages: list):
    if not crawled_pages or len(crawled_pages) < 2:
        print("[LinkSuggester]: Not enough pages to generate link suggestions.")
        return

    crawl_job_doc = await db.crawljobs.find_one({"_id": ObjectId(crawl_job_id)})
    if not crawl_job_doc:
        print(f"[LinkSuggester]: CrawlJob {crawl_job_id} not found. Skipping.")
        return

    project_id = crawl_job_doc.get("projectId")
    if not project_id:
        print(f"[LinkSuggester]: CrawlJob {crawl_job_id} has no projectId. Skipping.")
        return

    clusters = await cluster_pages_by_topic(crawled_pages)
    if not clusters:
        print("[LinkSuggester]: No topic clusters generated, skipping link suggestions.")
        return

    suggestions = generate_link_suggestions(crawled_pages, clusters)

    await store_link_suggestions(crawl_job_id, str(project_id), suggestions)
