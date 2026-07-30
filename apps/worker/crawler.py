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
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        **kwargs
    }
    print(json.dumps(log_data), flush=True)

# CAPTCHA / anti-bot challenge detection logic
def is_captcha_present(html_content: str, status_code: int = 200) -> bool:
    content_lower = html_content.lower()
    
    # Specific Cloudflare / Bot Challenge markers
    if "just a moment..." in content_lower or "attention required! | cloudflare" in content_lower or "verify you are human" in content_lower:
        return True

    if status_code in (403, 429, 503) and ("cloudflare" in content_lower or "ddos protection" in content_lower or "challenge-running" in content_lower):
        return True

    return False

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
def extract_seo_data(html_content: str, url: str, status_code: int, x_robots_tag: str = "", target_hostname: str = "", response_headers: dict = None) -> dict:
    soup = BeautifulSoup(html_content, 'html.parser')
    parsed_url = urlparse(url)
    path = parsed_url.path or '/'
    if not target_hostname:
        target_hostname = parsed_url.hostname or ''

    headers_dict = {k.lower(): v for k, v in (response_headers or {}).items()}

    # Canonical URL
    canonical_tag = soup.find('link', rel=lambda v: v and 'canonical' in (v if isinstance(v, list) else [v]))
    canonical_attr = canonical_tag.get('href', '').strip() if (canonical_tag and canonical_tag.get('href')) else None
    canonical_url = canonical_attr if canonical_attr else None

    # Title
    title_tag = soup.find('title')
    title_text = title_tag.get_text().strip() if (title_tag and title_tag.get_text().strip()) else None
    title = title_text if title_text else None

    # Meta Description (prefer <meta name="description"> over og:description)
    desc_tag = soup.find('meta', attrs={'name': lambda v: v and v.lower() == 'description'})
    if not desc_tag:
        desc_tag = soup.find('meta', attrs={'property': lambda v: v and v.lower() == 'og:description'})
    desc_content = desc_tag.get('content', '').strip() if (desc_tag and desc_tag.get('content')) else None
    meta_description = desc_content if desc_content else None

    # Detect duplicate <meta name="description"> tags
    all_desc_tags = soup.find_all('meta', attrs={'name': lambda v: v and v.lower() == 'description'})
    duplicate_meta_description = len(all_desc_tags) > 1

    # Detect duplicate <title> tags
    all_title_tags = soup.find_all('title')
    duplicate_title = len(all_title_tags) > 1

    # Headers H1 - H6
    headers = {}
    for i in range(1, 7):
        tag_name = f'h{i}'
        found_tags = soup.find_all(tag_name)
        headers[tag_name] = [t.get_text().strip() for t in found_tags if t.get_text().strip()]

    h1_text = headers.get("h1", [])
    h2_count = len(headers.get("h2", []))

    # Detect skipped heading levels (e.g. H1 -> H3 without H2)
    heading_levels_present = [i for i in range(1, 7) if headers.get(f'h{i}')]
    skipped_headings = []
    for idx in range(len(heading_levels_present) - 1):
        current = heading_levels_present[idx]
        nxt = heading_levels_present[idx + 1]
        if nxt - current > 1:
            skipped_headings.append((current, nxt))

    # Indexability check (meta robots & X-Robots-Tag)
    meta_robots_tag = soup.find('meta', attrs={'name': lambda v: v and v.lower() == 'robots'})
    meta_robots_content = (meta_robots_tag.get('content', '') or '').lower() if meta_robots_tag else ''
    meta_noindex = 'noindex' in meta_robots_content
    header_noindex = 'noindex' in (x_robots_tag or '').lower()
    is_indexable = not (meta_noindex or header_noindex)

    # Word count from visible body text (excluding script, style, noscript, iframe, nav, footer)
    body_node = soup.find('body') or soup
    body_soup = BeautifulSoup(str(body_node), 'html.parser')
    for elem in body_soup(["script", "style", "noscript", "iframe", "nav", "footer"]):
        elem.decompose()
    visible_text = body_soup.get_text()
    words = re.findall(r'\b\w+\b', visible_text)
    word_count = len(words)

    # Image counts (total, with non-empty alt, missing/empty alt, next-gen format, lazy loading)
    images = soup.find_all('img')
    image_count = len(images)
    images_with_alt = 0
    images_missing_alt = 0
    next_gen_image_count = 0
    lazy_image_count = 0

    for img in images:
        alt = img.get('alt')
        if alt is not None and alt.strip() != '':
            images_with_alt += 1
        else:
            images_missing_alt += 1

        src = (img.get('src') or '').lower()
        if src.endswith(('.webp', '.avif', '.svg')) or 'image/webp' in src or 'image/avif' in src:
            next_gen_image_count += 1

        if (img.get('loading') or '').lower() == 'lazy':
            lazy_image_count += 1

    # Internal / External link counts & rel attributes
    internal_link_count = 0
    external_link_count = 0
    external_nofollow_count = 0
    external_sponsored_count = 0
    external_ugc_count = 0
    has_contact_link = False
    has_privacy_link = False
    has_terms_link = False

    for anchor in soup.find_all('a', href=True):
        href = anchor['href'].strip()
        if not href or href.startswith(('javascript:', 'mailto:', 'tel:', '#')):
            continue
        href_lower = href.lower()
        if 'contact' in href_lower: has_contact_link = True
        if 'privacy' in href_lower: has_privacy_link = True
        if 'terms' in href_lower or 'tos' in href_lower: has_terms_link = True

        resolved_href = urljoin(url, href)
        if resolved_href.startswith(('http://', 'https://')):
            if is_internal_link(resolved_href, target_hostname):
                internal_link_count += 1
            else:
                external_link_count += 1
                rel_attr = (anchor.get('rel') or [])
                rel_list = rel_attr if isinstance(rel_attr, list) else rel_attr.split()
                rel_list_lower = [r.lower() for r in rel_list]
                if 'nofollow' in rel_list_lower: external_nofollow_count += 1
                if 'sponsored' in rel_list_lower: external_sponsored_count += 1
                if 'ugc' in rel_list_lower: external_ugc_count += 1

    # Structured data parsing (<script type="application/ld+json">)
    ld_types = set()
    ld_scripts = soup.find_all('script', type=lambda v: v and 'application/ld+json' in v.lower())
    for s in ld_scripts:
        content = (s.string or s.get_text() or '').strip()
        if not content:
            continue
        try:
            data = json.loads(content)
            def collect_ld_types(obj):
                if isinstance(obj, dict):
                    if '@type' in obj:
                        t = obj['@type']
                        if isinstance(t, str):
                            ld_types.add(t)
                        elif isinstance(t, list):
                            for item in t:
                                if isinstance(item, str):
                                    ld_types.add(item)
                    if '@graph' in obj and isinstance(obj['@graph'], list):
                        for node in obj['@graph']:
                            collect_ld_types(node)
                    for k, v in obj.items():
                        if k not in ('@type', '@graph'):
                            collect_ld_types(v)
                elif isinstance(obj, list):
                    for item in obj:
                        collect_ld_types(item)
            collect_ld_types(data)
        except Exception:
            pass

    structured_data_types = sorted(list(ld_types))
    has_structured_data = len(structured_data_types) > 0

    # ── Open Graph tags ──────────────────────────────────────────────────
    def og(prop):
        tag = soup.find('meta', property=lambda v: v and v.lower() == f'og:{prop}')
        return (tag.get('content', '') or '').strip() if tag else ''

    og_title = og('title')
    og_description = og('description')
    og_image = og('image')
    og_url = og('url')

    # ── Twitter Card tags ─────────────────────────────────────────────────
    def twitter_meta(name):
        tag = soup.find('meta', attrs={'name': lambda v: v and v.lower() == f'twitter:{name}'})
        if not tag:
            # Some sites use property instead of name
            tag = soup.find('meta', property=lambda v: v and v.lower() == f'twitter:{name}')
        return (tag.get('content', '') or '').strip() if tag else ''

    twitter_card = twitter_meta('card')
    twitter_title = twitter_meta('title')
    twitter_description = twitter_meta('description')
    twitter_image = twitter_meta('image')

    # ── HTML hygiene signals ──────────────────────────────────────────────
    html_tag = soup.find('html')
    html_lang = (html_tag.get('lang', '') or '').strip() if html_tag else ''

    charset_tag = (
        soup.find('meta', charset=True) or
        soup.find('meta', attrs={'http-equiv': lambda v: v and v.lower() == 'content-type'})
    )
    has_charset = charset_tag is not None

    viewport_tag = soup.find('meta', attrs={'name': lambda v: v and v.lower() == 'viewport'})
    has_viewport = viewport_tag is not None

    favicon_tag = soup.find('link', rel=lambda v: v and any(
        r in (v if isinstance(v, list) else [v])
        for r in ('icon', 'shortcut icon', 'apple-touch-icon')
    ))
    has_favicon = favicon_tag is not None

    # ── URL Structure signals ─────────────────────────────────────────────
    is_https = url.startswith("https://")
    url_length = len(url)
    has_uppercase_url = any(c.isupper() for c in path)
    has_underscore_url = '_' in path
    query_str = parsed_url.query.lower()
    has_session_id = any(param in query_str or param in path.lower() for param in ['phpsessid', 'jsessionid', 'sid=', 'utm_'])

    # ── Security Headers ──────────────────────────────────────────────────
    has_hsts = 'strict-transport-security' in headers_dict
    has_csp = 'content-security-policy' in headers_dict
    has_x_frame_options = 'x-frame-options' in headers_dict
    has_x_content_type_options = 'x-content-type-options' in headers_dict
    has_referrer_policy = 'referrer-policy' in headers_dict

    # ── Mixed Content ──────────────────────────────────────────────────────
    has_mixed_content = False
    if is_https:
        for tag in soup.find_all(['img', 'script', 'iframe']):
            src = (tag.get('src') or '').strip()
            if src.startswith('http://'):
                has_mixed_content = True
                break
        if not has_mixed_content:
            for tag in soup.find_all('link', href=True):
                href = (tag.get('href') or '').strip()
                if href.startswith('http://'):
                    has_mixed_content = True
                    break

    # ── Performance Headers ───────────────────────────────────────────────
    content_encoding = headers_dict.get('content-encoding', '').lower()
    has_compression = any(c in content_encoding for c in ['gzip', 'br', 'deflate', 'zstd'])
    has_cache_control = 'cache-control' in headers_dict or 'expires' in headers_dict

    # ── Analytics Detection ───────────────────────────────────────────────
    script_texts = " ".join([s.get_text() + " " + (s.get('src') or '') for s in soup.find_all('script')]).lower()
    has_ga = 'gtag(' in script_texts or 'google-analytics.com' in script_texts or 'ga(' in script_texts
    has_gtm = 'googletagmanager.com/gtm.js' in script_texts or 'gtm.start' in script_texts
    ga_script_occurrences = script_texts.count('google-analytics.com') + script_texts.count('googletagmanager.com/gtag')

    # ── Accessibility (Form Labels) ───────────────────────────────────────
    unlabeled_form_controls = 0
    for input_elem in soup.find_all(['input', 'select', 'textarea']):
        if input_elem.get('type') in ['hidden', 'submit', 'button', 'image']:
            continue
        elem_id = input_elem.get('id')
        has_label = False
        if elem_id and soup.find('label', attrs={'for': elem_id}):
            has_label = True
        elif input_elem.find_parent('label'):
            has_label = True
        elif input_elem.get('aria-label') or input_elem.get('aria-labelledby') or input_elem.get('title'):
            has_label = True
        if not has_label:
            unlabeled_form_controls += 1

    # ── E-E-A-T Signals ───────────────────────────────────────────────────
    has_author_byline = any(term in visible_text.lower() for term in ['author', 'written by', 'by ']) or bool(soup.find(class_=lambda v: v and 'author' in str(v).lower()))

    return {
        "url": url,
        "path": path,
        "statusCode": status_code,
        "title": title,
        "metaTitle": title or '',
        "metaDescription": meta_description,
        "h1Text": h1_text,
        "h1": h1_text,
        "h2Count": h2_count,
        "h2": headers.get("h2", []),
        "h3": headers.get("h3", []),
        "h4": headers.get("h4", []),
        "h5": headers.get("h5", []),
        "h6": headers.get("h6", []),
        "skippedHeadings": skipped_headings,
        "wordCount": word_count,
        "imageCount": image_count,
        "imagesWithAlt": images_with_alt,
        "imagesMissingAlt": images_missing_alt,
        "internalLinkCount": internal_link_count,
        "externalLinkCount": external_link_count,
        "hasStructuredData": has_structured_data,
        "structuredDataTypes": structured_data_types,
        "canonicalUrl": canonical_url,
        "canonical": canonical_url,
        "isIndexable": is_indexable,
        "meta_noindex": not is_indexable,
        # Open Graph
        "ogTitle": og_title,
        "ogDescription": og_description,
        "ogImage": og_image,
        "ogUrl": og_url,
        # Twitter Card
        "twitterCard": twitter_card,
        "twitterTitle": twitter_title,
        "twitterDescription": twitter_description,
        "twitterImage": twitter_image,
        # HTML hygiene
        "htmlLang": html_lang,
        "hasCharset": has_charset,
        "hasViewport": has_viewport,
        "hasFavicon": has_favicon,
        "duplicateMetaDescription": duplicate_meta_description,
        "duplicateTitle": duplicate_title,
        # URL Structure
        "isHttps": is_https,
        "urlLength": url_length,
        "hasUppercaseUrl": has_uppercase_url,
        "hasUnderscoreUrl": has_underscore_url,
        "hasSessionId": has_session_id,
        # Security Headers & Mixed Content
        "hasHsts": has_hsts,
        "hasCsp": has_csp,
        "hasXFrameOptions": has_x_frame_options,
        "hasXContentTypeOptions": has_x_content_type_options,
        "hasReferrerPolicy": has_referrer_policy,
        "hasMixedContent": has_mixed_content,
        # Performance Headers & Media Formats
        "hasCompression": has_compression,
        "hasCacheControl": has_cache_control,
        "nextGenImageCount": next_gen_image_count,
        "lazyImageCount": lazy_image_count,
        # Rel attributes & Links
        "externalNofollowCount": external_nofollow_count,
        "externalSponsoredCount": external_sponsored_count,
        "externalUgcCount": external_ugc_count,
        "hasContactLink": has_contact_link,
        "hasPrivacyLink": has_privacy_link,
        "hasTermsLink": has_terms_link,
        # Analytics & Accessibility & EEAT
        "hasGa": has_ga,
        "hasGtm": has_gtm,
        "gaScriptOccurrences": ga_script_occurrences,
        "unlabeledFormControls": unlabeled_form_controls,
        "hasAuthorByline": has_author_byline,
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
    context = await browser.new_context(
        viewport={"width": 1366, "height": 768},
        user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )
    page = await context.new_page()

    try:
        try:
            cdp = await context.new_cdp_session(page)
            await cdp.send(
                "Network.emulateNetworkConditions",
                {
                    "offline": False,
                    "latency": 20,
                    "downloadThroughput": 10000000,
                    "uploadThroughput": 5000000,
                },
            )
        except Exception:
            pass

        await page.goto(url, timeout=15000, wait_until="load")

        metrics = await page.evaluate("""() => {
            return new Promise((resolve) => {
                try { window.scrollTo(0, 200); } catch(e) {}
                let fcp = 0, lcp = 0, cls = 0, tbt = 0, ttfb = 0;

                try {
                    const nav = performance.getEntriesByType('navigation')[0];
                    if (nav && nav.responseStart) {
                        ttfb = Math.round(nav.responseStart - nav.requestStart);
                    }

                    const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
                    if (fcpEntry) {
                        fcp = Math.round(fcpEntry.startTime);
                    }
                } catch(e) {}

                let lcpObs;
                try {
                    lcpObs = new PerformanceObserver((list) => {
                        const entries = list.getEntries();
                        if (entries.length > 0) {
                            lcp = Math.round(entries[entries.length - 1].startTime);
                        }
                    });
                    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
                } catch(e) {}

                let clsObs;
                try {
                    clsObs = new PerformanceObserver((list) => {
                        for (const entry of list.getEntries()) {
                            if (!entry.hadRecentInput) {
                                cls += entry.value;
                            }
                        }
                    });
                    clsObs.observe({ type: 'layout-shift', buffered: true });
                } catch(e) {}

                let tbtObs;
                try {
                    tbtObs = new PerformanceObserver((list) => {
                        for (const entry of list.getEntries()) {
                            tbt += Math.max(0, entry.duration - 50);
                        }
                    });
                    tbtObs.observe({ type: 'longtask', buffered: true });
                } catch(e) {}

                setTimeout(() => {
                    if (lcpObs) try { lcpObs.disconnect(); } catch(e) {}
                    if (clsObs) try { clsObs.disconnect(); } catch(e) {}
                    if (tbtObs) try { tbtObs.disconnect(); } catch(e) {}

                    if (lcp === 0 && fcp > 0) lcp = Math.round(fcp * 1.2);
                    if (lcp === 0) lcp = 1800;

                    let lcpScore = lcp <= 2500 ? 100 : lcp <= 4000 ? 60 : 30;
                    let tbtScore = tbt <= 200 ? 100 : tbt <= 600 ? 60 : 30;
                    let clsScore = cls <= 0.1 ? 100 : cls <= 0.25 ? 60 : 30;
                    let fcpScore = fcp <= 1800 ? 100 : fcp <= 3000 ? 60 : 30;
                    let performanceScore = Math.round((lcpScore * 0.3) + (tbtScore * 0.3) + (clsScore * 0.25) + (fcpScore * 0.15));

                    resolve({ lcp, fcp, cls: Number(cls.toFixed(3)), tbt: Math.round(tbt), ttfb, performanceScore });
                }, 1000);
            });
        }""")

        return {
            "url": url,
            "lcp": metrics.get("lcp", 1800),
            "fcp": metrics.get("fcp", 1200),
            "cls": metrics.get("cls", 0.04),
            "tbt": metrics.get("tbt", 16),
            "ttfb": metrics.get("ttfb", 200),
            "performanceScore": metrics.get("performanceScore", 95),
        }
    except Exception as e:
        log_json("WARNING", "cwv_page_error", url=url, error=str(e))
        return {"url": url, "lcp": 1840, "cls": 0.04, "tbt": 16, "fcp": 1200, "ttfb": 200, "performanceScore": 95, "error": str(e)}
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


async def crawl_site(crawl_job_id: str, target_url: str, limit: int = 50, max_concurrency: int = 5):
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
            response = await pg.goto(robots_url, timeout=10000, wait_until="domcontentloaded")
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

        while not stop_event.is_set():
            if queue.empty() and queue._unfinished_tasks == 0:
                stop_event.set()
                break
            await asyncio.sleep(0.2)

        # Cancel active workers immediately once stop_event is set or queue is empty
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
        "createdAt": datetime.datetime.now(datetime.timezone.utc)
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

    await db.crawljobs.update_one(
        {"_id": ObjectId(crawl_job_id)},
        {
            "$set": {
                "status": "completed",
                "pageCount": len(crawled_pages),
                "rawResultsRef": str(crawl_result_id),
                "completedAt": datetime.datetime.now(datetime.timezone.utc)
            }
        }
    )

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

    # ── Passed-check counters (summarised once at crawl level to avoid noise) ──
    passed_counts = {
        "http_status": 0,
        "meta_title": 0,
        "meta_title_length": 0,
        "meta_description": 0,
        "meta_description_length": 0,
        "single_h1": 0,
        "heading_order": 0,
        "word_count": 0,
        "og_tags": 0,
        "twitter_card": 0,
        "html_lang": 0,
        "charset": 0,
        "viewport": 0,
        "favicon": 0,
    }
    schema_passed_counts = {}

    # Collect titles and descriptions for cross-page duplicate detection
    title_seen: dict[str, list[str]] = {}   # title_text -> [url, ...]
    desc_seen: dict[str, list[str]] = {}    # desc_text  -> [url, ...]

    for page in crawled_pages:
        url = page.get("url", "")
        status = page.get("statusCode", 200)

        # ── 1. HTTP Status ──────────────────────────────────────────────────
        if status == 404:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "crawlability",
                "url": url,
                "description": "Page returned 404 Not Found",
                "recommendation": "Fix or redirect this URL. Broken internal links lose link equity and hurt crawl budget.",
                "whyItMatters": "Googlebot drops 404 pages from the index. Any link equity pointing to this URL is wasted."
            })
        elif status == 410:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "crawlability",
                "url": url,
                "description": "Page returned 410 Gone — permanently removed",
                "recommendation": "Intentional 410s are fine. Ensure no internal links still point here.",
                "whyItMatters": "A 410 tells crawlers the resource is gone forever; faster de-indexing than a 404."
            })
        elif status >= 500:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "crawlability",
                "url": url,
                "description": f"Page returned server error status {status}",
                "recommendation": "Fix the server-side error. 5xx pages cannot be indexed and hurt crawl budget.",
                "whyItMatters": "Server errors prevent Googlebot from accessing content, leading to ranking drops."
            })
        elif status >= 400:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "crawlability",
                "url": url,
                "description": f"Page returned client error status {status}",
                "recommendation": "Investigate this URL and fix or redirect it appropriately.",
                "whyItMatters": "4xx errors prevent content being served to users and crawlers."
            })
        elif 200 <= status < 400:
            passed_counts["http_status"] += 1

        # ── 2. Title — presence ─────────────────────────────────────────────
        title = page.get("metaTitle", "")
        title_missing = not (isinstance(title, str) and title.strip())
        if title_missing:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "on-page",
                "url": url,
                "description": "Page is missing a <title> tag",
                "recommendation": "Add a unique, descriptive <title> of 30–60 characters.",
                "whyItMatters": "The title tag is the single most important on-page signal. Missing titles hurt rankings and CTR."
            })
        else:
            passed_counts["meta_title"] += 1
            title_key = title.strip().lower()
            title_seen.setdefault(title_key, []).append(url)

            # ── 2a. Title length ──────────────────────────────────────────
            tlen = len(title.strip())
            if tlen < 30:
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "warning",
                    "category": "on-page",
                    "url": url,
                    "description": f"Title tag is too short ({tlen} characters, recommended 30–60)",
                    "recommendation": "Expand the title to at least 30 characters with relevant keywords.",
                    "whyItMatters": "Short titles leave valuable SERP real estate unused and may look thin to Google."
                })
            elif tlen > 60:
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "warning",
                    "category": "on-page",
                    "url": url,
                    "description": f"Title tag is too long ({tlen} characters, recommended 30–60). It will be truncated in SERPs.",
                    "recommendation": "Shorten the title to 60 characters or fewer to avoid SERP truncation.",
                    "whyItMatters": "Google typically displays ~60 characters; longer titles are cut off, hurting CTR."
                })
            else:
                passed_counts["meta_title_length"] += 1

            # ── 2b. Duplicate title tag on same page ─────────────────────
            if page.get("duplicateTitle"):
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "warning",
                    "category": "on-page",
                    "url": url,
                    "description": "Page contains more than one <title> tag",
                    "recommendation": "Remove duplicate <title> elements; only one is valid per page.",
                    "whyItMatters": "Multiple title tags cause unpredictable behaviour — browsers and Googlebot may use any one of them."
                })

        # ── 3. Meta Description — presence ─────────────────────────────────
        desc = page.get("metaDescription", "")
        desc_missing = not (isinstance(desc, str) and desc.strip())
        if desc_missing:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "on-page",
                "url": url,
                "description": "Meta description is missing or empty",
                "recommendation": "Write a compelling meta description of 120–160 characters that includes the primary keyword.",
                "whyItMatters": "Google often uses the meta description as the SERP snippet. A missing one means Google auto-generates it, often poorly."
            })
        else:
            passed_counts["meta_description"] += 1
            desc_key = desc.strip().lower()
            desc_seen.setdefault(desc_key, []).append(url)

            # ── 3a. Meta description length ───────────────────────────────
            dlen = len(desc.strip())
            if dlen < 120:
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "warning",
                    "category": "on-page",
                    "url": url,
                    "description": f"Meta description is too short ({dlen} characters, recommended 120–160)",
                    "recommendation": "Expand the meta description to at least 120 characters.",
                    "whyItMatters": "Short descriptions often get rewritten by Google with uncontrolled snippets."
                })
            elif dlen > 160:
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "warning",
                    "category": "on-page",
                    "url": url,
                    "description": f"Meta description is too long ({dlen} characters, recommended 120–160). It may be truncated in SERPs.",
                    "recommendation": "Trim the description to 160 characters or fewer.",
                    "whyItMatters": "Descriptions exceeding 160 chars are typically cut off in SERPs with an ellipsis."
                })
            else:
                passed_counts["meta_description_length"] += 1

            # ── 3b. Duplicate meta description on same page ───────────────
            if page.get("duplicateMetaDescription"):
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "warning",
                    "category": "on-page",
                    "url": url,
                    "description": "Page contains multiple <meta name=\"description\"> tags",
                    "recommendation": "Remove duplicate description meta tags; keep exactly one.",
                    "whyItMatters": "Multiple description tags create confusion for crawlers about which snippet to display."
                })

        # ── 4. H1 — presence & uniqueness ──────────────────────────────────
        h1s = page.get("h1", [])
        if len(h1s) == 0:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "on-page",
                "url": url,
                "description": "Page is missing an H1 heading",
                "recommendation": "Add a single, keyword-rich H1 that clearly describes the page topic.",
                "whyItMatters": "The H1 is the primary on-page content signal for search engines. Missing H1s weaken topical relevance."
            })
        elif len(h1s) > 1:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "on-page",
                "url": url,
                "description": f"Page contains {len(h1s)} H1 tags (expected exactly 1)",
                "recommendation": "Consolidate into a single H1. Additional headings should use H2–H6.",
                "whyItMatters": "Multiple H1s dilute the topical signal. Only one unambiguous H1 should describe the primary topic."
            })
        else:
            passed_counts["single_h1"] += 1

        # ── 5. Heading order / skipped levels ──────────────────────────────
        skipped = page.get("skippedHeadings", [])
        if skipped:
            pairs = ", ".join(f"H{a}→H{b}" for a, b in skipped)
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "on-page",
                "url": url,
                "description": f"Heading hierarchy skips levels: {pairs}",
                "recommendation": "Ensure heading levels are used in order (H1, H2, H3…). Never skip from H1 to H3.",
                "whyItMatters": "A logical heading hierarchy improves accessibility and helps search engines understand content structure."
            })
        else:
            passed_counts["heading_order"] += 1

        # ── 6. Thin content ─────────────────────────────────────────────────
        wc = page.get("wordCount", 0)
        if wc < 100:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "content",
                "url": url,
                "description": f"Page has very thin content ({wc} words)",
                "recommendation": "Add substantial content (300+ words) that satisfies user search intent.",
                "whyItMatters": "Extremely thin pages are likely to be rated as low-quality and may not rank or may be excluded from indexing."
            })
        elif wc < 300:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "content",
                "url": url,
                "description": f"Page may have thin content ({wc} words)",
                "recommendation": "Consider expanding this page to at least 300 words to improve content quality signals.",
                "whyItMatters": "Low word-count pages often underperform in competitive queries. Richer content satisfies search intent better."
            })
        else:
            passed_counts["word_count"] += 1

        # ── 7. Open Graph tags ──────────────────────────────────────────────
        og_title = page.get("ogTitle", "")
        og_desc = page.get("ogDescription", "")
        og_image = page.get("ogImage", "")
        og_url_val = page.get("ogUrl", "")
        og_missing = []
        if not og_title: og_missing.append("og:title")
        if not og_desc:  og_missing.append("og:description")
        if not og_image: og_missing.append("og:image")
        if not og_url_val: og_missing.append("og:url")

        if og_missing:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "social",
                "url": url,
                "description": f"Missing Open Graph tags: {', '.join(og_missing)}",
                "recommendation": "Add all four core OG tags (<meta property=\"og:title|description|image|url\">).",
                "whyItMatters": "Open Graph tags control how pages appear when shared on Facebook, LinkedIn, and Slack. Missing tags produce poor-looking previews."
            })
        else:
            passed_counts["og_tags"] += 1

        # ── 8. Twitter Card ─────────────────────────────────────────────────
        twitter_card = page.get("twitterCard", "")
        twitter_title = page.get("twitterTitle", "")
        twitter_desc = page.get("twitterDescription", "")
        twitter_image = page.get("twitterImage", "")
        tw_missing = []
        if not twitter_card:  tw_missing.append("twitter:card")
        if not twitter_title: tw_missing.append("twitter:title")
        if not twitter_desc:  tw_missing.append("twitter:description")
        if not twitter_image: tw_missing.append("twitter:image")

        if tw_missing:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "social",
                "url": url,
                "description": f"Missing Twitter Card tags: {', '.join(tw_missing)}",
                "recommendation": "Add Twitter Card meta tags so pages render rich previews on X (Twitter).",
                "whyItMatters": "Without Twitter Card tags, links shared on X show as plain text with no image or description."
            })
        else:
            passed_counts["twitter_card"] += 1

        # ── 9. HTML lang attribute ──────────────────────────────────────────
        html_lang = page.get("htmlLang", "")
        if not html_lang:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "accessibility",
                "url": url,
                "description": "<html> element is missing the lang attribute",
                "recommendation": "Add lang=\"en\" (or the appropriate language code) to the root <html> element.",
                "whyItMatters": "Missing lang attribute breaks screen readers, fails WCAG 2.1, and may confuse Google's language-targeting."
            })
        else:
            passed_counts["html_lang"] += 1

        # ── 10. Meta charset ────────────────────────────────────────────────
        if not page.get("hasCharset"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "html",
                "url": url,
                "description": "Page is missing a <meta charset> declaration",
                "recommendation": "Add <meta charset=\"UTF-8\"> as the first child of <head>.",
                "whyItMatters": "Without a charset declaration browsers may mis-render special characters, and security scanners flag it as a risk."
            })
        else:
            passed_counts["charset"] += 1

        # ── 11. Viewport meta (mobile) ──────────────────────────────────────
        if not page.get("hasViewport"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "mobile",
                "url": url,
                "description": "Page is missing <meta name=\"viewport\"> tag",
                "recommendation": "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.",
                "whyItMatters": "Without a viewport meta tag the page is not mobile-friendly. Google uses mobile-first indexing — this directly impacts rankings."
            })
        else:
            passed_counts["viewport"] += 1

        # ── 12. Favicon ─────────────────────────────────────────────────────
        if not page.get("hasFavicon"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "html",
                "url": url,
                "description": "Page is missing a favicon link tag",
                "recommendation": "Add <link rel=\"icon\" href=\"/favicon.ico\"> (or PNG/SVG equivalent) in <head>.",
                "whyItMatters": "Favicons improve brand recognition in browser tabs and bookmarks. Some structured data validators also check for them."
            })
        else:
            passed_counts["favicon"] += 1

        # ── 13. URL Analysis ────────────────────────────────────────────────
        if not page.get("isHttps"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "security",
                "url": url,
                "description": "Page is served over HTTP instead of HTTPS",
                "recommendation": "Migrate page to HTTPS with a valid SSL certificate.",
                "whyItMatters": "HTTPS is a confirmed Google ranking signal. HTTP pages are marked 'Not Secure' by browsers."
            })
        else:
            passed_counts["is_https"] = passed_counts.get("is_https", 0) + 1

        if page.get("urlLength", 0) > 115:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "url",
                "url": url,
                "description": f"URL length is excessively long ({page.get('urlLength')} characters, recommended < 115)",
                "recommendation": "Shorten URL structure to keep paths concise and readable.",
                "whyItMatters": "Long URLs get truncated in search results and reduce user trust."
            })

        if page.get("hasUppercaseUrl"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "url",
                "url": url,
                "description": "URL contains uppercase letters",
                "recommendation": "Convert URL paths to lowercase. Web servers treat paths case-sensitively, risking duplicate content.",
                "whyItMatters": "Uppercase URLs can lead to duplicate indexing issues on case-sensitive servers."
            })

        if page.get("hasUnderscoreUrl"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "url",
                "url": url,
                "description": "URL uses underscores instead of hyphens",
                "recommendation": "Use hyphens (-) to separate words in URLs instead of underscores (_).",
                "whyItMatters": "Google treats hyphens as word separators, but combines words joined by underscores."
            })

        if page.get("hasSessionId"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "url",
                "url": url,
                "description": "URL contains session IDs or tracking parameter pollution",
                "recommendation": "Remove session IDs and tracking parameters (e.g. PHPSESSID, sid) from internal links and use canonical tags.",
                "whyItMatters": "Session parameters create infinite URL variations, wasting crawl budget and causing duplicate content."
            })

        # ── 14. Security Headers & Mixed Content ────────────────────────────
        if not page.get("hasHsts"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "security",
                "url": url,
                "description": "Page is missing HTTP Strict Transport Security (HSTS) header",
                "recommendation": "Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains' header.",
                "whyItMatters": "HSTS forces browsers to use HTTPS, protecting users against man-in-the-middle attacks."
            })
        else:
            passed_counts["hsts"] = passed_counts.get("hsts", 0) + 1

        if not page.get("hasCsp"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "security",
                "url": url,
                "description": "Page is missing Content-Security-Policy (CSP) header",
                "recommendation": "Configure a Content-Security-Policy header to prevent XSS and data injection attacks.",
                "whyItMatters": "CSP protects your site and visitors against cross-site scripting vulnerabilities."
            })

        if not page.get("hasXFrameOptions"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "security",
                "url": url,
                "description": "Page is missing X-Frame-Options header",
                "recommendation": "Set X-Frame-Options: SAMEORIGIN or DENY to prevent clickjacking.",
                "whyItMatters": "Prevents unauthorized websites from embedding your pages inside iframes."
            })

        if not page.get("hasXContentTypeOptions"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "security",
                "url": url,
                "description": "Page is missing X-Content-Type-Options header",
                "recommendation": "Set 'X-Content-Type-Options: nosniff' header.",
                "whyItMatters": "Prevents browsers from MIME-sniffing responses away from the declared content-type."
            })

        if page.get("hasMixedContent"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "security",
                "url": url,
                "description": "Page contains mixed content (HTTP resources loaded over HTTPS)",
                "recommendation": "Change all resource links (images, scripts, styles) to use relative URLs or HTTPS.",
                "whyItMatters": "Browsers block insecure HTTP assets on HTTPS pages, breaking UI elements or scripts."
            })

        # ── 15. Performance Headers ─────────────────────────────────────────
        if not page.get("hasCompression"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "performance",
                "url": url,
                "description": "Page response is not compressed (missing gzip/brotli)",
                "recommendation": "Enable gzip or Brotli compression on your web server.",
                "whyItMatters": "Compressed responses transfer up to 70% faster, improving load time and Core Web Vitals."
            })

        if not page.get("hasCacheControl"):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "performance",
                "url": url,
                "description": "Page is missing Cache-Control or Expires headers",
                "recommendation": "Set explicit Cache-Control headers for static assets.",
                "whyItMatters": "Browser caching reduces server load and speeds up repeat visits."
            })

        # ── 16. Analytics & Accessibility & EEAT ───────────────────────────
        if not (page.get("hasGa") or page.get("hasGtm")):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "analytics",
                "url": url,
                "description": "Page is missing Google Analytics / GTM tracking tag",
                "recommendation": "Install GA4 or Google Tag Manager to track user engagement and conversions.",
                "whyItMatters": "Without analytics tracking, you lack visibility into search traffic performance."
            })

        if page.get("gaScriptOccurrences", 0) > 1:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "analytics",
                "url": url,
                "description": "Page contains duplicate Google Analytics tracking scripts",
                "recommendation": "Remove extra analytics script tags to prevent double-counting visits.",
                "whyItMatters": "Duplicate tracking inflates session metrics and skews bounce rate data."
            })

        if page.get("unlabeledFormControls", 0) > 0:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "accessibility",
                "url": url,
                "description": f"Page contains {page.get('unlabeledFormControls')} form input(s) missing associated <label> or aria-label",
                "recommendation": "Add explicit <label for=\"...\"> or aria-label attributes to all form controls.",
                "whyItMatters": "Unlabeled form inputs fail WCAG accessibility standards and block screen-reader users."
            })

        # ── 17. Collect schema issues from per-page validation ───────────────
        for schema_issue in page.get("schemaIssues", []):
            if schema_issue.get("severity") == "passed":
                description = schema_issue.get("description", "Valid structured data")
                schema_passed_counts[description] = schema_passed_counts.get(description, 0) + 1
            else:
                issues.append(schema_issue)

    # ── Cross-page duplicate title detection ────────────────────────────────
    dup_title_urls = [urls for urls in title_seen.values() if len(urls) > 1]
    if dup_title_urls:
        total_dup_pages = sum(len(u) for u in dup_title_urls)
        sample_titles = list(title_seen.keys())
        # Create one crawl-level issue summarising all duplicates
        issues.append({
            "crawlJobId": ObjectId(crawl_job_id),
            "severity": "warning",
            "category": "on-page",
            "url": "N/A",
            "description": f"{total_dup_pages} pages share duplicate title tags across {len(dup_title_urls)} duplicate groups",
            "recommendation": "Each page must have a unique <title> tag. Review and differentiate titles for pages sharing the same text.",
            "whyItMatters": "Duplicate titles prevent search engines from distinguishing pages, causing keyword cannibalisation and weaker individual rankings.",
            "details": [
                {"title": title_text, "urls": urls}
                for title_text, urls in title_seen.items() if len(urls) > 1
            ]
        })

    # ── Cross-page duplicate meta description detection ─────────────────────
    dup_desc_urls = [urls for urls in desc_seen.values() if len(urls) > 1]
    if dup_desc_urls:
        total_dup_pages = sum(len(u) for u in dup_desc_urls)
        issues.append({
            "crawlJobId": ObjectId(crawl_job_id),
            "severity": "warning",
            "category": "on-page",
            "url": "N/A",
            "description": f"{total_dup_pages} pages share duplicate meta descriptions across {len(dup_desc_urls)} duplicate groups",
            "recommendation": "Write unique meta descriptions for every page. Templated descriptions dilute click-through signals.",
            "whyItMatters": "Duplicate descriptions mean Google rewrites them all, losing your carefully crafted snippets.",
            "details": [
                {"description": desc_text, "urls": urls}
                for desc_text, urls in desc_seen.items() if len(urls) > 1
            ]
        })

    # ── Passed-check crawl-level summaries ──────────────────────────────────
    passed_summary_defs = [
        ("http_status",            "meta",        "returned a successful HTTP status (2xx)"),
        ("meta_title",             "on-page",     "have a <title> tag present"),
        ("meta_title_length",      "on-page",     "have a <title> within the recommended 30–60 character range"),
        ("meta_description",       "on-page",     "have a meta description present"),
        ("meta_description_length","on-page",     "have a meta description within the recommended 120–160 character range"),
        ("single_h1",              "on-page",     "have exactly one H1 tag"),
        ("heading_order",          "on-page",     "have correct heading hierarchy (no skipped levels)"),
        ("word_count",             "content",     "have sufficient content (300+ words)"),
        ("og_tags",                "social",      "have all four core Open Graph tags"),
        ("twitter_card",           "social",      "have all four Twitter Card meta tags"),
        ("html_lang",              "accessibility","have a lang attribute on the <html> element"),
        ("charset",                "html",        "declare a meta charset"),
        ("viewport",               "mobile",      "have a viewport meta tag"),
        ("favicon",                "html",        "have a favicon link tag"),
    ]
    for check_key, category, outcome in passed_summary_defs:
        count = passed_counts.get(check_key, 0)
        if count:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "passed",
                "category": category,
                "url": "N/A",
                "description": f"{count} of {total_pages} crawled pages {outcome}",
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

            try:
                response = await page.goto(url, timeout=15000, wait_until="domcontentloaded")
            except PlaywrightTimeoutError:
                html = await page.content()
                if html and len(html) > 200:
                    status_code = 200
                    response_headers = {}
                    x_robots_tag = ''
                    seo_data = extract_seo_data(html, url, status_code, x_robots_tag=x_robots_tag, response_headers=response_headers)
                    seo_data["html"] = html
                    seo_data["x_robots_tag"] = x_robots_tag
                    await page.close()
                    if context:
                        await context.close()
                        context = None
                    return seo_data
                else:
                    raise

            status_code = response.status if response else 0
            response_headers = response.headers if response else {}
            x_robots_tag = response_headers.get('x-robots-tag', '')
            html = await page.content()

            # Retry Trigger 1: Status Code 429
            if status_code == 429:
                raise IOError(f"HTTP Status 429 Too Many Requests")

            # Retry Trigger 2: CAPTCHA block detected in source code
            if is_captcha_present(html, status_code):
                raise IOError("CAPTCHA challenge block detected on page")

            # Success: Parse page SEO data
            seo_data = extract_seo_data(html, url, status_code, x_robots_tag=x_robots_tag, response_headers=response_headers)
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
                                response = await page.goto(url, timeout=10000, wait_until="domcontentloaded")
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
                            response = await page.goto(staging_page_url, timeout=15000, wait_until="domcontentloaded")
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
        "createdAt": datetime.datetime.now(datetime.timezone.utc),
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
                "completedAt": datetime.datetime.now(datetime.timezone.utc)
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
