import asyncio
from bullmq import Worker
from config import settings
from db import db
import datetime
import json
import traceback
from bson import ObjectId
from crawler import crawl_site, run_migration_check

# Helper function to print JSON-formatted logs
def log_json(level: str, event: str, **kwargs):
    log_data = {
        "level": level,
        "event": event,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        **kwargs
    }
    print(json.dumps(log_data), flush=True)

async def process_crawl_job(job, job_token):
    # Parse payload enqueued from Node
    job_data = job.data or {}
    crawl_job_id = job_data.get("crawlJobId")
    domain = job_data.get("domain", "unknown-domain")
    staging_domain = job_data.get("stagingDomain")
    job_type = job_data.get("type", "crawl")
    max_pages = job_data.get("maxPages", 50)
    
    log_json("INFO", "job_start", crawlJobId=crawl_job_id, domain=domain, type=job_type, maxPages=max_pages)
    start_time = datetime.datetime.now(datetime.timezone.utc)

    try:
        if not crawl_job_id:
            raise ValueError("Missing crawlJobId in payload")

        if job_type == "migration-check":
            if not staging_domain:
                raise ValueError("Missing stagingDomain for migration-check job")
            # Execute migration check redirect validation loop
            crawl_result_id, page_count = await run_migration_check(crawl_job_id, domain, staging_domain)
        else:
            # Execute standard Playwright crawl site traversal (max 50 pages or 180s timeout)
            crawl_result_id, page_count = await asyncio.wait_for(
                crawl_site(crawl_job_id, domain, limit=max_pages),
                timeout=180
            )

        elapsed = (datetime.datetime.now(datetime.timezone.utc) - start_time).total_seconds()
        log_json(
            "INFO",
            "job_completed",
            crawlJobId=crawl_job_id,
            domain=domain,
            pageCount=page_count,
            duration_seconds=round(elapsed, 3)
        )

        return json.dumps({"status": "completed", "pageCount": page_count, "rawResultsRef": crawl_result_id})

    except Exception as err:
        log_json(
            "ERROR",
            "job_failed",
            crawlJobId=crawl_job_id,
            error=str(err),
            traceback=traceback.format_exc()
        )

        # Update MongoDB status to failed and store the errorMessage
        if crawl_job_id:
            try:
                await db.crawljobs.update_one(
                    {"_id": ObjectId(crawl_job_id)},
                    {
                        "$set": {
                            "status": "failed",
                            "errorMessage": str(err),
                            "completedAt": datetime.datetime.now(datetime.timezone.utc)
                        }
                    }
                )
            except Exception as update_err:
                log_json(
                    "ERROR",
                    "db_update_failed",
                    crawlJobId=crawl_job_id,
                    error=str(update_err)
                )

        # Re-raise error to let BullMQ record the failed status in Redis
        raise err

# Instantiate the BullMQ Worker
def start_worker():
    # bullmq-py takes settings.REDIS_URL string directly under connection config
    worker = Worker(
        "crawl-jobs",
        process_crawl_job,
        {"connection": settings.REDIS_URL}
    )
    log_json("INFO", "worker_started", queue="crawl-jobs")
    return worker
