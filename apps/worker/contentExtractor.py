import os
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse
import httpx

# Import helpers from content_extractor if present
try:
    from content_extractor import extract_pdf_structured_data
except ImportError:
    extract_pdf_structured_data = None

# ─── 1. Download Helper ───────────────────────────────────────────────────────

async def download_content_file(source_url: str, storage_dir: str) -> Dict[str, Any]:
    """
    Downloads a remote file asynchronously using httpx and saves to storage_dir.
    Returns dictionary with storagePath and buffer. Raises Exception on failure.
    """
    os.makedirs(storage_dir, exist_ok=True)
    parsed_path = urlparse(source_url).path
    filename = f"{int(os.urandom(4).hex(), 16)}_{os.path.basename(parsed_path) or 'content_file'}"
    storage_path = os.path.join(storage_dir, filename)

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        response = await client.get(source_url, headers={
            'User-Agent': 'RankEngine-SEO-Worker/1.0 (Content Extractor)'
        })
        if response.status_code != 200:
            raise Exception(f"HTTP download failed with status {response.status_code}")
        
        buffer = response.content
        if not buffer or len(buffer) == 0:
            raise Exception("Downloaded file content is empty (0 bytes)")
        
        with open(storage_path, 'wb') as f:
            f.write(buffer)

        return {
            "storagePath": storage_path,
            "buffer": buffer,
            "fileSize": len(buffer)
        }

# ─── 2. Extractor Functions ───────────────────────────────────────────────────

def extract_docx_content(buffer: bytes) -> str:
    """Extracts text from a DOCX buffer."""
    text_chunks = []
    with zipfile.ZipFile(io.BytesIO(buffer)) as z:
        if 'word/document.xml' not in z.namelist():
            raise Exception("Invalid DOCX format: missing word/document.xml")
        xml_content = z.read('word/document.xml')
        root = ET.fromstring(xml_content)
        for elem in root.iter():
            tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
            if tag_name == 't' and elem.text and elem.text.strip():
                text_chunks.append(elem.text.strip())
    
    extracted = '\n'.join(text_chunks).strip()
    if not extracted:
        raise Exception("DOCX contains no extractable text")
    return extracted

def extract_pptx_content(buffer: bytes) -> str:
    """Extracts text from a PPTX buffer with slide breaks noted."""
    slides_text = []
    with zipfile.ZipFile(io.BytesIO(buffer)) as z:
        slide_files = sorted([f for f in z.namelist() if f.startswith('ppt/slides/slide') and f.endswith('.xml')])
        if not slide_files:
            raise Exception("Invalid PPTX format: no slide XML streams found")
        
        for idx, sf in enumerate(slide_files, start=1):
            s_xml = z.read(sf)
            s_root = ET.fromstring(s_xml)
            slide_chunks = []
            for elem in s_root.iter():
                tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                if tag_name == 't' and elem.text and elem.text.strip():
                    slide_chunks.append(elem.text.strip())
            
            slide_str = ' '.join(slide_chunks).strip()
            slides_text.append(f"--- Slide {idx} ---\n{slide_str}")

    extracted = '\n\n'.join(slides_text).strip()
    return extracted

def extract_xlsx_content(buffer: bytes) -> List[Dict[str, Any]]:
    """
    Extracts spreadsheet data from an XLSX buffer into structured tables.
    Returns list of entries: [{ "sheetName": str, "headers": list, "rows": list }]
    """
    tables = []
    sheet_names = []
    shared_strings = []

    with zipfile.ZipFile(io.BytesIO(buffer)) as z:
        # Parse sharedStrings.xml
        if 'xl/sharedStrings.xml' in z.namelist():
            ss_xml = z.read('xl/sharedStrings.xml')
            ss_root = ET.fromstring(ss_xml)
            for elem in ss_root.iter():
                tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                if tag_name == 't' and elem.text:
                    shared_strings.append(elem.text.strip())

        # Parse workbook.xml for sheet names
        if 'xl/workbook.xml' in z.namelist():
            wb_xml = z.read('xl/workbook.xml')
            w_root = ET.fromstring(wb_xml)
            for elem in w_root.iter():
                tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                if tag_name == 'sheet':
                    name = elem.get('name')
                    if name:
                        sheet_names.append(name)

        if not sheet_names:
            sheet_names = ["Sheet1"]

        # Parse sheet XML files
        sheet_files = sorted([f for f in z.namelist() if f.startswith('xl/worksheets/sheet') and f.endswith('.xml')])
        for idx, sf in enumerate(sheet_files):
            s_name = sheet_names[idx] if idx < len(sheet_names) else f"Sheet{idx+1}"
            s_xml = z.read(sf)
            s_root = ET.fromstring(s_xml)
            
            raw_rows = []
            for row_node in s_root.iter():
                tag_name = row_node.tag.split('}')[-1] if '}' in row_node.tag else row_node.tag
                if tag_name == 'row':
                    cell_values = []
                    for c_node in row_node.iter():
                        c_tag = c_node.tag.split('}')[-1] if '}' in c_node.tag else c_node.tag
                        if c_tag == 'v' and c_node.text:
                            val_str = c_node.text.strip()
                            # Check shared string index
                            if val_str.isdigit() and int(val_str) < len(shared_strings):
                                val_str = shared_strings[int(val_str)]
                            cell_values.append(val_str)
                    if cell_values:
                        raw_rows.append(cell_values)

            headers = raw_rows[0] if raw_rows else []
            rows = raw_rows[1:] if len(raw_rows) > 1 else []
            tables.append({
                "sheetName": s_name,
                "headers": headers,
                "rows": rows
            })

    return tables

# ─── 3. Single Record Content Extraction Router ───────────────────────────────

async def process_page_content_record(record: Dict[str, Any], storage_dir: str) -> Dict[str, Any]:
    """
    Processes a single pending PageContent record:
      - 'image': immediate success (no download needed in this phase).
      - 'text': immediate success.
      - 'video' & 'pdf': basic text fallback or handed to dedicated prompt.
      - 'docx', 'pptx', 'xlsx': downloads file to storage_dir and extracts structured text/tables.
    Updates extractionStatus to 'success' or 'failed' (with extractionError).
    """
    c_type = record.get("contentType")

    # Image: no download needed in this phase; mark success immediately
    if c_type == "image":
        record["extractionStatus"] = "success"
        record["extractionError"] = None
        return record

    # Text: page's own text content
    if c_type == "text":
        record["extractionStatus"] = "success"
        record["extractionError"] = None
        return record

    source_url = record.get("sourceUrl")
    if not source_url:
        record["extractionStatus"] = "failed"
        record["extractionError"] = "Missing sourceUrl for content item"
        return record

    # Download binary asset
    try:
        download_result = await download_content_file(source_url, storage_dir)
        record["storagePath"] = download_result["storagePath"]
        buffer = download_result["buffer"]
    except Exception as err:
        record["extractionStatus"] = "failed"
        record["extractionError"] = f"Download error: {str(err)}"
        return record

    # Route extraction by contentType
    try:
        if c_type == "docx":
            text = extract_docx_content(buffer)
            record["extractedText"] = text
            record["extractionStatus"] = "success"
            record["extractionError"] = None

        elif c_type == "pptx":
            text = extract_pptx_content(buffer)
            record["extractedText"] = text
            record["extractionStatus"] = "success"
            record["extractionError"] = None

        elif c_type == "xlsx":
            tables = extract_xlsx_content(buffer)
            record["extractedTables"] = tables
            record["extractionStatus"] = "success"
            record["extractionError"] = None

        elif c_type == "pdf":
            from pdfExtractor import extract_pdf_content
            pdf_res = extract_pdf_content(buffer, storage_dir)
            record["extractedText"] = pdf_res.get("extractedText", "")
            record["extractedTables"] = pdf_res.get("extractedTables", [])
            record["extractedImages"] = pdf_res.get("extractedImages", [])
            record["isScannedOnly"] = pdf_res.get("isScannedOnly", False)
            record["extractionStatus"] = "success"
            record["extractionError"] = None

        elif c_type == "video":
            from videoExtractor import extract_video_content
            v_res = await extract_video_content(record)
            record["hasTranscript"] = v_res.get("hasTranscript", False)
            record["extractedText"] = v_res.get("extractedText")
            record["extractionStatus"] = "success"
            record["extractionError"] = None

        else:
            record["extractionStatus"] = "success"
            record["extractionError"] = None

    except Exception as err:
        record["extractionStatus"] = "failed"
        record["extractionError"] = f"Extraction error: {str(err)}"

    return record

# ─── 4. Batch Processor for Pending DB Records ────────────────────────────────

async def process_pending_page_contents(crawl_job_id: Any, db, storage_dir: str) -> List[Dict[str, Any]]:
    """
    Fetches all pending PageContent records for crawl_job_id from MongoDB (db.pagecontents),
    processes extraction, and updates records in MongoDB.
    """
    from bson import ObjectId
    c_id = ObjectId(crawl_job_id) if isinstance(crawl_job_id, str) and len(crawl_job_id) == 24 else crawl_job_id
    
    cursor = db.pagecontents.find({"crawlJobId": c_id, "extractionStatus": "pending"})
    pending_records = await cursor.to_list(length=1000)

    processed_records = []
    for record in pending_records:
        updated = await process_page_content_record(record, storage_dir)
        processed_records.append(updated)

        # Update in MongoDB
        update_fields = {
            "extractionStatus": updated["extractionStatus"],
            "extractionError": updated.get("extractionError"),
            "storagePath": updated.get("storagePath"),
            "extractedText": updated.get("extractedText"),
            "extractedTables": updated.get("extractedTables"),
        }
        await db.pagecontents.update_one({"_id": record["_id"]}, {"$set": update_fields})

    return processed_records
