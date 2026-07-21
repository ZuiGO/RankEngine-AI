import json
import traceback
from typing import List, Literal
from pydantic import BaseModel, Field, ValidationError
import groq
from groq import AsyncGroq
from config import settings
from db import db
from bson import ObjectId
import datetime
import asyncio

# =========================================================================
# CRITICAL SECURITY NOTE:
# The LLM API key is read from the settings.LLM_API_KEY configuration variable
# (which loads from the LLM_API_KEY environment variable).
# This API key contains highly sensitive credentials and MUST NEVER be logged
# to stdout, stderr, standard file logs, or shared in exception outputs.
# =========================================================================

class ChecklistItem(BaseModel):
    title: str = Field(description="A descriptive plain English title for a developer audience")
    category: str = Field(description="The issue category e.g. redirect, schema, meta, etc.")
    severity: Literal["critical", "warning", "passed"]
    affectedUrls: List[str] = Field(default_factory=list, description="List of staging/live URLs affected by this issue")
    recommendation: str = Field(description="Actionable remediation steps for developers")
    whyItMatters: str = Field(description="A single plain-English sentence explaining the business impact for a marketer audience, separate from the technical recommendation")

class ChecklistResponse(BaseModel):
    items: List[ChecklistItem]

# Helper to group raw issues for token size reduction
def summarize_issues(issues: List[dict]) -> str:
    summary_map = {}
    for issue in issues:
        key = (
            issue.get("category", "unknown"),
            issue.get("severity", "warning"),
            issue.get("description", "SEO issue")
        )
        if key not in summary_map:
            summary_map[key] = []
        url = issue.get("url")
        if url and url not in summary_map[key]:
            summary_map[key].append(url)
            
    summary_lines = []
    for (category, severity, desc), urls in summary_map.items():
        if severity == "passed":
            summary_lines.append(
                f"- [PASSED] Category: {category} | Positive confirmation: {desc}"
            )
            continue
        urls_str = ", ".join(urls[:10])  # Cap at 10 URLs per group for token limits
        if len(urls) > 10:
            urls_str += f" (and {len(urls) - 10} more)"
        summary_lines.append(
            f"- [{severity.upper()}] Category: {category} | Issue: {desc} | Affected URLs: [{urls_str}]"
        )
    return "\n".join(summary_lines)

async def call_groq_with_backoff(client: AsyncGroq, **kwargs):
    max_retries = 3
    base_delay = 1.0
    for attempt in range(max_retries + 1):
        try:
            return await client.chat.completions.create(**kwargs)
        except Exception as e:
            # Identify typical transient/retriable errors (rate limits, timeouts, connection issues, or standard GroqErrors)
            is_transient = isinstance(e, (groq.APIConnectionError, groq.APITimeoutError, groq.RateLimitError, groq.InternalServerError)) or "Rate limit" in str(e)
            if (is_transient or isinstance(e, groq.GroqError)) and attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                print(f"[LLM FixList]: Transient Groq error: {e}. Retrying in {delay}s (attempt {attempt + 1}/{max_retries + 1})...")
                await asyncio.sleep(delay)
            else:
                raise e

async def generate_fix_list(crawl_job_id: str, raw_issues: List[dict]):
    if not raw_issues:
        print("[LLM FixList]: No raw issues to generate fix-list from.")
        return [], 0

    # Summarize issues to control token size
    issues_summary = summarize_issues(raw_issues)
    
    # Retrieve Groq API key from validated settings (never log this key!)
    api_key = settings.LLM_API_KEY
    if not api_key:
        print("[LLM FixList]: Error: LLM_API_KEY is not configured. Falling back.")
        return [], 0

    client = AsyncGroq(api_key=api_key)
    
    prompt = f"""
You are an expert technical SEO analyst pair programming with a developer.
Analyze the following summarized SEO issues from a recent website audit and generate a structured developer-friendly fix list checklist.

Summarized Issues:
{issues_summary}

Your task:
Consolidate these page-level audit findings into a high-level developer checklist.
Translate technical jargon into actionable, plain-English titles and recommendations targeted at web developers (e.g. "Fix redirect loop on staging server", not raw status codes).
For every PASSED item, preserve it as a positive checklist confirmation with severity "passed" and a "No action needed" recommendation; never rewrite it as a problem to fix.

Each checklist item must include a "whyItMatters" field — a single plain-English sentence that explains the business impact to a non-technical marketer (e.g. "Search engines may show the wrong version of this page in results, splitting your ranking signals"). Do not repeat the recommendation; keep the developer audience's actionable next steps in the "recommendation" field.

CRITICAL REQUIREMENT:
You must respond with ONLY a valid JSON object matching the following schema. No explanations, no introductory text, no markdown wrappers except valid json.

JSON Schema format:
{{
  "items": [
    {{
      "title": "Clear plain English issue description or positive confirmation",
      "category": "redirect" | "meta" | "schema" | "core-web-vitals",
      "severity": "critical" | "warning" | "passed",
      "affectedUrls": ["url1", "url2"],
      "recommendation": "Detailed actionable fix instructions, or 'No action needed' for passed items",
      "whyItMatters": "Single plain-English sentence explaining the business impact for marketers"
    }}
  ]
}}
"""

    model_name = "llama-3.1-8b-instant"  # Standard Groq Llama3 model

    parsed_response = None
    attempts = 2
    
    for attempt in range(attempts):
        try:
            print(f"[LLM FixList]: Requesting Groq LLM completion (attempt {attempt + 1})...")
            chat_completion = await call_groq_with_backoff(
                client,
                messages=[
                    {
                        "role": "user",
                        "content": prompt if attempt == 0 else prompt + "\n\nSTRICT RE-INSTRUCTION: Your previous response failed JSON parsing. Return ONLY valid JSON matching the schema. Do NOT wrap in markdown blocks, do not include any header/footer prose. Response must begin with '{' and end with '}'."
                    }
                ],
                model=model_name,
                temperature=0.1,
            )
            
            content = chat_completion.choices[0].message.content
            if not content:
                print("[LLM FixList]: Empty response from LLM. Falling back to raw issues.")
                return [], 0
            
            # Clean possible markdown wrappers
            content_clean = content.strip()
            if content_clean.startswith("```"):
                lines = content_clean.splitlines()
                if lines[0].startswith("```json") or lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                content_clean = "\n".join(lines).strip()

            parsed_data = json.loads(content_clean)
            
            # Validate JSON schema using Pydantic model
            validated = ChecklistResponse(**parsed_data)
            parsed_response = validated.items
            print(f"[LLM FixList]: Successfully parsed and validated {len(parsed_response)} checklist items.")
            break
        except (json.JSONDecodeError, ValidationError) as err:
            print(f"[LLM FixList]: Attempt {attempt + 1} validation failed: {str(err)}")
            if attempt == attempts - 1:
                print("[LLM FixList]: All LLM attempts failed. Falling back to raw issues response.")
                return [], 0
            # Otherwise retry loop triggers
            
    # Save the parsed checklist items as AuditIssue documents in MongoDB
    if parsed_response and len(parsed_response) > 0:
        # Delete existing raw audit issues for this job to replace them with the parsed checklist items
        await db.auditissues.delete_many({"crawlJobId": ObjectId(crawl_job_id)})
        
        issues_to_create = []
        for item in parsed_response:
            urls = item.affectedUrls if item.affectedUrls else ["N/A"]
            for url in urls:
                issues_to_create.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": item.severity,
                    "category": item.category,
                    "url": url,
                    "description": item.title,
                    "recommendation": item.recommendation,
                    "whyItMatters": item.whyItMatters,
                    "createdAt": datetime.datetime.utcnow()
                })
        
        if issues_to_create:
            await db.auditissues.insert_many(issues_to_create)
            print(f"[LLM FixList]: Inserted {len(issues_to_create)} AuditIssue documents from fix-list.")
            return issues_to_create, len(issues_to_create)

    return [], 0
