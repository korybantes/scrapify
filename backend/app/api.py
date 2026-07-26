import csv
import io
from contextlib import asynccontextmanager
from urllib.parse import urlparse
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import close_pool, connection, migrate, open_pool
from .groq_service import enrich_many
from .schemas import IdList, JobCreate, ProductPatch
from .security import require_api_key
from .shopify_service import sync_product


@asynccontextmanager
async def lifespan(_app: FastAPI):
    open_pool()
    migrate()
    yield
    close_pool()


settings = get_settings()
app = FastAPI(title="Scrappify API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Scrappify-Key", "X-Workspace-ID"],
)


def workspace_header(
    workspace_id: UUID = Header(alias="X-Workspace-ID"),
) -> UUID:
    return workspace_id


@app.get("/health")
def health():
    with connection() as conn:
        database = conn.execute("SELECT 1 AS ok").fetchone()["ok"] == 1
    return {
        "status": "ok" if database else "degraded",
        "database": database,
        "ai": bool(settings.groq_api_key or settings.ollama_url),
        "ai_provider": settings.ai_provider,
        "shopify": bool(settings.shopify_store_domain and settings.shopify_access_token),
    }


@app.get("/v1/dashboard", dependencies=[Depends(require_api_key)])
def dashboard(workspace_id: UUID = Depends(workspace_header)):
    with connection() as conn:
        summary = conn.execute(
            """SELECT count(*)::int AS total_products,
                      count(*) FILTER (WHERE ai_status = 'enriched')::int AS ai_enriched,
                      count(*) FILTER (WHERE price_warning IS NOT NULL)::int AS warnings,
                      count(*) FILTER (WHERE shopify_status IN ('draft','active'))::int AS shopify_synced,
                      coalesce(sum(sale_price * inventory_qty), 0)::numeric AS catalog_value
               FROM products WHERE workspace_id = %s""",
            (workspace_id,),
        ).fetchone()
        active_job = conn.execute(
            """SELECT * FROM scrape_jobs
               WHERE workspace_id = %s AND status IN ('queued','running')
               ORDER BY created_at LIMIT 1""",
            (workspace_id,),
        ).fetchone()
        recent_events = conn.execute(
            """SELECT id, level, event_type, message, created_at
               FROM activity_events WHERE workspace_id = %s
               ORDER BY created_at DESC LIMIT 12""",
            (workspace_id,),
        ).fetchall()
    return {**summary, "active_job": active_job, "recent_events": recent_events}


@app.post("/v1/jobs", dependencies=[Depends(require_api_key)], status_code=201)
def create_job(payload: JobCreate):
    host = urlparse(str(payload.category_url)).hostname
    if host not in settings.allowed_source_hosts:
        raise HTTPException(status_code=400, detail="Source host is not allowed")
    with connection() as conn:
        job = conn.execute(
            """INSERT INTO scrape_jobs (
                 workspace_id, source, category_name, category_url, start_page, max_pages,
                 download_images, auto_enrich, seo_language
               ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
               RETURNING *""",
            (
                payload.workspace_id,
                payload.source,
                payload.category_name,
                str(payload.category_url),
                payload.start_page,
                payload.max_pages,
                payload.download_images,
                payload.auto_enrich,
                payload.seo_language,
            ),
        ).fetchone()
        conn.commit()
    return job


@app.get("/v1/jobs", dependencies=[Depends(require_api_key)])
def list_jobs(
    limit: int = Query(default=25, ge=1, le=100),
    workspace_id: UUID = Depends(workspace_header),
):
    with connection() as conn:
        return conn.execute(
            """SELECT * FROM scrape_jobs WHERE workspace_id = %s
               ORDER BY created_at DESC LIMIT %s""",
            (workspace_id, limit),
        ).fetchall()


@app.post("/v1/jobs/{job_id}/cancel", dependencies=[Depends(require_api_key)])
def cancel_job(job_id: UUID, workspace_id: UUID = Depends(workspace_header)):
    with connection() as conn:
        job = conn.execute(
            """UPDATE scrape_jobs SET status = 'cancelled', completed_at = now()
               WHERE id = %s AND workspace_id = %s
                 AND status IN ('queued','running') RETURNING *""",
            (job_id, workspace_id),
        ).fetchone()
        conn.commit()
    if not job:
        raise HTTPException(status_code=409, detail="Job is not cancellable")
    return job


@app.get("/v1/products", dependencies=[Depends(require_api_key)])
def list_products(
    query: str = "",
    source: str = "",
    limit: int = Query(default=50, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    workspace_id: UUID = Depends(workspace_header),
):
    clauses, params = ["workspace_id = %s"], [workspace_id]
    if query:
        clauses.append("(title ILIKE %s OR vendor ILIKE %s)")
        params.extend([f"%{query}%", f"%{query}%"])
    if source:
        clauses.append("source = %s")
        params.append(source)
    where = " AND ".join(clauses)
    with connection() as conn:
        rows = conn.execute(
            f"""SELECT * FROM products WHERE {where}
                ORDER BY updated_at DESC LIMIT %s OFFSET %s""",
            (*params, limit, offset),
        ).fetchall()
        total = conn.execute(
            f"SELECT count(*)::int AS count FROM products WHERE {where}",
            params,
        ).fetchone()["count"]
    return {"products": rows, "total": total}


@app.patch("/v1/products/{product_id}", dependencies=[Depends(require_api_key)])
def patch_product(
    product_id: UUID,
    payload: ProductPatch,
    workspace_id: UUID = Depends(workspace_header),
):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes supplied")
    fields, params = [], []
    for field, value in updates.items():
        fields.append(f"{field} = %s")
        params.append(value)
    fields.append("updated_at = now()")
    with connection() as conn:
        row = conn.execute(
            f"""UPDATE products SET {', '.join(fields)}
                WHERE id = %s AND workspace_id = %s RETURNING *""",
            (*params, product_id, workspace_id),
        ).fetchone()
        conn.commit()
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    return row


@app.post("/v1/ai/enrich", dependencies=[Depends(require_api_key)])
def ai_enrich(payload: IdList):
    return enrich_many(payload.product_ids, payload.workspace_id, payload.language)


@app.post("/v1/shopify/sync", dependencies=[Depends(require_api_key)])
def shopify_sync(payload: IdList):
    synced, failed = [], []
    for product_id in payload.product_ids:
        try:
            synced.append(sync_product(product_id, payload.workspace_id))
        except Exception as exc:
            failed.append({"id": str(product_id), "error": str(exc)})
    return {"synced": synced, "failed": failed}


@app.get("/v1/exports/shopify.csv", dependencies=[Depends(require_api_key)])
def export_shopify_csv(
    ids: str = "",
    workspace_id: UUID = Depends(workspace_header),
):
    selected = [UUID(value) for value in ids.split(",") if value] if ids else []
    with connection() as conn:
        if selected:
            products = conn.execute(
                """SELECT * FROM products
                   WHERE id = ANY(%s) AND workspace_id = %s
                   ORDER BY updated_at DESC""",
                (selected, workspace_id),
            ).fetchall()
        else:
            products = conn.execute(
                """SELECT * FROM products WHERE workspace_id = %s
                   ORDER BY updated_at DESC""",
                (workspace_id,),
            ).fetchall()

    columns = [
        "Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type",
        "Tags", "Published", "Option1 Name", "Option1 Value", "Variant SKU",
        "Variant Price", "Variant Compare At Price", "Variant Inventory Qty",
        "Variant Inventory Policy", "Variant Fulfillment Service",
        "Variant Requires Shipping", "Variant Taxable", "Image Src",
        "Image Position", "Image Alt Text", "Status",
    ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    for product in products:
        handle = "-".join(filter(None, __import__("re").sub(r"[^\w\s-]", "", product["title"].lower()).split()))
        writer.writerow({
            "Handle": handle,
            "Title": product["title"],
            "Body (HTML)": product["body_html"],
            "Vendor": product["vendor"],
            "Product Category": product["category"],
            "Type": product["category"],
            "Tags": ",".join(product["tags"]),
            "Published": "TRUE" if product["published"] else "FALSE",
            "Option1 Name": "Title",
            "Option1 Value": "Default Title",
            "Variant SKU": str(product["id"]),
            "Variant Price": product["sale_price"] or "",
            "Variant Compare At Price": product["compare_at_price"] or "",
            "Variant Inventory Qty": product["inventory_qty"],
            "Variant Inventory Policy": "deny",
            "Variant Fulfillment Service": "manual",
            "Variant Requires Shipping": "TRUE",
            "Variant Taxable": "TRUE",
            "Image Src": product["image_url"],
            "Image Position": "1",
            "Image Alt Text": product["title"],
            "Status": "active" if product["published"] else "draft",
        })
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=scrappify-shopify.csv"},
    )
