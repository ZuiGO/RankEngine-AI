import asyncio
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin
from urllib.robotparser import RobotFileParser
from bson import ObjectId
import datetime
import json
import re
from db import db

# Structured JSON log helper
def log_json(level: str, event: str, **kwargs):
    log_data = {
        "level": level,
        "event": event,
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        **kwargs
    }
    print(json.dumps(log_data), flush=True)

# CAPTCHA detection logic
def is_captcha_present(html_content: str) -> bool:
    content_lower = html_content.lower()
    captcha_markers = [
        "captcha",
        "hcaptcha",
        "recaptcha",
        "cloudflare challenge",
        "verify you are human",
        "ddos protection",
        "page security check"
    ]
    return any(marker in content_lower for marker in captcha_markers)

# Registrable domain checker
def is_internal_link(url: str, target_hostname: str) -> bool:
    try:
        parsed = urlparse(url)
        if not parsed.netloc:
            return True  # Relative link
        
        hostname = parsed.hostname or ""
        target_base = target_hostname
        if target_hostname.startswith('www.'):
            target_base = target_hostname[4:]
        
        # Check if the hostname matches target_base or is a subdomain of it
        return hostname == target_base or hostname.endswith('.' + target_base)
    except Exception:
        return False

# Extract outbound internal links from HTML for link graph
def extract_outbound_links(html: str, base_url: str, target_hostname: str) -> list:
    soup = BeautifulSoup(html, 'html.parser')
    outbound = []
    for anchor in soup.find_all('a', href=True):
        resolved_href = urljoin(base_url, anchor['href'])
        clean_url = resolved_href.split('#')[0].split('?')[0].rstrip('/')
        if clean_url.startswith(('http://', 'https://')):
            if is_internal_link(clean_url, target_hostname):
                outbound.append(clean_url)
    return outbound

# SEO tag and word count extractor
def extract_seo_data(html_content: str, url: str, status_code: int) -> dict:
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Canonical
    canonical_tag = soup.find('link', rel='canonical')
    canonical = canonical_tag.get('href') if canonical_tag else None
    
    # Meta Title
    title_tag = soup.find('title')
    meta_title_tag = soup.find('meta', attrs={'name': 'title'})
    meta_title_attr = meta_title_tag.get('content') if meta_title_tag else None
    meta_title = title_tag.get_text().strip() if title_tag else (meta_title_attr or '')
    
    # Meta Description
    desc_tag = soup.find('meta', attrs={'name': 'description'})
    if not desc_tag:
        desc_tag = soup.find('meta', attrs={'property': 'og:description'})
    meta_description = desc_tag.get('content').strip() if desc_tag else ''

    # Headers H1 - H6
    headers = {}
    for i in range(1, 7):
        tag_name = f'h{i}'
        found_tags = soup.find_all(tag_name)
        headers[tag_name] = [t.get_text().strip() for t in found_tags if t.get_text()]

    # Meta Robots noindex
    meta_robots_tag = soup.find('meta', attrs={'name': 'robots'})
    meta_robots_content = (meta_robots_tag.get('content', '') or '').lower() if meta_robots_tag else ''
    meta_noindex = 'noindex' in meta_robots_content

    # Extract word count from visible text
    for script_or_style in soup(["script", "style", "noscript", "iframe"]):
        script_or_style.decompose()
        
    text = soup.get_text()
    words = re.findall(r'\b\w+\b', text)
    word_count = len(words)

    return {
        "url": url,
        "statusCode": status_code,
        "h1": headers.get("h1", []),
        "h2": headers.get("h2", []),
        "h3": headers.get("h3", []),
        "h4": headers.get("h4", []),
        "h5": headers.get("h5", []),
        "h6": headers.get("h6", []),
        "canonical": canonical,
        "metaTitle": meta_title,
        "metaDescription": meta_description,
        "wordCount": word_count,
        "meta_noindex": meta_noindex,
    }

# --- Core Web Vitals helpers ---

def classify_lcp(value_ms: float) -> str:
    if value_ms <= 2500:
        return "good"
    if value_ms <= 4000:
        return "needs-improvement"
    return "poor"

def classify_cls(value: float) -> str:
    if value <= 0.1:
        return "good"
    if value <= 0.25:
        return "needs-improvement"
    return "poor"

def classify_tbt(value_ms: float) -> str:
    if value_ms <= 200:
        return "good"
    if value_ms <= 600:
        return "needs-improvement"
    return "poor"

def aggregate_severity(classifications: list) -> str:
    total = len(classifications)
    if total == 0:
        return "passed"
    poor = sum(1 for c in classifications if c == "poor")
    needs_improvement = sum(1 for c in classifications if c == "needs-improvement")
    if poor / total > 0.5:
        return "critical"
    if (poor + needs_improvement) / total > 0.2:
        return "warning"
    return "passed"


async def measure_page_cwv(browser, url: str) -> dict:
    context = await browser.new_context()
    page = await context.new_page()

    try:
        await page.goto(url, timeout=15000, wait_until="load")
        await page.add_script_tag(url="https://unpkg.com/web-vitals@4/dist/web-vitals.iife.js")

        metrics = await page.evaluate("""() => {
            return new Promise((resolve) => {
                let lcp = 0, cls = 0, tbt = 0;

                try { webVitals.onLCP((m) => { lcp = m.value; }); } catch(e) {}
                try { webVitals.onCLS((m) => { cls = m.value; }); } catch(e) {}

                let tbtObserver;
                try {
                    tbtObserver = new PerformanceObserver((list) => {
                        for (const entry of list.getEntries()) {
                            tbt += Math.max(0, entry.duration - 50);
                        }
                    });
                    tbtObserver.observe({ type: 'longtask', buffered: true });
                } catch(e) {}

                setTimeout(() => {
                    if (tbtObserver) tbtObserver.disconnect();
                    resolve({ lcp, cls, tbt });
                }, 8000);
            });
        }""")

        return {"url": url, "lcp": metrics["lcp"], "cls": metrics["cls"], "tbt": metrics["tbt"]}
    except Exception as e:
        log_json("WARNING", "cwv_page_error", url=url, error=str(e))
        return {"url": url, "lcp": 0, "cls": 0, "tbt": 0, "error": str(e)}
    finally:
        try:
            await page.close()
        except Exception:
            pass
        try:
            await context.close()
        except Exception:
            pass


async def measure_core_web_vitals(crawled_pages: list, crawl_job_id: str):
    if not crawled_pages:
        return

    sampled = [crawled_pages[0]]
    for page in crawled_pages[1:]:
        if len(sampled) >= 20:
            break
        sampled.append(page)

    measurements = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        for page_data in sampled:
            url = page_data.get("url", "")
            if not url:
                continue
            m = await measure_page_cwv(browser, url)
            measurements.append(m)
        await browser.close()

    valid = [m for m in measurements if "error" not in m]
    if not valid:
        log_json("WARNING", "cwv_no_valid_measurements", crawlJobId=crawl_job_id)
        return

    lcp_vals = [m["lcp"] for m in valid]
    cls_vals = [m["cls"] for m in valid]
    tbt_vals = [m["tbt"] for m in valid]

    lcp_ratings = [classify_lcp(v) for v in lcp_vals]
    cls_ratings = [classify_cls(v) for v in cls_vals]
    tbt_ratings = [classify_tbt(v) for v in tbt_vals]

    def make_details(values, ratings, label):
        return [{"url": m["url"], "value": values[i], "rating": ratings[i]} for i, m in enumerate(valid)]

    def count_rating(ratings, target):
        return sum(1 for r in ratings if r == target)

    issues = [
        {
            "crawlJobId": ObjectId(crawl_job_id),
            "severity": aggregate_severity(lcp_ratings),
            "category": "core-web-vitals",
            "url": "N/A",
            "description": (
                f"LCP (Largest Contentful Paint): "
                f"{count_rating(lcp_ratings, 'good')} good, "
                f"{count_rating(lcp_ratings, 'needs-improvement')} needs-improvement, "
                f"{count_rating(lcp_ratings, 'poor')} poor across {len(valid)} sampled pages. "
                f"Thresholds: good \u2264 2500ms, needs-improvement \u2264 4000ms, poor > 4000ms."
            ),
            "recommendation": "Optimize server response time, use a CDN, lazy-load images, and eliminate render-blocking resources.",
            "whyItMatters": "LCP measures loading performance. A good LCP ensures users see content quickly, reducing bounce rates.",
            "details": make_details(lcp_vals, lcp_ratings, "LCP"),
        },
        {
            "crawlJobId": ObjectId(crawl_job_id),
            "severity": aggregate_severity(cls_ratings),
            "category": "core-web-vitals",
            "url": "N/A",
            "description": (
                f"CLS (Cumulative Layout Shift): "
                f"{count_rating(cls_ratings, 'good')} good, "
                f"{count_rating(cls_ratings, 'needs-improvement')} needs-improvement, "
                f"{count_rating(cls_ratings, 'poor')} poor across {len(valid)} sampled pages. "
                f"Thresholds: good \u2264 0.1, needs-improvement \u2264 0.25, poor > 0.25."
            ),
            "recommendation": "Set explicit width/height on images and embeds, avoid inserting content above existing content, and use transform animations.",
            "whyItMatters": "CLS measures visual stability. A good CLS prevents unexpected layout shifts that frustrate users.",
            "details": make_details(cls_vals, cls_ratings, "CLS"),
        },
        {
            "crawlJobId": ObjectId(crawl_job_id),
            "severity": aggregate_severity(tbt_ratings),
            "category": "core-web-vitals",
            "url": "N/A",
            "description": (
                f"TBT (proxy for INP — real INP requires field data): "
                f"{count_rating(tbt_ratings, 'good')} good, "
                f"{count_rating(tbt_ratings, 'needs-improvement')} needs-improvement, "
                f"{count_rating(tbt_ratings, 'poor')} poor across {len(valid)} sampled pages. "
                f"Thresholds: good \u2264 200ms, needs-improvement \u2264 600ms, poor > 600ms."
            ),
            "recommendation": "Break up long JavaScript tasks, use web workers for heavy computation, and lazy-load non-critical scripts.",
            "whyItMatters": "TBT (proxy for INP — real INP requires field data). TBT measures responsiveness during load. Lower values mean pages are more interactive sooner.",
            "details": make_details(tbt_vals, tbt_ratings, "TBT"),
        },
    ]

    try:
        await db.auditissues.insert_many(issues)
        log_json("INFO", "cwv_issues_created", crawlJobId=crawl_job_id, count=len(issues), sampled=len(valid))
    except Exception as e:
        log_json("ERROR", "cwv_insert_failed", crawlJobId=crawl_job_id, error=str(e))


# --- Indexing checks ---

EXCLUSION_PATTERNS = ["/admin", "/wp-admin", "/login", "/staging", "/test", "/internal"]


def is_path_excluded(path: str) -> bool:
    path_lower = path.lower()
    return any(pattern in path_lower for pattern in EXCLUSION_PATTERNS)


def identify_indexing_issues(crawled_pages: list, crawl_job_id: str, robots_parser) -> list:
    flagged_pages = []
    robots_blocked_pages = []

    for page in crawled_pages:
        url = page.get("url", "")
        if not url:
            continue
        parsed = urlparse(url)
        path = parsed.path or "/"

        robots_blocked = False
        if robots_parser:
            robots_blocked = not robots_parser.can_fetch("*", url)

        meta_noindex = page.get("meta_noindex", False) or False

        x_robots_tag = page.get("x_robots_tag", "")
        if x_robots_tag and "noindex" in x_robots_tag.lower():
            meta_noindex = True

        canonical = page.get("canonical")
        canonical_mismatch = False
        if canonical:
            clean_url = url.split("#")[0].split("?")[0].rstrip("/")
            clean_canonical = canonical.split("#")[0].split("?")[0].rstrip("/")
            if clean_url != clean_canonical:
                canonical_mismatch = True

        page_info = {
            "url": url,
            "meta_noindex": meta_noindex,
            "canonical_mismatch": canonical_mismatch,
            "robots_txt_blocked": robots_blocked,
        }

        has_indexing_issue = meta_noindex or canonical_mismatch

        if has_indexing_issue and not is_path_excluded(path):
            flagged_pages.append(page_info)

        if robots_blocked and not has_indexing_issue:
            robots_blocked_pages.append(page_info)

    issues = []

    if flagged_pages:
        issues.append({
            "crawlJobId": ObjectId(crawl_job_id),
            "severity": "critical",
            "category": "indexing",
            "url": "N/A",
            "description": (
                f"{len(flagged_pages)} of {len(crawled_pages)} crawled pages have indexing issues "
                f"(noindex or canonical mismatch)"
            ),
            "recommendation": (
                "Remove noindex directives for pages intended to appear in search results, "
                "and ensure canonical tags point to the page itself."
            ),
            "whyItMatters": (
                "Pages with noindex or conflicting canonicals may be excluded from search results, "
                "reducing organic visibility."
            ),
            "details": flagged_pages,
        })

    if robots_blocked_pages:
        issues.append({
            "crawlJobId": ObjectId(crawl_job_id),
            "severity": "passed",
            "category": "indexing",
            "url": "N/A",
            "description": (
                f"{len(robots_blocked_pages)} pages are blocked by robots.txt "
                f"(intentional \u2014 no action needed)"
            ),
            "recommendation": "No action needed.",
            "details": robots_blocked_pages,
        })

    return issues


async def crawl_site(crawl_job_id: str, target_url: str, limit: int = 5000, max_concurrency: int = 5):
    # Ensure start url contains schema protocol
    if not target_url.startswith(('http://', 'https://')):
        start_url = 'https://' + target_url
    else:
        start_url = target_url

    parsed_target = urlparse(start_url)
    target_hostname = parsed_target.hostname or ""

    log_json("INFO", "crawler_init", crawlJobId=crawl_job_id, targetUrl=start_url, host=target_hostname)

    visited_urls = set()
    crawled_pages = []
    queue = asyncio.Queue()
    await queue.put(start_url)

    # Initialize Robots Parser
    robots_parser = RobotFileParser()
    robots_loaded = False
    
    # Concurrency control
    semaphore = asyncio.Semaphore(max_concurrency)

    # Shared event to signal workers to stop
    stop_event = asyncio.Event()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        # Load Robots.txt using browser context (single page, closed after use)
        try:
            robots_url = urljoin(start_url, '/robots.txt')
            ctx = await browser.new_context()
            pg = await ctx.new_page()
            response = await pg.goto(robots_url, timeout=10000)
            if response and response.status < 400:
                robots_txt = await response.text()
                robots_parser.parse(robots_txt.splitlines())
                robots_loaded = True
                log_json("INFO", "robots_loaded", crawlJobId=crawl_job_id, url=robots_url)
            else:
                log_json("INFO", "robots_missing", crawlJobId=crawl_job_id, url=robots_url)
            await pg.close()
            await ctx.close()
        except Exception as e:
            log_json("WARNING", "robots_load_failed", crawlJobId=crawl_job_id, error=str(e))

        async def worker():
            while not stop_event.is_set():
                try:
                    url = await asyncio.wait_for(queue.get(), timeout=1)
                except asyncio.TimeoutError:
                    continue
                except asyncio.CancelledError:
                    break

                if len(crawled_pages) >= limit:
                    queue.task_done()
                    continue

                # Check robots compliance if loaded
                if robots_loaded:
                    if not robots_parser.can_fetch("*", url):
                        log_json("INFO", "robots_disallowed", crawlJobId=crawl_job_id, url=url)
                        queue.task_done()
                        continue

                async with semaphore:
                    page_data = await crawl_page_with_retry(browser, url, crawl_job_id)
                    
                    if page_data:
                        crawled_pages.append(page_data)
                        
                        # Increment progress count in CrawlJob document live
                        await db.crawljobs.update_one(
                            {"_id": ObjectId(crawl_job_id)},
                            {"$inc": {"pageCount": 1}}
                        )
                        
                        # Extract internal links from page HTML to follow and build outbound link graph
                        html = page_data.pop("html", None)
                        outbound_links = []
                        if html:
                            outbound_links = extract_outbound_links(html, url, target_hostname)
                            soup = BeautifulSoup(html, 'html.parser')
                            for anchor in soup.find_all('a', href=True):
                                raw_href = anchor['href']
                                resolved_href = urljoin(url, raw_href)
                                
                                # Strip query parameters & fragments to prevent duplicate pages
                                clean_url = resolved_href.split('#')[0].split('?')[0].rstrip('/')
                                
                                if clean_url.startswith(('http://', 'https://')):
                                    if is_internal_link(clean_url, target_hostname):
                                        if clean_url not in visited_urls:
                                            visited_urls.add(clean_url)
                                            await queue.put(clean_url)
                            page_data["outboundLinks"] = outbound_links
                        
                        # Check schema issues per-page while HTML is available
                        if html:
                            from schema_validator import validate_json_ld
                            try:
                                schema_issues = validate_json_ld(html, url, crawl_job_id)
                                for si in schema_issues:
                                    page_data.setdefault("schemaIssues", []).append(si)
                            except Exception as e:
                                log_json("ERROR", "schema_validation_error", url=url, error=str(e))

                    if len(crawled_pages) >= limit:
                        stop_event.set()

                queue.task_done()

        # Seed visited set with initial url
        visited_urls.add(start_url.split('#')[0].split('?')[0].rstrip('/'))

        # Create workers to run concurrently
        workers = [asyncio.create_task(worker()) for _ in range(max_concurrency)]

        await stop_event.wait()
        await queue.join()

        # Cancel active workers
        for w in workers:
            w.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        await browser.close()

    # 1. Identify raw SEO issues from crawled pages (includes schema validation)
    raw_issues = identify_raw_seo_issues(crawled_pages, crawl_job_id)
    if raw_issues:
        await db.auditissues.insert_many(raw_issues)

    # Save CrawlResult output into the crawlresults collection
    crawl_result = {
        "crawlJobId": ObjectId(crawl_job_id),
        "pages": crawled_pages,
        "createdAt": datetime.datetime.utcnow()
    }
    result_insert = await db.crawlresults.insert_one(crawl_result)
    crawl_result_id = result_insert.inserted_id
        
    # 2. Invoke LLM checklist generator to synthesize plain-English developer checklist
    from llm import generate_fix_list
    try:
        await generate_fix_list(crawl_job_id, raw_issues)
    except Exception as e:
        log_json("ERROR", "llm_generation_failed", crawlJobId=crawl_job_id, error=str(e))

    # 3. Derive keyword suggestions from page titles/H1s and store on the Project
    from keyword_suggester import generate_keyword_suggestions
    try:
        await generate_keyword_suggestions(crawl_job_id, crawled_pages)
    except Exception as e:
        log_json("ERROR", "keyword_suggestion_failed", crawlJobId=crawl_job_id, error=str(e))

    # 4. Core Web Vitals sampling and measurement
    try:
        await measure_core_web_vitals(crawled_pages, crawl_job_id)
    except Exception as e:
        log_json("ERROR", "cwv_measurement_failed", crawlJobId=crawl_job_id, error=str(e))

    # 5. Indexing checks (noindex, canonical mismatch, robots.txt)
    try:
        indexing_issues = identify_indexing_issues(crawled_pages, crawl_job_id, robots_parser)
        if indexing_issues:
            await db.auditissues.insert_many(indexing_issues)
    except Exception as e:
        log_json("ERROR", "indexing_check_failed", crawlJobId=crawl_job_id, error=str(e))

    # 6. Internal link suggestions via topic clustering
    from link_suggester import generate_internal_link_suggestions
    try:
        await generate_internal_link_suggestions(crawl_job_id, crawled_pages)
    except Exception as e:
        log_json("ERROR", "link_suggestion_failed", crawlJobId=crawl_job_id, error=str(e))

    log_json(
        "INFO",
        "crawler_finished",
        crawlJobId=crawl_job_id,
        pagesCrawled=len(crawled_pages),
        rawResultsRef=str(crawl_result_id)
    )

    return str(crawl_result_id), len(crawled_pages)

def identify_raw_seo_issues(crawled_pages: list, crawl_job_id: str) -> list:
    issues = []
    total_pages = len(crawled_pages)
    passed_counts = {
        "http_status": 0,
        "meta_title": 0,
        "meta_description": 0,
        "single_h1": 0,
    }
    schema_passed_counts = {}

    for page in crawled_pages:
        url = page.get("url")
        status = page.get("statusCode", 200)

        # Check HTTP Errors
        if status >= 400:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "meta",
                "url": url,
                "description": f"Page returned error status code {status}",
                "recommendation": "Fix routing errors, database queries, or server-side configurations."
            })
        elif 200 <= status < 400:
            passed_counts["http_status"] += 1

        # Check Title Issues
        title = page.get("metaTitle", "")
        if not isinstance(title, str) or not title.strip():
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "meta",
                "url": url,
                "description": "Page title is missing or empty",
                "recommendation": "Add a unique and descriptive meta title tag of 50-60 characters to improve visibility."
            })
        else:
            passed_counts["meta_title"] += 1

        # Check Description Issues
        desc = page.get("metaDescription", "")
        if not isinstance(desc, str) or not desc.strip():
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "meta",
                "url": url,
                "description": "Meta description is missing or empty",
                "recommendation": "Provide a descriptive snippet of 150-160 characters summarizing the page subject."
            })
        else:
            passed_counts["meta_description"] += 1

        # Check H1 Header count
        h1s = page.get("h1", [])
        if len(h1s) != 1:
            severity = "critical" if len(h1s) == 0 else "warning"
            desc_text = "Page lacks an H1 header tag" if len(h1s) == 0 else f"Page contains {len(h1s)} H1 tags (expected exactly 1)"
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": severity,
                "category": "meta",
                "url": url,
                "description": desc_text,
                "recommendation": "Configure templates to output exactly one H1 header representing primary subject."
            })
        else:
            passed_counts["single_h1"] += 1

        # Collect schema issues found during crawl (attached per-page by worker)
        for schema_issue in page.get("schemaIssues", []):
            if schema_issue.get("severity") == "passed":
                description = schema_issue.get("description", "Valid structured data")
                schema_passed_counts[description] = schema_passed_counts.get(description, 0) + 1
            else:
                issues.append(schema_issue)

    # Passed checks are stored as one crawl-level summary per check type. This
    # keeps a 5,000-page audit from flooding the checklist and LLM context.
    passed_summaries = [
        ("http_status", "returned a successful HTTP status"),
        ("meta_title", "have a meta title present and well-formed"),
        ("meta_description", "have a meta description present and well-formed"),
        ("single_h1", "have exactly one H1 tag"),
    ]
    for check_type, outcome in passed_summaries:
        passed_count = passed_counts[check_type]
        if passed_count:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "passed",
                "category": "meta",
                "url": "N/A",
                "description": f"{passed_count} of {total_pages} crawled pages {outcome}",
                "recommendation": "No action needed."
            })

    for description, passed_count in schema_passed_counts.items():
        schema_type = description.removeprefix("Page has valid ").removesuffix(" structured data")
        issues.append({
            "crawlJobId": ObjectId(crawl_job_id),
            "severity": "passed",
            "category": "schema",
            "url": "N/A",
            "description": f"{passed_count} of {total_pages} crawled pages have valid {schema_type} structured data",
            "recommendation": "No action needed."
        })

    return issues


async def crawl_page_with_retry(browser, url: str, crawl_job_id: str) -> dict | None:
    max_retries = 3
    context = None

    for attempt in range(max_retries + 1):
        try:
            if context is None:
                context = await browser.new_context()
            page = await context.new_page()

            response = await page.goto(url, timeout=15000)
            
            status_code = response.status if response else 0
            response_headers = response.headers if response else {}
            x_robots_tag = response_headers.get('x-robots-tag', '')
            html = await page.content()

            # Retry Trigger 1: Status Code 429
            if status_code == 429:
                raise IOError(f"HTTP Status 429 Too Many Requests")

            # Retry Trigger 2: CAPTCHA block detected in source code
            if is_captcha_present(html):
                raise IOError("CAPTCHA challenge block detected on page")

            # Success: Parse page SEO data
            seo_data = extract_seo_data(html, url, status_code)
            seo_data["html"] = html  # Attached temporarily for link extraction + schema validation
            seo_data["x_robots_tag"] = x_robots_tag

            await page.close()
            if context:
                await context.close()
                context = None
            return seo_data

        except (PlaywrightTimeoutError, IOError, Exception) as e:
            # Cleanup current page and context on failure
            try:
                await page.close()
            except Exception:
                pass
            page = None
            # Keep context alive across retries (reuse for backoff)
            context = None

            if attempt < max_retries:
                backoff_seconds = 2 ** attempt
                log_json(
                    "WARNING",
                    "request_retry",
                    crawlJobId=crawl_job_id,
                    url=url,
                    attempt=attempt + 1,
                    backoff=backoff_seconds,
                    reason=str(e)
                )
                await asyncio.sleep(backoff_seconds)
            else:
                log_json(
                    "ERROR",
                    "request_failed",
                    crawlJobId=crawl_job_id,
                    url=url,
                    reason=str(e)
                )
                return {
                    "url": url,
                    "statusCode": 500,
                    "h1": [],
                    "h2": [],
                    "h3": [],
                    "h4": [],
                    "h5": [],
                    "h6": [],
                    "canonical": None,
                    "metaTitle": "",
                    "metaDescription": f"Crawl failed after {max_retries} retries: {str(e)}",
                    "wordCount": 0
                }
    return None

async def run_migration_check(crawl_job_id: str, live_domain: str, staging_domain: str):
    # Ensure domains contain protocols
    if not live_domain.startswith(('http://', 'https://')):
        live_url = 'https://' + live_domain
    else:
        live_url = live_domain
        
    if not staging_domain.startswith(('http://', 'https://')):
        staging_url = 'https://' + staging_domain
    else:
        staging_url = staging_domain

    parsed_live = urlparse(live_url)
    live_hostname = parsed_live.hostname or ""

    parsed_staging = urlparse(staging_url)
    staging_hostname = parsed_staging.hostname or ""

    log_json(
        "INFO",
        "migration_check_init",
        crawlJobId=crawl_job_id,
        liveUrl=live_url,
        stagingUrl=staging_url
    )

    # 1. Harvest live URLs
    visited_urls = set()
    crawled_pages = []
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        # Simple crawler BFS to harvest up to 100 production URLs for validation
        log_json("INFO", "harvesting_live_urls", crawlJobId=crawl_job_id, liveUrl=live_url)
        
        queue = asyncio.Queue()
        await queue.put(live_url)
        visited_urls.add(live_url.split('#')[0].split('?')[0].rstrip('/'))
        
        discovered_urls = []
        
        # Concurrency limit for harvesting
        sem = asyncio.Semaphore(5)
        
        async def harvester():
            while True:
                try:
                    url = await queue.get()
                except asyncio.CancelledError:
                    break
                
                if len(discovered_urls) >= 100:
                    queue.task_done()
                    continue
                    
                async with sem:
                    context = None
                    page = None
                    response = None
                    max_retries = 2
                    try:
                        for attempt in range(max_retries + 1):
                            try:
                                context = await browser.new_context()
                                page = await context.new_page()
                                response = await page.goto(url, timeout=10000)
                                if response:
                                    if response.status == 429 or response.status >= 500:
                                        raise IOError(f"HTTP Status {response.status}")
                                    break
                            except Exception as exc:
                                if page:
                                    await page.close()
                                if context:
                                    await context.close()
                                page, context = None, None
                                if attempt < max_retries:
                                    delay = 2 ** attempt
                                    log_json("WARNING", "harvester_retry", url=url, attempt=attempt+1, delay=delay, reason=str(exc))
                                    await asyncio.sleep(delay)
                                else:
                                    raise exc

                        if response and response.status == 200:
                            discovered_urls.append(url)
                            html = await page.content()
                            soup = BeautifulSoup(html, 'html.parser')
                            for anchor in soup.find_all('a', href=True):
                                resolved = urljoin(url, anchor['href'])
                                clean = resolved.split('#')[0].split('?')[0].rstrip('/')
                                is_internal = is_internal_link(clean, live_hostname)
                                not_visited = clean not in visited_urls
                                log_json("INFO", "found_link", url=url, href=anchor['href'], clean=clean, is_internal=is_internal, not_visited=not_visited)
                                if clean.startswith(('http://', 'https://')):
                                    if not_visited and is_internal:
                                        visited_urls.add(clean)
                                        await queue.put(clean)
                    except Exception as e:
                        log_json("ERROR", "harvester_error", url=url, error=str(e))
                    finally:
                        if page:
                            await page.close()
                        if context:
                            await context.close()
                queue.task_done()
        
        workers = [asyncio.create_task(harvester()) for _ in range(5)]
        
        while len(discovered_urls) < 100:
            if queue.empty() and queue._unfinished_tasks == 0:
                break
            await asyncio.sleep(0.1)
            
        await queue.join()
        for w in workers:
            w.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        
        log_json(
            "INFO",
            "harvested_urls_count",
            crawlJobId=crawl_job_id,
            count=len(discovered_urls)
        )
        
        # 2. Check staging redirects
        issues_to_create = []
        results_list = []
        
        # Concurrency semaphore for redirect checking
        check_sem = asyncio.Semaphore(5)
        
        async def check_redirect(live_page_url):
            # Calculate staging equivalent URL by replacing live_hostname with staging_hostname
            parsed_page = urlparse(live_page_url)
            staging_page_netloc = parsed_page.netloc.replace(live_hostname, staging_hostname)
            staging_page_url = parsed_page._replace(netloc=staging_page_netloc).geturl()
            
            async with check_sem:
                context = None
                page = None
                response = None
                max_retries = 2
                try:
                    for attempt in range(max_retries + 1):
                        try:
                            context = await browser.new_context()
                            page = await context.new_page()
                            
                            # Playwright follows redirects automatically.
                            # We will resolve the final page and inspect request chain.
                            response = await page.goto(staging_page_url, timeout=15000)
                            if response:
                                if response.status == 429 or response.status >= 500:
                                    raise IOError(f"HTTP Status {response.status}")
                                break
                        except Exception as exc:
                            if page:
                                await page.close()
                            if context:
                                await context.close()
                            page, context = None, None
                            if attempt < max_retries:
                                delay = 2 ** attempt
                                log_json("WARNING", "check_redirect_retry", url=staging_page_url, attempt=attempt+1, delay=delay, reason=str(exc))
                                await asyncio.sleep(delay)
                            else:
                                raise exc
                    
                    # Trace redirect chain
                    redirects = []
                    req = response.request if response else None
                    while req and req.redirected_from:
                        redirects.insert(0, req.redirected_from)
                        req = req.redirected_from
                    
                    if redirects:
                        first_req = redirects[0]
                        first_resp = await first_req.response()
                        status = first_resp.status if first_resp else 0
                        target = redirects[1].url if len(redirects) > 1 else (response.url if response else "")
                    else:
                        status = response.status if response else 0
                        target = response.url if response else ""
                    
                    # Validate redirect rules
                    is_redirect = status in (301, 308)
                    clean_target = target.split('#')[0].split('?')[0].rstrip('/')
                    clean_live = live_page_url.split('#')[0].split('?')[0].rstrip('/')
                    
                    target_match = clean_target == clean_live
                    
                    issue_type = None
                    if not is_redirect:
                        issue_type = "missing_redirect"
                    elif not target_match:
                        issue_type = "wrong_target"
                        
                    results_list.append({
                        "url": staging_page_url,
                        "statusCode": status,
                        "redirectTarget": target,
                        "expectedTarget": live_page_url,
                        "status": "passed" if not issue_type else "failed",
                        "issueType": issue_type
                    })
                    
                    if issue_type:
                        desc = ""
                        if issue_type == "missing_redirect":
                            desc = f"Migration check failed: Staging URL {staging_page_url} returned status {status} instead of a 301 or 308 redirect."
                        else:
                            desc = f"Migration check failed: Staging URL {staging_page_url} redirected to {target} (expected {live_page_url})."
                            
                        issues_to_create.append({
                            "crawlJobId": ObjectId(crawl_job_id),
                            "severity": "critical",
                            "category": "redirect",
                            "url": staging_page_url,
                            "description": desc,
                            "recommendation": "Configure a permanent 301 or 308 redirect pointing to the correct production live URL to preserve SEO equity."
                        })
                except Exception as e:
                    results_list.append({
                        "url": staging_page_url,
                        "statusCode": 500,
                        "redirectTarget": None,
                        "expectedTarget": live_page_url,
                        "status": "failed",
                        "issueType": "missing_redirect"
                    })
                    issues_to_create.append({
                        "crawlJobId": ObjectId(crawl_job_id),
                        "severity": "critical",
                        "category": "redirect",
                        "url": staging_page_url,
                        "description": f"Migration check failed: Timeout or request error trying to fetch staging URL. Error: {str(e)}",
                        "recommendation": "Ensure the staging site is online and correctly redirects staging traffic to production."
                    })
                finally:
                    if page:
                        await page.close()
                    if context:
                        await context.close()
                        
            # Increment progress count live
            await db.crawljobs.update_one(
                {"_id": ObjectId(crawl_job_id)},
                {"$inc": {"pageCount": 1}}
            )
            
        # Run redirect checks concurrently for all discovered URLs
        if discovered_urls:
            await asyncio.gather(*(check_redirect(u) for u in discovered_urls))
        await browser.close()
        
    # 3. Write results to DB
    if issues_to_create:
        await db.auditissues.insert_many(issues_to_create)
        
        # Invoke LLM checklist generator to synthesize plain-English developer checklist
        from llm import generate_fix_list
        try:
            await generate_fix_list(crawl_job_id, issues_to_create)
        except Exception as e:
            log_json("ERROR", "llm_generation_failed", crawlJobId=crawl_job_id, error=str(e))
        
    crawl_result = {
        "crawlJobId": ObjectId(crawl_job_id),
        "pages": results_list,
        "createdAt": datetime.datetime.utcnow(),
        "type": "migration-check"
    }
    result_insert = await db.crawlresults.insert_one(crawl_result)
    crawl_result_id = result_insert.inserted_id
    
    await db.crawljobs.update_one(
        {"_id": ObjectId(crawl_job_id)},
        {
            "$set": {
                "status": "completed",
                "pageCount": len(discovered_urls),
                "rawResultsRef": str(crawl_result_id),
                "completedAt": datetime.datetime.utcnow()
            }
        }
    )
    
    log_json(
        "INFO",
        "migration_check_finished",
        crawlJobId=crawl_job_id,
        pagesChecked=len(discovered_urls),
        issuesFound=len(issues_to_create),
        rawResultsRef=str(crawl_result_id)
    )
    
    return str(crawl_result_id), len(discovered_urls)
