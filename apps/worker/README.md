# RankEngine Worker

A FastAPI Python worker for background crawling and synthesis jobs.

## Development Setup

Prerequisites:
- Python 3.11+
- Poetry

Install dependencies:
```bash
poetry env use python3.11
poetry install
```

Start dev server:
```bash
poetry run uvicorn main:app --reload --port 8000
```

---

## 1. Reliability & Outbound Retries

All outbound network requests to untrusted or transient external services implement **exponential backoff and retry** to safeguard against network blips, 429 rate limits, and 5xx server errors:
1. **Target Web Crawl Navigations**: Inside `crawler.py`, Playwright requests are retried up to 3 times, with backoff delays of $2^{\text{attempt}}$ seconds. Retries trigger on Captcha blocks or HTTP 429s.
2. **Migration Redirect Validation**: Inside `crawler.py`, redirect traces are retried up to 2 times.
3. **Groq LLM Synthesis Requests**: Inside `llm.py`, Groq API calls are wrapped in a backoff loop retrying up to 3 times on connection, timeout, rate limit, or server errors.
4. **General HTTP requests**: Built-in async HTTP utility in `http_utils.py` handles custom backoff logic.

---

## 2. Health Check Endpoint

FastAPI exposes an active health status route at `/health` that reports connectivity status and in-flight job depth:
- **MongoDB**: Ping validation.
- **Redis**: Ping validation.
- **In Progress Jobs**: Current active BullMQ crawl-jobs count from Redis.

Example response:
```json
{
  "status": "ok",
  "service": "rankengine-worker",
  "timestamp": "2026-07-17T11:30:00Z",
  "uptime_seconds": 1205.4,
  "redis": "connected",
  "mongodb": "connected",
  "in_progress_jobs": 2
}
```

The worker does not allow browser cross-origin access by default. If a
browser-facing health proxy is required, set `WORKER_CORS_ORIGINS` to a
comma-separated allowlist (for example,
`https://app.rankengine.ai,http://localhost:5173`).

---

## 3. Scalability & Queue Depth Monitor

The worker includes a lightweight **Queue Depth Monitor** (in `queue_monitor.py`) integrated directly into the FastAPI application startup lifecycle (or executable as a standalone daemon script).

### Behavior
Every **30 seconds** (configurable via `SCALE_CHECK_INTERVAL`), the monitor queries Redis to retrieve the number of waiting jobs in the `crawl-jobs` queue (handling both list-based and zset-based wait structures). If the count exceeds the threshold (configurable via `SCALE_UP_THRESHOLD`, defaults to **10**), it prints a standardized scaling signal to standard output:
```
SCALE_UP: 42 jobs waiting
```

This raw standard output log can be directly ingested by container orchestrator log aggregators (e.g., Kubernetes HPA, ECS CloudWatch Alarms) to trigger horizontal scaling events.

---

## 4. Production Autoscaling Guidelines

For a **moderate-traffic production deployment** (handling between 10,000 to 50,000 crawls per day), follow these sizing and scaling recommendations:

### Recommended Autoscaling Metric
- **Metric**: `crawl-jobs` Queue Depth (Wait queue size).
- **Target**: **10-15 waiting jobs per worker replica**.
- **Autoscaler Type**: Horizontal Pod Autoscaler (HPA) in Kubernetes or AWS ECS Service Auto Scaling tracking custom CloudWatch metrics (e.g., Redis queue length).

### Suggested Replica Sizing

| Environment Size | Min Replicas | Max Replicas | Scale-Up Trigger (Queue Depth) |
|---|---|---|---|
| **Moderate Traffic** | **2** | **8** | `> 10` waiting jobs for $> 60\text{s}$ |
| **High Traffic** | **4** | **20** | `> 15` waiting jobs for $> 60\text{s}$ |

### Configuration Variables
Set these environment variables in your container spec to configure the worker's monitoring behavior:

```env
# Sizing and scaling env variables
SCALE_UP_THRESHOLD=10        # Number of waiting jobs before printing SCALE_UP log signal
SCALE_CHECK_INTERVAL=30      # Interval in seconds to poll Redis queue length
```
