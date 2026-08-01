"""
Video Extractor Module for RankEngine AI Worker.

Handles video transcript and caption extraction:
  1. Native <video> track elements (WebVTT / SRT format parsing).
  2. YouTube embeds (using free, public timedtext endpoints).
  3. No-transcript case: sets hasTranscript=False and extractionStatus='success'
     (absence of a transcript is a valid audit outcome, not a system failure).
"""

import re
import xml.etree.ElementTree as ET
from typing import Dict, Any, Optional
import httpx


def parse_vtt_srt_subtitles(vtt_or_srt_text: str) -> str:
    """Parses WebVTT or SRT subtitle text into clean plain text."""
    if not vtt_or_srt_text:
        return ""
    # Strip WEBVTT header & NOTE comments
    cleaned = re.sub(r'^WEBVTT.*?\n', '', vtt_or_srt_text, flags=re.MULTILINE | re.IGNORECASE)
    cleaned = re.sub(r'NOTE.*?\n\n', '', cleaned, flags=re.DOTALL)
    # Strip timestamps (00:00:00.000 --> 00:00:02.500)
    cleaned = re.sub(r'\d{1,2}:\d{2}:\d{2}[\.,]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[\.,]\d{3}.*?\n', '', cleaned)
    cleaned = re.sub(r'\d{1,2}:\d{2}[\.,]\d{3}\s*-->\s*\d{1,2}:\d{2}[\.,]\d{3}.*?\n', '', cleaned)
    # Strip cue numbers (standalone digits)
    cleaned = re.sub(r'^\d+\s*$', '', cleaned, flags=re.MULTILINE)
    # Strip HTML tags (<v Name>, <b>, etc.)
    cleaned = re.sub(r'<[^>]+>', '', cleaned)
    
    lines = [line.strip() for line in cleaned.split('\n') if line.strip()]
    return ' '.join(lines)


def extract_youtube_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from URL or iframe src."""
    match = re.search(r'(?:embed\/|v\/|watch\?v=|youtu\.be\/|\/v=)([^#\&\?]{11})', url)
    return match.group(1) if match else None


async def extract_video_content(video_record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extracts transcript / caption text for a video PageContent record.
    Returns:
      {
        "extractionStatus": "success",
        "hasTranscript": bool,
        "extractedText": str or None,
        "extractionError": None
      }
    """
    source_url = video_record.get("sourceUrl", "")
    track_url = video_record.get("trackUrl") or (video_record.get("tracks", [{}])[0].get("src") if video_record.get("tracks") else None)

    transcript_text = None
    has_transcript = False

    # 1. Native <video> with <track> caption file
    if track_url:
        try:
            async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
                res = await client.get(track_url)
                if res.status_code == 200 and res.text:
                    parsed_text = parse_vtt_srt_subtitles(res.text)
                    if len(parsed_text.strip()) > 5:
                        transcript_text = parsed_text
                        has_transcript = True
        except Exception:
            pass

    # 2. YouTube embed captions via free public timedtext endpoint
    if not has_transcript and source_url:
        yt_id = extract_youtube_id(source_url)
        if yt_id:
            try:
                timedtext_url = f"https://www.youtube.com/api/timedtext?v={yt_id}&lang=en"
                async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
                    res = await client.get(timedtext_url)
                    if res.status_code == 200 and res.text.strip():
                        root = ET.fromstring(res.text)
                        texts = [elem.text for elem in root.iter() if (elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag) == 'text' and elem.text]
                        if texts:
                            transcript_text = ' '.join(texts).strip()
                            has_transcript = True
            except Exception:
                pass

    # 3. Final outcome: no-transcript is a valid outcome (extractionStatus='success'), NOT a failure
    return {
        "extractionStatus": "success",
        "hasTranscript": has_transcript,
        "extractedText": transcript_text,
        "extractionError": None
    }
