import pytest
import unittest.mock as mock
from videoExtractor import extract_video_content, parse_vtt_srt_subtitles

@pytest.mark.asyncio
async def test_1_native_video_with_captions_track():
    """
    Test 1: mock a native video with a captions track; assert extractedText is populated and hasTranscript is true.
    """
    vtt_content = """WEBVTT

00:00:01.000 --> 00:00:04.000
Welcome to our SEO video tutorial.

00:00:04.500 --> 00:00:08.000
Today we will discuss core web vitals optimization.
"""
    record = {
        "pageUrl": "https://example.com/video-page",
        "sourceUrl": "https://example.com/videos/demo.mp4",
        "trackUrl": "https://example.com/videos/captions.vtt",
        "contentType": "video",
        "extractionStatus": "pending"
    }

    mock_response = mock.MagicMock()
    mock_response.status_code = 200
    mock_response.text = vtt_content

    with mock.patch("httpx.AsyncClient.get", mock.AsyncMock(return_value=mock_response)):
        res = await extract_video_content(record)

    assert res["extractionStatus"] == "success"
    assert res["hasTranscript"] is True
    assert "Welcome to our SEO video tutorial." in res["extractedText"]
    assert "Today we will discuss core web vitals optimization." in res["extractedText"]
    assert res["extractionError"] is None


@pytest.mark.asyncio
async def test_2_video_no_captions_track_returns_success_with_has_transcript_false():
    """
    Test 2: mock a video with no captions track and no extractable YouTube ID;
    assert hasTranscript is false, extractionStatus is 'success' (not 'failed' — absence of a transcript is a valid outcome).
    """
    record = {
        "pageUrl": "https://example.com/video-page",
        "sourceUrl": "https://example.com/videos/standalone_promo.mp4",
        "contentType": "video",
        "extractionStatus": "pending"
    }

    res = await extract_video_content(record)

    # Absence of a transcript is NOT an error failure
    assert res["extractionStatus"] == "success"
    assert res["hasTranscript"] is False
    assert res["extractedText"] is None
    assert res["extractionError"] is None


def test_parse_vtt_srt_subtitles_strips_metadata_timestamps():
    srt_content = """1
00:00:02,000 --> 00:00:05,000
First subtitle line.

2
00:00:05,500 --> 00:00:09,000
Second subtitle line.
"""
    parsed = parse_vtt_srt_subtitles(srt_content)
    assert parsed == "First subtitle line. Second subtitle line."
