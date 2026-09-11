import html
import html
import json
import re
import time
from uuid import UUID

import httpx

from .config import get_settings
from .db import connection


DEFAULT_GROQ_MODEL = "qwen/qwen3.6-27b"
RETIRED_GROQ_MODELS = {"llama-3.3-70b-versatile", "llama-3.1-8b-instant"}


def _active_groq_model(configured: str | None) -> str:
    model = (configured or "").strip()
    return DEFAULT_GROQ_MODEL if not model or model in RETIRED_GROQ_MODELS else model


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


def system_prompt(language: str, profile: dict | None = None) -> str:
    language_name = LANGUAGES.get(language, LANGUAGES["tr"])
    profile = profile or {}
    brand_rules = ""
    if profile.get("brand_voice"): brand_rules += f"\nBrand voice: {profile['brand_voice']}."
    if profile.get("target_keywords"): brand_rules += f"\nUse these keywords naturally when factual: {', '.join(profile['target_keywords'])}."
    if profile.get("forbidden_words"): brand_rules += f"\nNever use these words: {', '.join(profile['forbidden_words'])}."
    return f"""You are a senior Shopify ecommerce copywriter.
Return only simple Shopify-safe HTML using <p>, <ul>, <li>, and <strong>.
Write one compact original paragraph and 2-3 short feature bullets, under 120 words total.
Write entirely in {language_name}.
Never mention the source retailer or invent product facts.
Use a premium, trustworthy, sales-focused tone without exaggerated claims.
Your response MUST begin with <p> and contain only the finished storefront HTML.
Never output analysis, reasoning, planning, notes, labels, markdown, or commentary.{brand_rules}"""


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
            "model": _active_groq_model(settings.groq_model),
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
                        "num_predict": 240,
                        "num_ctx": 1536,
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
    except (RuntimeError, httpx.HTTPError):
        return _ollama_completion(settings, messages), "ollama"


def enrich_product(product_id: UUID | str, workspace_id: UUID | str, language: str = "tr") -> dict:
    settings = get_settings()

    with connection() as conn:
        product = conn.execute(
            """SELECT product.id,product.title,product.vendor,product.category,product.sale_price,
                      profile.brand_voice,profile.target_keywords,profile.forbidden_words
               FROM products product LEFT JOIN workspace_catalog_profiles profile ON profile.workspace_id=product.workspace_id
               WHERE product.id = %s AND product.workspace_id = %s""",
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
        {"role": "system", "content": system_prompt(language, product)},
        {"role": "user", "content": f"/no_think\n{facts}\nBegin immediately with <p>. Output only the finished HTML."},
    ]
    body_html, provider = "", ""
    for generation_attempt in range(1, 4):
        content, provider = _generate(settings, messages)
        body_html = _clean_html(content)
        if body_html:
            break
        messages = [
            {"role": "system", "content": system_prompt(language, product)},
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

def translate_many(product_ids: list[UUID], workspace_id: UUID, language: str, market: str = "") -> dict:
    settings = get_settings()
    completed, failed = 0, []
    with connection() as conn:
        products = conn.execute(
            """SELECT product.id,product.title,product.vendor,product.category,product.sale_price,
                      profile.brand_voice,profile.target_keywords,profile.forbidden_words
               FROM products product LEFT JOIN workspace_catalog_profiles profile ON profile.workspace_id=product.workspace_id
               WHERE product.workspace_id=%s AND product.id=ANY(%s)""",
            (workspace_id, product_ids),
        ).fetchall()
    for product in products:
        try:
            facts = "\n".join([
                f"Product: {product['title']}", f"Brand: {product['vendor'] or 'Unknown'}",
                f"Category: {product['category'] or 'Unknown'}", f"Price: {product['sale_price'] or 'Unknown'} TRY",
            ])
            prompt = system_prompt(language, product) + "\nReturn <title>translated concise product title</title> followed immediately by the required <p> and <ul>."
            messages = [
                {"role":"system","content":prompt},
                {"role":"user","content":f"/no_think\n{facts}\nOutput only <title>, <p>, and <ul>."},
            ]
            content, provider = _generate(settings, messages)
            content = re.sub(r"<think\b[^>]*>.*?</think>", "", content, flags=re.I | re.S)
            title_match = re.search(r"<title\b[^>]*>(.*?)</title>", content, flags=re.I | re.S)
            body_html = _clean_html(content)
            translated_title = html.unescape(re.sub(r"<[^>]+>", "", title_match.group(1))).strip() if title_match else product["title"]
            if not body_html:
                raise RuntimeError("ScrapifyAI returned an invalid translation")
            with connection() as conn:
                conn.execute(
                    """INSERT INTO product_translations(workspace_id,product_id,locale,market,title,body_html,status,provider)
                       VALUES(%s,%s,%s,%s,%s,%s,'ready',%s)
                       ON CONFLICT(product_id,locale,market) DO UPDATE SET title=EXCLUDED.title,
                         body_html=EXCLUDED.body_html,status='ready',provider=EXCLUDED.provider,updated_at=now()""",
                    (workspace_id,product["id"],language,market,translated_title,body_html,provider),
                )
                conn.commit()
            completed += 1
        except Exception as exc:
            failed.append({"id":str(product["id"]),"error":str(exc)})
    return {"completed":completed,"failed":failed,"locale":language,"market":market}

def suggest_category(products: list[dict], candidates: list[dict]) -> dict:
    settings = get_settings()
    allowed = {candidate["id"]: candidate for candidate in candidates}
    messages = [
        {
            "role": "system",
            "content": (
                "Choose exactly one Shopify taxonomy candidate for these products. "
                "Return JSON only with id, confidence from 0 to 100, and a short reason. "
                "Never invent an ID. Do not output reasoning or markdown."
            ),
        },
        {
            "role": "user",
            "content": "/no_think\n" + json.dumps(
                {"products": products, "candidates": candidates},
                ensure_ascii=False,
            ),
        },
    ]
    content, provider = _generate(settings, messages)
    content = re.sub(r"<think\b[^>]*>.*?</think>", "", content, flags=re.I | re.S)
    content = re.sub(r"```(?:json)?|```", "", content, flags=re.I).strip()
    match = re.search(r"\{.*\}", content, flags=re.S)
    if not match:
        raise RuntimeError("ScrapifyAI returned an invalid category response")
    result = json.loads(match.group(0))
    candidate = allowed.get(str(result.get("id", "")))
    if not candidate:
        raise RuntimeError("ScrapifyAI selected an unknown category")
    return {
        "id": candidate["id"],
        "breadcrumb": candidate["breadcrumb"],
        "confidence": max(0, min(100, int(result.get("confidence", 75)))),
        "reason": str(result.get("reason", "Best match for this selection"))[:240],
        "provider": provider,
    }
