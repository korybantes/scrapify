import logging
import json
import signal
import time
from datetime import datetime, timezone

from .config import get_settings
from .db import close_pool, connection, migrate, open_pool
from .scraper import run_scrape_job
from .groq_service import enrich_product


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("scrappify.worker")
stopping = False


def _stop(*_args) -> None:
    global stopping
    stopping = True


def claim_next_job() -> dict | None:
    settings = get_settings()
    with connection() as conn:
        with conn.transaction():
            job = conn.execute(
                """SELECT * FROM scrape_jobs
                   WHERE status = 'queued'
                   ORDER BY created_at
                   FOR UPDATE SKIP LOCKED
                   LIMIT 1"""
            ).fetchone()
            if not job:
                return None
            conn.execute(
                """UPDATE scrape_jobs SET status = 'running', started_at = now(),
                   claimed_at = now(), claimed_by = %s WHERE id = %s""",
                (settings.worker_id, job["id"]),
            )
        conn.commit()
    return {**job, "status": "running"}


def fail_job(job: dict, exc: Exception) -> None:
    with connection() as conn:
        conn.execute(
            """UPDATE scrape_jobs SET status = 'failed', error = %s,
               completed_at = now() WHERE id = %s""",
            (str(exc)[:2000], job["id"]),
        )
        conn.execute(
            """INSERT INTO activity_events(workspace_id, job_id, level, event_type, message)
               VALUES (%s, %s, 'error', 'scrape_failed', %s)""",
            (job["workspace_id"], job["id"], f"Scrape failed: {exc}"),
        )
        conn.commit()


def claim_next_ai_item() -> dict | None:
    settings = get_settings()
    with connection() as conn:
        with conn.transaction():
            conn.execute(
                """UPDATE ai_enrichment_job_items SET status = 'queued', updated_at = now()
                   WHERE status = 'running' AND updated_at < now() - interval '10 minutes'"""
            )
            job = conn.execute(
                """SELECT * FROM ai_enrichment_jobs
                   WHERE status IN ('queued', 'running')
                   ORDER BY created_at
                   FOR UPDATE SKIP LOCKED LIMIT 1"""
            ).fetchone()
            if not job:
                return None
            item = conn.execute(
                """SELECT item.*, product.title
                   FROM ai_enrichment_job_items item
                   JOIN products product ON product.id = item.product_id
                   WHERE item.job_id = %s AND item.status = 'queued'
                   ORDER BY item.created_at
                   FOR UPDATE OF item SKIP LOCKED LIMIT 1""",
                (job["id"],),
            ).fetchone()
            if not item:
                remaining = conn.execute(
                    """SELECT count(*)::int AS count FROM ai_enrichment_job_items
                       WHERE job_id = %s AND status IN ('queued','running')""",
                    (job["id"],),
                ).fetchone()["count"]
                if not remaining:
                    final_status = "completed_with_errors" if job["failed"] else "completed"
                    conn.execute(
                        """UPDATE ai_enrichment_jobs SET status = %s, completed_at = now(),
                           current_product_id = NULL, current_product_title = NULL, updated_at = now()
                           WHERE id = %s""",
                        (final_status, job["id"]),
                    )
                conn.commit()
                return None
            attempts = item["attempts"] + 1
            conn.execute(
                """UPDATE ai_enrichment_job_items SET status = 'running', attempts = %s,
                   updated_at = now() WHERE job_id = %s AND product_id = %s""",
                (attempts, job["id"], item["product_id"]),
            )
            event = json.dumps([{
                "id": f"{item['product_id']}-{attempts}-{time.time_ns()}",
                "title": item["title"],
                "status": "running" if attempts == 1 else "retrying",
                "message": "Writing SEO description" if attempts == 1 else f"Retry {attempts} of 3",
                "at": datetime.now(timezone.utc).isoformat(),
            }])
            conn.execute(
                """UPDATE ai_enrichment_jobs SET status = 'running', started_at = COALESCE(started_at, now()),
                   claimed_by = %s, current_product_id = %s, current_product_title = %s,
                   logs = (%s::jsonb || logs)::jsonb, updated_at = now() WHERE id = %s""",
                (settings.worker_id, item["product_id"], item["title"], event, job["id"]),
            )
        conn.commit()
    return {**item, "attempts": attempts, "workspace_id": job["workspace_id"], "language": job["language"]}


def finish_ai_item(item: dict, error: Exception | None = None) -> None:
    success = error is None
    retry = bool(error and item["attempts"] < 3)
    status = "enriched" if success else "queued" if retry else "failed"
    message = "Description completed" if success else f"Will retry: {error}" if retry else str(error)
    event_status = "enriched" if success else "retrying" if retry else "failed"
    event = json.dumps([{
        "id": f"{item['product_id']}-{event_status}-{time.time_ns()}",
        "title": item["title"],
        "status": event_status,
        "message": message[:1000],
        "at": datetime.now(timezone.utc).isoformat(),
    }])
    with connection() as conn:
        with conn.transaction():
            conn.execute(
                """UPDATE ai_enrichment_job_items SET status = %s, error = %s, updated_at = now()
                   WHERE job_id = %s AND product_id = %s""",
                (status, str(error)[:1000] if error else None, item["job_id"], item["product_id"]),
            )
            if not retry:
                conn.execute(
                    """UPDATE ai_enrichment_jobs SET completed = completed + 1,
                       succeeded = succeeded + %s, failed = failed + %s,
                       current_product_id = NULL, current_product_title = NULL,
                       logs = (%s::jsonb || logs)::jsonb, updated_at = now() WHERE id = %s""",
                    (1 if success else 0, 0 if success else 1, event, item["job_id"]),
                )
            else:
                conn.execute(
                    """UPDATE ai_enrichment_jobs SET current_product_id = NULL, current_product_title = NULL,
                       logs = (%s::jsonb || logs)::jsonb, updated_at = now() WHERE id = %s""",
                    (event, item["job_id"]),
                )
            remaining = conn.execute(
                """SELECT count(*)::int AS count FROM ai_enrichment_job_items
                   WHERE job_id = %s AND status IN ('queued','running')""",
                (item["job_id"],),
            ).fetchone()["count"]
            if not remaining:
                failed = conn.execute(
                    "SELECT failed FROM ai_enrichment_jobs WHERE id = %s", (item["job_id"],)
                ).fetchone()["failed"]
                conn.execute(
                    """UPDATE ai_enrichment_jobs SET status = %s, completed_at = now(), updated_at = now()
                       WHERE id = %s""",
                    ("completed_with_errors" if failed else "completed", item["job_id"]),
                )
        conn.commit()


def main() -> None:
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    settings = get_settings()
    open_pool()
    migrate()
    logger.info("Worker %s started", settings.worker_id)
    while not stopping:
        ai_item = claim_next_ai_item()
        if ai_item:
            logger.info("Enriching product %s for AI job %s", ai_item["product_id"], ai_item["job_id"])
            try:
                enrich_product(ai_item["product_id"], ai_item["workspace_id"], ai_item["language"])
                finish_ai_item(ai_item)
            except Exception as exc:
                logger.exception("AI product %s failed", ai_item["product_id"])
                finish_ai_item(ai_item, exc)
            continue
        job = claim_next_job()
        if not job:
            time.sleep(settings.poll_seconds)
            continue
        logger.info("Claimed job %s", job["id"])
        try:
            run_scrape_job(job)
        except Exception as exc:
            logger.exception("Job %s failed", job["id"])
            fail_job(job, exc)
    close_pool()


if __name__ == "__main__":
    main()
