from typing import Dict, Any, List
from bson import ObjectId

def audit_content_inventory(inventory: Dict[str, Any], crawl_job_id: str) -> List[Dict[str, Any]]:
    """
    Audits a page's content inventory (text, images, videos, documents) and generates
    structured AuditIssue dictionary records that feed directly into the Phase 1 action items pipeline.
    """
    issues = []
    page_url = inventory.get('pageUrl', 'N/A')
    c_job_id = ObjectId(crawl_job_id) if isinstance(crawl_job_id, str) and len(crawl_job_id) == 24 else crawl_job_id

    # 1. Text Content Audit
    text_info = inventory.get('text', {})
    word_count = text_info.get('wordCount', 0)
    has_h1 = text_info.get('hasH1', False)
    h1_count = text_info.get('h1Count', 0)

    if word_count < 300:
        issues.append({
            "crawlJobId": c_job_id,
            "url": page_url,
            "category": "content-quality",
            "severity": "warning",
            "description": f"Thin content: Page has only {word_count} words (below 300-word recommended threshold).",
            "whyItMatters": "Search engines prioritize comprehensive pages that thoroughly answer user intent. Thin content risks low rankings.",
            "recommendation": f"Expand page content on {page_url} to at least 300–500 words with structured headings and topic coverage.",
        })

    if not has_h1:
        issues.append({
            "crawlJobId": c_job_id,
            "url": page_url,
            "category": "heading-structure",
            "severity": "critical",
            "description": "Missing H1 tag: Page contains no main H1 heading.",
            "whyItMatters": "The H1 tag communicates the primary topic of the page to search engine crawlers and screen readers.",
            "recommendation": f"Add a single, descriptive H1 tag to {page_url} containing the primary target keyword.",
        })
    elif h1_count > 1:
        issues.append({
            "crawlJobId": c_job_id,
            "url": page_url,
            "category": "heading-structure",
            "severity": "warning",
            "description": f"Multiple H1 tags: Page contains {h1_count} H1 headings.",
            "whyItMatters": "Multiple H1 tags dilute keyword signals and confuse search engines regarding the main page title.",
            "recommendation": f"Consolidate H1 tags on {page_url} so there is exactly one H1, converting secondary titles to H2 or H3.",
        })

    # 2. Image Audit
    images = inventory.get('images', [])
    missing_alt_imgs = [img for img in images if img.get('missingAlt')]
    empty_alt_imgs = [img for img in images if img.get('isEmptyAlt')]

    if len(missing_alt_imgs) > 0:
        issues.append({
            "crawlJobId": c_job_id,
            "url": page_url,
            "category": "image-alt",
            "severity": "warning",
            "description": f"{len(missing_alt_imgs)} image(s) missing alt text attribute.",
            "whyItMatters": "Alt text helps image search indexing (Google Images) and is required for Web Content Accessibility Guidelines (WCAG).",
            "recommendation": f"Add descriptive alt text to all {len(missing_alt_imgs)} unlabelled images on {page_url}.",
        })

    # 3. Video Audit
    videos = inventory.get('videos', [])
    for video in videos:
        v_src = video.get('src', page_url)
        v_type = video.get('type', 'embed')
        has_transcript = video.get('hasTranscript', False)

        if not has_transcript:
            issues.append({
                "crawlJobId": c_job_id,
                "url": page_url,
                "category": "video-transcript",
                "severity": "warning",
                "description": f"Video missing transcript or captions ({v_type} video: {v_src[:60]}).",
                "whyItMatters": "Search engine crawlers cannot process audio/video streams without written transcripts or closed captions.",
                "recommendation": f"Add a WebVTT/SRT caption file or inline text transcript for the video on {page_url}.",
            })

    # 4. Document Audit (PDF, DOCX, XLSX, PPTX)
    documents = inventory.get('documents', [])
    for doc in documents:
        doc_url = doc.get('url', page_url)
        doc_type = doc.get('type', 'document').upper()
        extracted = doc.get('extracted', {})
        has_title = extracted.get('hasTitle', True)
        is_scanned = extracted.get('isScannedOnly', False)
        file_size = doc.get('fileSize', 0)

        # Missing Title Metadata
        if not has_title:
            issues.append({
                "crawlJobId": c_job_id,
                "url": doc_url,
                "category": f"{doc_type.lower()}-metadata",
                "severity": "warning",
                "description": f"{doc_type} document missing Title metadata property ({doc_url[:70]}).",
                "whyItMatters": "Search engines display the document Title property as the snippet heading in search results.",
                "recommendation": f"Set a descriptive Title document property for the {doc_type} file linked from {page_url}.",
            })

        # Scanned PDF Accessibility
        if doc_type == 'PDF' and is_scanned:
            issues.append({
                "crawlJobId": c_job_id,
                "url": doc_url,
                "category": "pdf-accessibility",
                "severity": "warning",
                "description": f"PDF appears to be scanned image-only with no extractable text ({doc_url[:70]}).",
                "whyItMatters": "Search engines and screen readers cannot index image-only PDFs without OCR text layers.",
                "recommendation": f"Run Optical Character Recognition (OCR) on {doc_url} to make text searchable and indexable.",
            })

        # Large File Size (> 10MB for PDF, > 15MB for Office docs)
        max_size = 10 * 1024 * 1024 if doc_type == 'PDF' else 15 * 1024 * 1024
        if file_size > max_size:
            size_mb = round(file_size / (1024 * 1024), 1)
            issues.append({
                "crawlJobId": c_job_id,
                "url": doc_url,
                "category": f"{doc_type.lower()}-performance",
                "severity": "warning",
                "description": f"Large {doc_type} file size ({size_mb} MB exceeds recommended limit).",
                "whyItMatters": "Large document downloads cause slow mobile load times and consume user bandwidth.",
                "recommendation": f"Compress images and embedded objects in {doc_url} to reduce file size below {max_size // (1024*1024)}MB.",
            })

    return issues
