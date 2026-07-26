from contextlib import contextmanager
from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import get_settings


settings = get_settings()
pool = ConnectionPool(
    conninfo=settings.neon_db_url,
    min_size=0,
    max_size=8,
    kwargs={"autocommit": False, "row_factory": dict_row},
    open=False,
)


def open_pool() -> None:
    if pool.closed:
        pool.open()


def close_pool() -> None:
    if not pool.closed:
        pool.close()


@contextmanager
def connection():
    open_pool()
    with pool.connection() as conn:
        yield conn


def migrate() -> None:
    migration = Path(__file__).resolve().parent.parent / "migrations" / "001_initial.sql"
    statements = [statement.strip() for statement in migration.read_text(encoding="utf-8").split("-- statement-breakpoint") if statement.strip()]
    with connection() as conn:
        with conn.cursor() as cur:
            for statement in statements:
                cur.execute(statement)
        conn.commit()
