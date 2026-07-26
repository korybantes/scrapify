import logging
import signal
import time

from .config import get_settings
from .db import close_pool, connection, migrate, open_pool
from .scraper import run_scrape_job


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


def main() -> None:
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    settings = get_settings()
    open_pool()
    migrate()
    logger.info("Worker %s started", settings.worker_id)
    while not stopping:
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
