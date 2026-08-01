import os
import re
import io
import json
import zipfile
import datetime
from bson import ObjectId
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Optional
from urllib.parse import urljoin, urlparse
import httpx
from bs4 import BeautifulSoup

# ─── Helper: Normalized Extension & Content Type ─────────────────────────────

DOC_EXTENSIONS = {
    '.pdf': 'pdf',
    '.docx': 'docx',
    '.doc': 'docx',
    '.xlsx': 'xlsx',
    '.xls': 'xlsx',
    '.csv': 'xlsx',
    '.pptx': 'pptx',
    '.ppt': 'pptx',
}

IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico', '.bmp'}
VIDEO_EXTENSIONS = {'.mp4', '.webm', '.ogg', '.m4v', '.mov', '.avi', '.mkv'}

# ─── 0. PageContent Detection & Cataloging ──────────────────────────────────

def detect_page_contents(page_url: str, html_content: str, project_id: Any, crawl_job_id: Any) -> List[Dict[str, Any]]:
    """
    Scans a crawled page's HTML to detect and catalog all present content items:
      - 'text': the page's own text content
      - 'image': <img> tags with src and altText
      - 'video': <video> tags and embedded YouTube/Vimeo/Wistia iframes
      - 'pdf', 'docx', 'pptx', 'xlsx': linked files matching target extensions
    Returns a list of PageContent dictionary records with extractionStatus: 'pending'.
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    records = []

    p_id = ObjectId(project_id) if isinstance(project_id, str) and len(project_id) == 24 else project_id
    c_id = ObjectId(crawl_job_id) if isinstance(crawl_job_id, str) and len(crawl_job_id) == 24 else crawl_job_id
    now = datetime.datetime.now(datetime.timezone.utc)

    # 1. Page's own text content record
    records.append({
        "projectId": p_id,
        "crawlJobId": c_id,
        "pageUrl": page_url,
        "contentType": "text",
        "sourceUrl": page_url,
        "extractionStatus": "pending",
        "createdAt": now,
    })

    # 2. <img> tags
    for img in soup.find_all('img'):
        src = img.get('src') or img.get('data-src') or ''
        if not src:
            continue
        abs_src = urljoin(page_url, src)
        alt = img.get('alt')
        records.append({
            "projectId": p_id,
            "crawlJobId": c_id,
            "pageUrl": page_url,
            "contentType": "image",
            "sourceUrl": abs_src,
            "altText": alt.strip() if alt is not None else None,
            "extractionStatus": "pending",
            "createdAt": now,
        })

    # 3. <video> tags & iframe video embeds
    for vid in soup.find_all('video'):
        src = vid.get('src') or ''
        sources = [urljoin(page_url, s.get('src')) for s in vid.find_all('source') if s.get('src')]
        v_url = urljoin(page_url, src) if src else (sources[0] if sources else page_url)
        records.append({
            "projectId": p_id,
            "crawlJobId": c_id,
            "pageUrl": page_url,
            "contentType": "video",
            "sourceUrl": v_url,
            "extractionStatus": "pending",
            "createdAt": now,
        })

    for iframe in soup.find_all('iframe'):
        iframe_src = iframe.get('src') or ''
        if not iframe_src:
            continue
        abs_iframe = urljoin(page_url, iframe_src)
        lower_src = abs_iframe.lower()
        if any(provider in lower_src for provider in ['youtube.com', 'youtu.be', 'vimeo.com', 'wistia.com']):
            records.append({
                "projectId": p_id,
                "crawlJobId": c_id,
                "pageUrl": page_url,
                "contentType": "video",
                "sourceUrl": abs_iframe,
                "extractionStatus": "pending",
                "createdAt": now,
            })

    # 4. Document links (.pdf, .docx, .pptx, .xlsx)
    seen_doc_urls = set()
    for tag in soup.find_all(['a', 'object', 'embed']):
        href = tag.get('href') or tag.get('data') or tag.get('src') or ''
        if not href:
            continue
        abs_url = urljoin(page_url, href)
        parsed = urlparse(abs_url)
        ext = os.path.splitext(parsed.path)[1].lower()

        if ext in DOC_EXTENSIONS and abs_url not in seen_doc_urls:
            seen_doc_urls.add(abs_url)
            records.append({
                "projectId": p_id,
                "crawlJobId": c_id,
                "pageUrl": page_url,
                "contentType": DOC_EXTENSIONS[ext],
                "sourceUrl": abs_url,
                "extractionStatus": "pending",
                "createdAt": now,
            })

    return records

# ─── 1. Content Inventory ───────────────────────────────────────────────────

def inventory_content(page_url: str, html_content: str, soup: Optional[BeautifulSoup] = None) -> Dict[str, Any]:
    """
    Analyzes HTML content to build a complete content type inventory:
      - text: word count, headings hierarchy (H1-H6), body text length
      - images: <img>, <picture>, <svg> tags with src, alt, format
      - videos: <video>, <track>, <iframe> (YouTube, Vimeo, Wistia)
      - documents: <a href>, <object>, <embed> pointing to PDF, DOCX, XLSX, PPTX
    """
    if not soup:
        soup = BeautifulSoup(html_content, 'html.parser')

    # Remove script and style elements for clean text extraction
    for script_or_style in soup(['script', 'style', 'noscript', 'head', 'title']):
        script_or_style.decompose()

    # 1. Text Analysis
    text_content = soup.get_text(separator=' ', strip=True)
    words = re.findall(r'\b\w+\b', text_content)
    word_count = len(words)

    headings = []
    for level in range(1, 7):
        for h in soup.find_all(f'h{level}'):
            txt = h.get_text(strip=True)
            if txt:
                headings.append({'level': level, 'text': txt[:150]})

    text_info = {
        'wordCount': word_count,
        'characterCount': len(text_content),
        'headingCount': len(headings),
        'headings': headings,
        'hasH1': any(h['level'] == 1 for h in headings),
        'h1Count': sum(1 for h in headings if h['level'] == 1),
    }

    # 2. Image Inventory
    images = []
    for img in soup.find_all('img'):
        src = img.get('src') or img.get('data-src') or ''
        if not src:
            continue
        abs_src = urljoin(page_url, src)
        alt = img.get('alt')
        has_alt = alt is not None
        alt_text = (alt or '').strip()
        is_empty_alt = has_alt and len(alt_text) == 0

        # Extract file extension/format
        parsed_path = urlparse(abs_src).path
        ext = os.path.splitext(parsed_path)[1].lower()
        img_format = ext[1:] if ext else 'unknown'

        images.append({
            'src': abs_src,
            'alt': alt_text,
            'hasAlt': has_alt,
            'isEmptyAlt': is_empty_alt,
            'missingAlt': not has_alt,
            'format': img_format,
            'width': img.get('width'),
            'height': img.get('height'),
        })

    # SVG count
    svg_count = len(soup.find_all('svg'))

    # 3. Video Inventory
    videos = []
    # HTML5 <video> elements
    for vid in soup.find_all('video'):
        src = vid.get('src') or ''
        sources = [urljoin(page_url, s.get('src')) for s in vid.find_all('source') if s.get('src')]
        tracks = []
        for track in vid.find_all('track'):
            t_src = track.get('src')
            if t_src:
                tracks.append({
                    'src': urljoin(page_url, t_src),
                    'kind': track.get('kind', 'subtitles'),
                    'label': track.get('srclang', 'en')
                })

        videos.append({
            'type': 'html5',
            'src': urljoin(page_url, src) if src else (sources[0] if sources else ''),
            'sources': sources,
            'hasTranscript': len(tracks) > 0,
            'tracks': tracks,
        })

    # Embedded video iframes (YouTube, Vimeo, Wistia)
    for iframe in soup.find_all('iframe'):
        iframe_src = iframe.get('src') or ''
        abs_iframe = urljoin(page_url, iframe_src)
        lower_src = abs_iframe.lower()

        if 'youtube.com' in lower_src or 'youtu.be' in lower_src:
            video_id = extract_youtube_id(abs_iframe)
            videos.append({
                'type': 'youtube',
                'src': abs_iframe,
                'videoId': video_id,
                'hasTranscript': True, # YouTube has transcript via API/captions
            })
        elif 'vimeo.com' in lower_src:
            videos.append({
                'type': 'vimeo',
                'src': abs_iframe,
                'hasTranscript': False,
            })
        elif 'wistia.com' in lower_src:
            videos.append({
                'type': 'wistia',
                'src': abs_iframe,
                'hasTranscript': False,
            })

    # 4. Document Links Inventory (PDF, DOCX, XLSX, PPTX)
    documents = []
    seen_doc_urls = set()

    for tag in soup.find_all(['a', 'object', 'embed']):
        href = tag.get('href') or tag.get('data') or tag.get('src') or ''
        if not href:
            continue
        abs_url = urljoin(page_url, href)
        parsed = urlparse(abs_url)
        ext = os.path.splitext(parsed.path)[1].lower()

        if ext in DOC_EXTENSIONS and abs_url not in seen_doc_urls:
            seen_doc_urls.add(abs_url)
            doc_type = DOC_EXTENSIONS[ext]
            link_text = tag.get_text(strip=True) if tag.name == 'a' else ''

            documents.append({
                'url': abs_url,
                'type': doc_type,
                'extension': ext,
                'anchorText': link_text,
                'tagName': tag.name,
            })

    return {
        'pageUrl': page_url,
        'text': text_info,
        'images': images,
        'svgCount': svg_count,
        'imageCount': len(images),
        'videos': videos,
        'videoCount': len(videos),
        'documents': documents,
        'documentCount': len(documents),
    }

def extract_youtube_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from URL or iframe src."""
    match = re.search(r'(?:embed\/|v\/|watch\?v=|youtu\.be\/|\/v=)([^#\&\?]{11})', url)
    return match.group(1) if match else None

# ─── 2. Async Asset Downloader ────────────────────────────────────────────────

async def download_asset(asset_url: str, storage_dir: str) -> Optional[Dict[str, Any]]:
    """
    Asynchronously downloads a binary asset to disk storage using httpx.
    Returns metadata object with path, file size, content-type.
    """
    try:
        os.makedirs(storage_dir, exist_ok=True)
        filename = f"{int(os.urandom(4).hex(), 16)}_{os.path.basename(urlparse(asset_url).path) or 'asset'}"
        filePath = os.path.join(storage_dir, filename)

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            res = await client.get(asset_url, headers={
                'User-Agent': 'RankEngine-SEO-Worker/1.0 (Asset Ingestion)'
            })
            if res.status_code == 200:
                content = res.content
                with open(filePath, 'wb') as f:
                    f.write(content)

                return {
                    'url': asset_url,
                    'filePath': filePath,
                    'fileSize': len(content),
                    'contentType': res.headers.get('content-type', ''),
                    'contentBuffer': content,
                }
    except Exception as e:
        print(f"[ContentExtractor] Asset download failed for {asset_url}: {e}")
    return None

# ─── 3. PDF Structured Data Extraction ────────────────────────────────────────

def extract_pdf_structured_data(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Extracts structured data from PDF bytes:
      - Title, Author, Subject, Keywords catalog metadata
      - Text content & paragraph lines
      - Table structures (detects grid rows/columns)
      - Embedded image count
      - Page count
    """
    text_chunks = []
    tables = []
    metadata = {}
    page_count = 0
    image_count = 0

    # Try pypdf library if available
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        page_count = len(reader.pages)

        # Extract metadata
        if reader.metadata:
            metadata = {
                'title': (reader.metadata.title or '').strip(),
                'author': (reader.metadata.author or '').strip(),
                'subject': (reader.metadata.subject or '').strip(),
                'keywords': (reader.metadata.get('/Keywords') or '').strip(),
            }

        for idx, page in enumerate(reader.pages):
            page_text = page.extract_text() or ''
            if page_text.strip():
                text_chunks.append(page_text)

            if hasattr(page, 'images') and page.images:
                image_count += len(page.images)

            lines = page_text.split('\n')
            table_rows = []
            for line in lines:
                cells = re.split(r'\s{2,}|\t', line.strip())
                if len(cells) >= 2:
                    table_rows.append(cells)
            if len(table_rows) >= 2:
                tables.append({'page': idx + 1, 'rows': table_rows[:20]})

    except Exception:
        # Pure-python fallback parsing for PDF stream objects
        raw_str = pdf_bytes.decode('latin-1', errors='ignore')
        page_count = len(re.findall(r'/Type\s*/Page\b', raw_str)) or 1

        title_match = re.search(r'/Title\s*\(([^)]+)\)', raw_str)
        if title_match:
            metadata['title'] = title_match.group(1).strip()

        text_matches = re.findall(r'\(([^)]+)\)\s*Tj', raw_str)
        if text_matches:
            text_chunks.append(' '.join(text_matches))

        image_count = len(re.findall(r'/Subtype\s*/Image', raw_str))

    combined_text = '\n\n'.join(text_chunks).strip()
    words = re.findall(r'\b\w+\b', combined_text)

    return {
        'pageCount': page_count,
        'metadata': metadata,
        'hasTitle': bool(metadata.get('title')),
        'title': metadata.get('title', ''),
        'text': combined_text,
        'wordCount': len(words),
        'isScannedOnly': len(words) < 10 and page_count > 0,
        'tables': tables,
        'tableCount': len(tables),
        'imageCount': image_count,
    }

# ─── 4. DOCX Text Extraction ──────────────────────────────────────────────────

def extract_docx_text(docx_bytes: bytes) -> Dict[str, Any]:
    """
    Extracts text, headings, and metadata from DOCX bytes using pure-Python zipfile parsing.
    """
    text_chunks = []
    headings = []
    title = ''

    try:
        with zipfile.ZipFile(io.BytesIO(docx_bytes)) as z:
            if 'word/document.xml' in z.namelist():
                xml_content = z.read('word/document.xml')
                root = ET.fromstring(xml_content)

                for elem in root.iter():
                    tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                    if tag_name == 't' and elem.text and elem.text.strip():
                        text_chunks.append(elem.text.strip())

            if 'docProps/core.xml' in z.namelist():
                core_xml = z.read('docProps/core.xml')
                c_root = ET.fromstring(core_xml)
                for elem in c_root.iter():
                    tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                    if tag_name == 'title' and elem.text and elem.text.strip():
                        title = elem.text.strip()
    except Exception as e:
        print(f"[ContentExtractor] DOCX extraction error: {e}")

    combined_text = '\n'.join(text_chunks)
    words = re.findall(r'\b\w+\b', combined_text)

    return {
        'title': title,
        'hasTitle': bool(title),
        'text': combined_text,
        'wordCount': len(words),
        'headings': headings,
        'paragraphCount': len(text_chunks),
    }

# ─── 5. XLSX Data Extraction ──────────────────────────────────────────────────

def extract_xlsx_data(xlsx_bytes: bytes) -> Dict[str, Any]:
    """
    Extracts sheet names, cell text, and metadata from XLSX bytes using pure-Python zipfile parsing.
    """
    sheet_names = []
    text_chunks = []
    title = ''

    try:
        with zipfile.ZipFile(io.BytesIO(xlsx_bytes)) as z:
            if 'xl/workbook.xml' in z.namelist():
                wb_xml = z.read('xl/workbook.xml')
                w_root = ET.fromstring(wb_xml)
                for elem in w_root.iter():
                    tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                    if tag_name == 'sheet':
                        name = elem.get('name')
                        if name:
                            sheet_names.append(name)

            if 'xl/sharedStrings.xml' in z.namelist():
                ss_xml = z.read('xl/sharedStrings.xml')
                ss_root = ET.fromstring(ss_xml)
                for elem in ss_root.iter():
                    tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                    if tag_name == 't' and elem.text and elem.text.strip():
                        text_chunks.append(elem.text.strip())

            if 'docProps/core.xml' in z.namelist():
                core_xml = z.read('docProps/core.xml')
                c_root = ET.fromstring(core_xml)
                for elem in c_root.iter():
                    tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                    if tag_name == 'title' and elem.text and elem.text.strip():
                        title = elem.text.strip()
    except Exception as e:
        print(f"[ContentExtractor] XLSX extraction error: {e}")

    combined_text = ' '.join(text_chunks)
    words = re.findall(r'\b\w+\b', combined_text)

    return {
        'title': title,
        'hasTitle': bool(title),
        'sheetNames': sheet_names,
        'sheetCount': len(sheet_names),
        'text': combined_text,
        'wordCount': len(words),
    }

# ─── 6. PPTX Text Extraction ──────────────────────────────────────────────────

def extract_pptx_text(pptx_bytes: bytes) -> Dict[str, Any]:
    """
    Extracts slide text, slide count, and metadata from PPTX bytes using pure-Python zipfile parsing.
    """
    text_chunks = []
    slide_count = 0
    title = ''

    try:
        with zipfile.ZipFile(io.BytesIO(pptx_bytes)) as z:
            slide_files = [f for f in z.namelist() if f.startswith('ppt/slides/slide') and f.endswith('.xml')]
            slide_count = len(slide_files)

            for sf in slide_files:
                s_xml = z.read(sf)
                s_root = ET.fromstring(s_xml)
                for elem in s_root.iter():
                    tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                    if tag_name == 't' and elem.text and elem.text.strip():
                        text_chunks.append(elem.text.strip())

            if 'docProps/core.xml' in z.namelist():
                core_xml = z.read('docProps/core.xml')
                c_root = ET.fromstring(core_xml)
                for elem in c_root.iter():
                    tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                    if tag_name == 'title' and elem.text and elem.text.strip():
                        title = elem.text.strip()
    except Exception as e:
        print(f"[ContentExtractor] PPTX extraction error: {e}")

    combined_text = ' '.join(text_chunks)
    words = re.findall(r'\b\w+\b', combined_text)

    return {
        'title': title,
        'hasTitle': bool(title),
        'slideCount': slide_count,
        'text': combined_text,
        'wordCount': len(words),
    }

# ─── 7. Video Transcript & Caption Extraction ─────────────────────────────────

async def extract_video_transcript(video_info: Dict[str, Any], html_content: str) -> Dict[str, Any]:
    """
    Extracts transcript / caption text where available:
      - HTML5 <video>: fetches WebVTT / SRT subtitle files if <track> present
      - YouTube embeds: fetches YouTube captions via timedtext endpoint
      - Missing transcript: flags hasTranscript=False (to feed SEO/accessibility audit finding)
    """
    v_type = video_info.get('type')
    transcript_text = ''
    has_transcript = False

    # HTML5 <track> captions
    if v_type == 'html5' and video_info.get('tracks'):
        track_url = video_info['tracks'][0]['src']
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(track_url)
                if res.status_code == 200:
                    vtt_content = res.text
                    cleaned = re.sub(r'\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}', '', vtt_content)
                    cleaned = re.sub(r'<[^>]+>', '', cleaned)
                    cleaned = re.sub(r'WEBVTT|NOTE.*?\n', '', cleaned)
                    transcript_text = ' '.join(cleaned.split())
                    has_transcript = len(transcript_text) > 20
        except Exception:
            pass

    # YouTube captions API
    elif v_type == 'youtube' and video_info.get('videoId'):
        v_id = video_info['videoId']
        try:
            timedtext_url = f"https://www.youtube.com/api/timedtext?v={v_id}&lang=en"
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(timedtext_url)
                if res.status_code == 200 and res.text.strip():
                    y_root = ET.fromstring(res.text)
                    texts = [text_node.text for text_node in y_root.iter() if (elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag) == 'text' and text_node.text]
                    if texts:
                        transcript_text = ' '.join(texts)
                        has_transcript = True
        except Exception:
            pass

    return {
        'videoType': v_type,
        'src': video_info.get('src', ''),
        'hasTranscript': has_transcript,
        'transcriptText': transcript_text if has_transcript else None,
    }
