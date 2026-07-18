from config import settings  # Ensures environment validation executes immediately
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from worker import start_worker, log_json
from queue_monitor import monitor_queue_loop
from db import client as mongo_client
import redis.asyncio as redis_async
import asyncio
import time

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start the background BullMQ Worker
    worker = start_worker()

    # Start the queue monitor task
    monitor_task = asyncio.create_task(monitor_queue_loop())

    yield
    # Shutdown: Close worker connections cleanly
    log_json("INFO", "worker_shutting_down")
    monitor_task.cancel()
    try:
        await monitor_task
    except asyncio.CancelledError:
        pass
    await worker.close()
    log_json("INFO", "worker_shutdown_complete")

app = FastAPI(
    title="RankEngine AI Worker",
    description="Python microservice for background crawling & LLM synthesis jobs",
    version="0.1.0",
    lifespan=lifespan
)

# The worker has no authenticated browser endpoints, so CORS is opt-in and credential-free.
worker_allowed_origins = [
    origin.strip()
    for origin in settings.WORKER_ALLOWED_ORIGINS.split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=worker_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=[],
)

start_time = time.time()

@app.get("/health")
async def health_check():
    health = {
        "status": "ok",
        "service": "rankengine-worker",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "uptime_seconds": round(time.time() - start_time, 2),
        "redis": "disconnected",
        "mongodb": "disconnected",
        "in_progress_jobs": 0,
    }

    # 1. MongoDB connectivity check
    try:
        # ping database using the motor client admin command
        await mongo_client.admin.command('ping')
        health["mongodb"] = "connected"
    except Exception as e:
        health["status"] = "error"
        health["mongodb"] = f"error: {str(e)}"

    # 2. Redis connectivity & in-progress jobs check
    try:
        r = redis_async.from_url(settings.REDIS_URL, decode_responses=True)
        # ping redis to assert connection success
        await r.ping()
        health["redis"] = "connected"

        # Check active (in-progress) jobs count from BullMQ zset in Redis
        active_count = await r.zcard("bull:crawl-jobs:active")
        health["in_progress_jobs"] = active_count or 0
        await r.close()
    except Exception as e:
        health["status"] = "error"
        health["redis"] = f"error: {str(e)}"

    return health
