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
            # Execute standard Playwright crawl site traversal (max 50 pages or 360s timeout)
            crawl_result_id, page_count = await asyncio.wait_for(
                crawl_site(crawl_job_id, domain, limit=max_pages),
                timeout=360
            )

        elapsed = (datetime.datetime.now(datetime.timezone.utc) - start_time).total_seconds()

        # Update MongoDB status to completed
        if crawl_job_id:
            try:
                update_doc = {
                    "status": "completed",
                    "pageCount": page_count,
                    "completedAt": datetime.datetime.now(datetime.timezone.utc)
                }
                if crawl_result_id:
                    update_doc["rawResultsRef"] = ObjectId(crawl_result_id)
                await db.crawljobs.update_one(
                    {"_id": ObjectId(crawl_job_id)},
                    {"$set": update_doc}
                )
            except Exception as db_err:
                log_json("WARNING", "db_completion_update_failed", crawlJobId=crawl_job_id, error=str(db_err))

        log_json(
            "INFO",
            "job_completed",
            crawlJobId=crawl_job_id,
            domain=domain,
            pageCount=page_count,
            duration_seconds=round(elapsed, 3)
        )

        return json.dumps({"status": "completed", "pageCount": page_count, "rawResultsRef": str(crawl_result_id)})

    except Exception as err:
        err_msg = str(err).strip()
        if not err_msg:
            if isinstance(err, asyncio.TimeoutError):
                err_msg = f"Crawl job execution timed out after 180s for {domain}"
            else:
                err_msg = repr(err)

        log_json(
            "ERROR",
            "job_failed",
            crawlJobId=crawl_job_id,
            error=err_msg,
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
                            "errorMessage": err_msg,
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

        # Re-raise error with explicit string message for BullMQ
        raise RuntimeError(err_msg) from err

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
