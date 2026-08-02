import html
import re
import time
from uuid import UUID

import httpx

from .config import get_settings
from .db import connection


LANGUAGES = {
    "tr": "Turkish",
    "en": "English",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "pl": "Polish",
    "ar": "Arabic",
    "it": "Italian",
}


def system_prompt(language: str) -> str:
    language_name = LANGUAGES.get(language, LANGUAGES["tr"])
    return f"""You are a senior Shopify ecommerce copywriter.
Return only simple Shopify-safe HTML using <p>, <ul>, <li>, and <strong>.
Write one compact original paragraph and 2-3 short feature bullets, under 120 words total.
Write entirely in {language_name}.
Never mention the source retailer or invent product facts.
Use a premium, trustworthy, sales-focused tone without exaggerated claims.
Your response MUST begin with <p> and contain only the finished storefront HTML.
Never output analysis, reasoning, planning, notes, labels, markdown, or commentary."""


def _clean_html(value: str) -> str:
    value = re.sub(r"<think\b[^>]*>.*?</think>", "", value, flags=re.I | re.S)
    value = re.sub(r"```(?:html)?|```", "", value, flags=re.I)
    paragraph = re.search(r"<p\b[^>]*>.*?</p>", value, flags=re.I | re.S)
    if not paragraph:
        return ""
    lists = re.findall(r"<ul\b[^>]*>.*?</ul>", value[paragraph.end():], flags=re.I | re.S)
    if not lists or len(re.findall(r"<li\b", lists[0], flags=re.I)) < 2:
        return ""
    cleaned = paragraph.group(0) + "".join(lists[:1])
    cleaned = re.sub(r"<(p|ul|li|strong)\b[^>]*>", r"<\1>", cleaned, flags=re.I)
    cleaned = re.sub(r"<(?!/?(?:p|ul|li|strong)\b)[^>]*>", "", cleaned, flags=re.I)
    visible = re.sub(r"<[^>]+>", " ", cleaned)
    visible = re.sub(r"\s+", " ", html.unescape(visible)).strip()
    if len(visible) < 40 or re.search(r"\b(?:steps?|reasoning|analysis|instructions?|we are writing|let me)\b", visible, flags=re.I):
        return ""
    return cleaned.strip()


def _groq_completion(settings, messages: list[dict]) -> str:
    if not settings.groq_api_key:
        raise RuntimeError("GROQ_API_KEY is not configured")
    response = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.groq_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": settings.groq_model,
            "temperature": 0.35,
            "max_completion_tokens": 320,
            "messages": messages,
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def _ollama_completion(settings, messages: list[dict]) -> str:
    last_error: Exception | None = None
    for attempt in range(1, 5):
        try:
            response = httpx.post(
                f"{settings.ollama_url.rstrip('/')}/api/chat",
                json={
                    "model": settings.ollama_model,
                    "messages": messages,
                    "stream": False,
                    "think": False,
                    "keep_alive": "24h",
                    "options": {
                        "temperature": 0.35,
                        "num_predict": 320,
                        "num_ctx": 2048,
                        "num_thread": 4,
                    },
                },
                timeout=180,
            )
            response.raise_for_status()
            return response.json()["message"]["content"]
        except (httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError) as exc:
            last_error = exc
            if attempt < 4:
                time.sleep(attempt * 2)
    raise RuntimeError(f"ScrapifyAI is unavailable after 4 connection attempts: {last_error}")


def _generate(settings, messages: list[dict]) -> tuple[str, str]:
    provider = settings.ai_provider.lower()
    if provider == "ollama":
        return _ollama_completion(settings, messages), "ollama"
    if provider == "groq":
        return _groq_completion(settings, messages), "groq"
    try:
        return _groq_completion(settings, messages), "groq"
    except (RuntimeError, httpx.HTTPStatusError) as exc:
        if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code != 429:
            raise
        return _ollama_completion(settings, messages), "ollama"


def enrich_product(product_id: UUID | str, workspace_id: UUID | str, language: str = "tr") -> dict:
    settings = get_settings()

    with connection() as conn:
        product = conn.execute(
            """SELECT id, title, vendor, category, sale_price
               FROM products WHERE id = %s AND workspace_id = %s""",
            (product_id, workspace_id),
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
    messages = [
        {"role": "system", "content": system_prompt(language)},
        {"role": "user", "content": f"/no_think\n{facts}\nBegin immediately with <p>. Output only the finished HTML."},
    ]
    body_html, provider = "", ""
    for generation_attempt in range(1, 4):
        content, provider = _generate(settings, messages)
        body_html = _clean_html(content)
        if body_html:
            break
        messages = [
            {"role": "system", "content": system_prompt(language)},
            {"role": "user", "content": f"/no_think\n{facts}\nYour previous format was rejected. Start with <p>, add one <ul>, and output nothing else. Attempt {generation_attempt + 1}."},
        ]
    if not body_html:
        raise RuntimeError("ScrapifyAI returned reasoning instead of valid storefront HTML")

    tags = sorted({item for item in [product["vendor"], product["category"], "parfum"] if item})
    with connection() as conn:
        row = conn.execute(
            """UPDATE products
               SET body_html = %s, tags = %s, ai_status = 'enriched',
                   ai_error = NULL, seo_language = %s, updated_at = now()
               WHERE id = %s AND workspace_id = %s
               RETURNING id, body_html, tags, ai_status""",
            (body_html, tags, language, product_id, workspace_id),
        ).fetchone()
        conn.execute(
            """INSERT INTO activity_events(workspace_id, product_id, event_type, message, metadata)
               VALUES (%s, %s, 'ai_enriched', %s, jsonb_build_object('language', %s::text))""",
            (
                workspace_id,
                product_id,
                f"AI description generated for {html.escape(product['title'])}",
                language,
            ),
        )
        conn.commit()
    return {**row, "provider": provider}


def enrich_many(product_ids: list[UUID], workspace_id: UUID, language: str = "tr") -> dict:
    enriched, failed = 0, []
    for product_id in product_ids:
        try:
            enrich_product(product_id, workspace_id, language)
            enriched += 1
        except Exception as exc:
            failed.append({"id": str(product_id), "error": str(exc)})
            with connection() as conn:
                conn.execute(
                    """UPDATE products SET ai_status = 'failed', ai_error = %s,
                       updated_at = now() WHERE id = %s AND workspace_id = %s""",
                    (str(exc)[:1000], product_id, workspace_id),
                )
                conn.commit()
    return {"enriched": enriched, "failed": failed}
