"""
queue_monitor.py — Lightweight monitor for BullMQ crawl-jobs queue depth.

Logs a simple scaling signal (e.g. "SCALE_UP: 40 jobs waiting") when
the number of waiting jobs exceeds the configured threshold.
This signal is designed to feed into container orchestrators (e.g., Kubernetes HPA, AWS ECS)
monitoring container standard output.
"""

import asyncio
import os
import sys
import redis.asyncio as redis_async
from config import settings
import json
import datetime

def log_json(level: str, event: str, **kwargs):
    log_data = {
        "level": level,
        "event": event,
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        **kwargs
    }
    print(json.dumps(log_data), flush=True)

async def check_queue_depth(r: redis_async.Redis, queue_name: str = "crawl-jobs") -> int:
    """
    Checks the waiting job count in Redis for the specified BullMQ queue.
    Compatible with list-based and zset-based wait structures in different BullMQ versions.
    """
    wait_key = f"bull:{queue_name}:wait"
    
    # Try LLEN first (list-based queues)
    try:
        count = await r.llen(wait_key)
        if count is not None:
            return count
    except redis_async.ResponseError:
        # If it is not a list, it is likely a zset (modern BullMQ wait key format)
        try:
            count = await r.zcard(wait_key)
            if count is not None:
                return count
        except Exception:
            pass

    # Fallback to alternate key name "waiting"
    waiting_key = f"bull:{queue_name}:waiting"
    try:
        count = await r.llen(waiting_key)
        if count is not None:
            return count
    except redis_async.ResponseError:
        try:
            count = await r.zcard(waiting_key)
            if count is not None:
                return count
        except Exception:
            pass

    return 0

async def monitor_queue_loop():
    queue_name = "crawl-jobs"
    threshold = int(os.getenv("SCALE_UP_THRESHOLD", "10"))
    check_interval = int(os.getenv("SCALE_CHECK_INTERVAL", "30"))

    log_json("INFO", "queue_monitor_started", queue=queue_name, threshold=threshold, interval_check=check_interval)

    try:
        r = redis_async.from_url(settings.REDIS_URL, decode_responses=True)
    except Exception as e:
        log_json("ERROR", "queue_monitor_redis_connection_failed", error=str(e))
        return

    while True:
        try:
            waiting_jobs = await check_queue_depth(r, queue_name)
            
            # Print scaling signal if threshold is exceeded
            if waiting_jobs > threshold:
                print(f"SCALE_UP: {waiting_jobs} jobs waiting", flush=True)
                log_json("INFO", "scale_up_signal_triggered", waiting_jobs=waiting_jobs, threshold=threshold)
            else:
                log_json("DEBUG", "queue_check", waiting_jobs=waiting_jobs, threshold=threshold)

        except Exception as e:
            log_json("ERROR", "queue_monitor_loop_error", error=str(e))

        await asyncio.sleep(check_interval)

if __name__ == "__main__":
    try:
        asyncio.run(monitor_queue_loop())
    except KeyboardInterrupt:
        log_json("INFO", "queue_monitor_stopped")
