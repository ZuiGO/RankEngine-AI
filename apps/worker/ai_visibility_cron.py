"""
ai_visibility_cron.py — Daily cron that iterates all TrackedPrompt documents
and runs visibility checks across all configured AI engines.

Follows the same asyncio-loop pattern as queue_monitor.py.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from config import settings
from db import db
from ai_visibility_checker import AI_ENGINES, run_visibility_check

logger = logging.getLogger(__name__)

# How often to run the full sweep (in seconds — 86400 = 24 h)
SWEEP_INTERVAL = int(getattr(settings, "AI_VISIBILITY_SWEEP_INTERVAL", "86400"))


def log_json(level: str, event: str, **kwargs):
    """Structured JSON log line (matches worker.py style)."""
    log_data = {
        "level": level,
        "event": event,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **kwargs,
    }
    print(json.dumps(log_data), flush=True)


async def run_sweep():
    """Fetch all tracked prompts and run visibility checks on each."""
    log_json("INFO", "ai_visibility_sweep_started")

    try:
        cursor = db.trackedprompts.find({})
        total = 0
        async for prompt in cursor:
            prompt_id = str(prompt["_id"])
            prompt_text = prompt.get("promptText", "")
            brand_term = prompt.get("brandTerm", "")
            if not prompt_text or not brand_term:
                log_json(
                    "WARN", "ai_visibility_skipped",
                    promptId=prompt_id,
                    reason="missing promptText or brandTerm",
                )
                continue

            await run_visibility_check(prompt_id, prompt_text, brand_term)
            total += 1

        log_json("INFO", "ai_visibility_sweep_completed", processed=total)
    except Exception as exc:
        log_json("ERROR", "ai_visibility_sweep_failed", error=str(exc))


async def ai_visibility_loop():
    """
    Background task that runs the visibility sweep on a fixed interval.
    """
    log_json(
        "INFO", "ai_visibility_cron_started",
        sweep_interval_seconds=SWEEP_INTERVAL,
        engines=AI_ENGINES,
    )

    while True:
        await run_sweep()
        await asyncio.sleep(SWEEP_INTERVAL)


if __name__ == "__main__":
    asyncio.run(ai_visibility_loop())
