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
        "wordCount": word_count
    }

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

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        # Load Robots.txt using browser context
        try:
            robots_url = urljoin(start_url, '/robots.txt')
            context = await browser.new_context()
            page = await context.new_page()
            response = await page.goto(robots_url, timeout=10000)
            if response and response.status < 400:
                robots_txt = await response.text()
                robots_parser.parse(robots_txt.splitlines())
                robots_loaded = True
                log_json("INFO", "robots_loaded", crawlJobId=crawl_job_id, url=robots_url)
            else:
                log_json("INFO", "robots_missing", crawlJobId=crawl_job_id, url=robots_url)
            await page.close()
            await context.close()
        except Exception as e:
            log_json("WARNING", "robots_load_failed", crawlJobId=crawl_job_id, error=str(e))

        async def worker():
            while True:
                try:
                    # Get next url to crawl
                    url = await queue.get()
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
                        
                        # Extract internal links from page HTML to follow
                        if "html" in page_data:
                            # Keep the HTML until issue aggregation so JSON-LD can be
                            # validated. It is removed before the CrawlResult is saved.
                            html = page_data["html"]
                            soup = BeautifulSoup(html, 'html.parser')
                            for anchor in soup.find_all('a', href=True):
                                raw_href = anchor['href']
                                resolved_href = urljoin(url, raw_href)
                                
                                # Strip query parameters & fragments to prevent duplicate pages
                                clean_url = resolved_href.split('#')[0].split('?')[0].rstrip('/')
                                
                                if clean_url.startswith(('http://', 'https://')):
                                    if clean_url not in visited_urls and is_internal_link(clean_url, target_hostname):
                                        visited_urls.add(clean_url)
                                        await queue.put(clean_url)

                queue.task_done()

        # Seed visited set with initial url
        visited_urls.add(start_url.split('#')[0].split('?')[0].rstrip('/'))

        # Create workers to run concurrently
        workers = [asyncio.create_task(worker()) for _ in range(max_concurrency)]

        # Run until the queue is completely empty
        while not queue.empty() and len(crawled_pages) < limit:
            await asyncio.sleep(0.5)

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

    # Clean raw html strings from crawled pages list before saving to database
    for p in crawled_pages:
        if "html" in p:
            del p["html"]

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

        # Check structured schema issues and opportunities
        html = page.get("html")
        if html:
            from schema_validator import validate_json_ld
            try:
                schema_issues = validate_json_ld(html, url, crawl_job_id)
                for schema_issue in schema_issues:
                    if schema_issue.get("severity") == "passed":
                        description = schema_issue.get("description", "Valid structured data")
                        schema_passed_counts[description] = schema_passed_counts.get(description, 0) + 1
                    else:
                        issues.append(schema_issue)
            except Exception as e:
                log_json("ERROR", "schema_validation_error", url=url, error=str(e))

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
    page = None

    for attempt in range(max_retries + 1):
        try:
            context = await browser.new_context()
            page = await context.new_page()

            # Set a standard 15-second navigation timeout limit
            response = await page.goto(url, timeout=15000)
            
            status_code = response.status if response else 0
            html = await page.content()

            # Retry Trigger 1: Status Code 429
            if status_code == 429:
                raise IOError(f"HTTP Status 429 Too Many Requests")

            # Retry Trigger 2: CAPTCHA block detected in source code
            if is_captcha_present(html):
                raise IOError("CAPTCHA challenge block detected on page")

            # Success: Parse page SEO data
            seo_data = extract_seo_data(html, url, status_code)
            seo_data["html"] = html  # Attach html temp to extract links

            await page.close()
            await context.close()
            return seo_data

        except (PlaywrightTimeoutError, IOError, Exception) as e:
            # Cleanup current context on failure
            if page:
                await page.close()
            if context:
                await context.close()

            # Check if we should retry
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
