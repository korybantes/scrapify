import html
import re
from uuid import UUID

import httpx

from .config import get_settings
from .db import connection


SYSTEM_PROMPT = """You are a senior Turkish Shopify ecommerce copywriter.
Return only simple Shopify-safe HTML using <p>, <ul>, <li>, and <strong>.
Write one compact original paragraph and 2-3 short feature bullets.
Never mention the source retailer or invent product facts.
Use a premium, trustworthy, sales-focused tone without exaggerated claims."""


def _clean_html(value: str) -> str:
    cleaned = re.sub(r"^```(?:html)?\s*|\s*```$", "", value.strip(), flags=re.I)
    cleaned = re.sub(r"<(?!/?(?:p|ul|li|strong)\b)[^>]*>", "", cleaned, flags=re.I)
    return cleaned.strip()


def enrich_product(product_id: UUID | str) -> dict:
    settings = get_settings()
    if not settings.groq_api_key:
        raise RuntimeError("GROQ_API_KEY is not configured")

    with connection() as conn:
        product = conn.execute(
            """SELECT id, title, vendor, category, sale_price
               FROM products WHERE id = %s""",
            (product_id,),
        ).fetchone()
    if not product:
        raise ValueError("Product not found")

    facts = "\n".join(
        [
            f"Product: {product['title']}",
            f"Brand: {product['vendor'] or 'Unknown'}",
            f"Category: {product['category'] or 'Unknown'}",
            f"Price: {product['sale_price'] or 'Unknown'} TRY",
        ]
    )
    response = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.groq_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": settings.groq_model,
            "temperature": 0.45,
            "max_completion_tokens": 500,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": facts},
            ],
        },
        timeout=60,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    body_html = _clean_html(content)
    if not body_html:
        raise RuntimeError("Groq returned an empty description")

    tags = sorted({item for item in [product["vendor"], product["category"], "parfum"] if item})
    with connection() as conn:
        row = conn.execute(
            """UPDATE products
               SET body_html = %s, tags = %s, ai_status = 'enriched',
                   ai_error = NULL, updated_at = now()
               WHERE id = %s
               RETURNING id, body_html, tags, ai_status""",
            (body_html, tags, product_id),
        ).fetchone()
        conn.execute(
            """INSERT INTO activity_events(product_id, event_type, message)
               VALUES (%s, 'ai_enriched', %s)""",
            (product_id, f"AI description generated for {html.escape(product['title'])}"),
        )
        conn.commit()
    return row


def enrich_many(product_ids: list[UUID]) -> dict:
    enriched, failed = 0, []
    for product_id in product_ids:
        try:
            enrich_product(product_id)
            enriched += 1
        except Exception as exc:
            failed.append({"id": str(product_id), "error": str(exc)})
            with connection() as conn:
                conn.execute(
                    """UPDATE products SET ai_status = 'failed', ai_error = %s,
                       updated_at = now() WHERE id = %s""",
                    (str(exc)[:1000], product_id),
                )
                conn.commit()
    return {"enriched": enriched, "failed": failed}
