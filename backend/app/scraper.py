import re
import time
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID

from playwright.sync_api import Page, sync_playwright

from .config import get_settings
from .db import connection
from .groq_service import enrich_product


CARD_SELECTORS = [
    ".m-productCard",
    "[data-testid='product-card']",
    ".product-card",
    ".o-productList__item",
]
BRAND_SELECTORS = [
    ".m-productCard__title",
    "[class*='productCard__title']",
    ".m-productCard__brand",
    "[class*='productCard__brand']",
    "[class*='brand']",
]
TITLE_SELECTORS = [
    ".m-productCard__desc",
    "[class*='productCard__desc']",
    "[class*='productCard__name']",
    "[class*='productName']",
    "[class*='product-name']",
    "[class*='product-title']",
    "h3",
    "h2",
]


def parse_price(raw: str | None) -> tuple[Decimal | None, str | None]:
    if not raw:
        return None, None
    value = re.sub(r"[^\d.,]", "", str(raw))
    if not value:
        return None, "Price text contains no digits"

    last_comma, last_dot = value.rfind(","), value.rfind(".")
    if last_comma == -1 and last_dot == -1:
        normalized = value
    elif last_comma > last_dot:
        normalized = value[:last_comma].replace(".", "").replace(",", "")
        decimals = re.sub(r"\D", "", value[last_comma + 1 :])[:2]
        normalized += f".{decimals.ljust(2, '0')}" if decimals else ""
    else:
        digits_after_dot = value[last_dot + 1 :]
        if last_comma == -1 and value.count(".") == 1 and len(digits_after_dot) in (1, 2):
            normalized = value
        else:
            normalized = value.replace(".", "").replace(",", "")

    try:
        price = Decimal(normalized)
    except InvalidOperation:
        return None, f"Could not parse price: {raw}"
    warning = None
    if price <= 0:
        warning = "Price is zero or negative"
    elif price > 250_000:
        warning = f"Suspiciously high price: {price} TRY"
    return price, warning


def _paged_url(url: str, page_number: int) -> str:
    parsed = urlparse(url)
    query = [(key, value) for key, value in parse_qsl(parsed.query) if key not in {"page", "sayfa"}]
    if page_number > 1:
        query.append(("sayfa", str(page_number)))
    return urlunparse(parsed._replace(query=urlencode(query)))


def validate_source_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in get_settings().allowed_source_hosts:
        raise ValueError("Source URL host is not allowed")


def _text(card, selectors: list[str], exclude: str = "") -> str:
    for selector in selectors:
        element = card.query_selector(selector)
        if element:
            candidate = element.inner_text().strip()
            if candidate and candidate != exclude:
                return candidate
    return ""


def _extract_product(card, source: str, category: str) -> dict | None:
    vendor = _text(card, BRAND_SELECTORS)
    title = _text(card, TITLE_SELECTORS, exclude=vendor)
    if not title:
        for line in (line.strip() for line in card.inner_text().splitlines()):
            if not line or line == vendor:
                continue
            if re.search(r"\d", line) and re.search(r"(tl|₺|\d[.,]\d{2}\b)", line, re.I):
                continue
            title = line
            break
    title = title or vendor
    if not title:
        return None

    sale_price, price_warning = None, None
    for selector in [
        ".m-productPrice__salePrice",
        "[class*='salePrice']",
        "[class*='sale-price']",
        "[class*='price']",
    ]:
        element = card.query_selector(selector)
        if element:
            sale_price, price_warning = parse_price(element.inner_text())
            break

    compare_at, compare_warning = None, None
    for selector in [
        ".m-productPrice__originalPrice",
        "[class*='originalPrice']",
        "[class*='original-price']",
        "[class*='old-price']",
    ]:
        element = card.query_selector(selector)
        if element:
            compare_at, compare_warning = parse_price(element.inner_text())
            break
    if compare_at and sale_price and compare_at <= sale_price:
        compare_at = None

    link = card.query_selector("a")
    href = (link.get_attribute("href") if link else "") or ""
    if href.startswith("/"):
        href = f"https://www.{source}{href}" if not source.startswith("www.") else f"https://{source}{href}"
    if not href:
        return None

    image_url = ""
    for selector in ["img[data-src]", "img[src]", "img"]:
        image = card.query_selector(selector)
        if image:
            image_url = image.get_attribute("data-src") or image.get_attribute("src") or ""
            if image_url.startswith("//"):
                image_url = f"https:{image_url}"
            break

    return {
        "source": source,
        "source_product_url": href,
        "title": title,
        "vendor": vendor,
        "category": category,
        "sale_price": sale_price,
        "compare_at_price": compare_at,
        "image_url": image_url,
        "price_warning": price_warning or compare_warning,
        "raw_data": {
            "title": title,
            "vendor": vendor,
            "category": category,
            "sale_price": str(sale_price) if sale_price is not None else None,
            "compare_at_price": str(compare_at) if compare_at is not None else None,
            "image_url": image_url,
            "source_product_url": href,
        },
    }


def _upsert_product(product: dict, workspace_id: UUID) -> UUID:
    with connection() as conn:
        row = conn.execute(
            """INSERT INTO products (
                 workspace_id, source, source_product_url, title, vendor, category,
                 sale_price, compare_at_price, image_url, price_warning, raw_data
               ) VALUES (
                 %(workspace_id)s, %(source)s, %(source_product_url)s, %(title)s, %(vendor)s, %(category)s,
                 %(sale_price)s, %(compare_at_price)s, %(image_url)s, %(price_warning)s,
                 %(raw_data)s::jsonb
               )
               ON CONFLICT (workspace_id, source, source_product_url) DO UPDATE SET
                 title = EXCLUDED.title,
                 vendor = EXCLUDED.vendor,
                 category = EXCLUDED.category,
                 sale_price = EXCLUDED.sale_price,
                 compare_at_price = EXCLUDED.compare_at_price,
                 image_url = EXCLUDED.image_url,
                 price_warning = EXCLUDED.price_warning,
                 raw_data = EXCLUDED.raw_data,
                 last_seen_at = now(),
                 updated_at = now()
               RETURNING id""",
            {
                **product,
                "workspace_id": workspace_id,
                "raw_data": __import__("json").dumps(product["raw_data"], ensure_ascii=False),
            },
        ).fetchone()
        conn.commit()
    return row["id"]


def _log(job_id: UUID, workspace_id: UUID, message: str, level: str = "info") -> None:
    with connection() as conn:
        conn.execute(
            """UPDATE scrape_jobs
               SET logs = logs || jsonb_build_array(
                 jsonb_build_object('at', now(), 'level', %s::text, 'message', %s::text)
               )
               WHERE id = %s""",
            (level, message, job_id),
        )
        conn.execute(
            """INSERT INTO activity_events(workspace_id, job_id, level, event_type, message)
               VALUES (%s, %s, %s, 'scrape_log', %s)""",
            (workspace_id, job_id, level, message),
        )
        conn.commit()


def _cancelled(job_id: UUID) -> bool:
    with connection() as conn:
        row = conn.execute("SELECT status FROM scrape_jobs WHERE id = %s", (job_id,)).fetchone()
    return not row or row["status"] == "cancelled"


def run_scrape_job(job: dict) -> None:
    job_id = job["id"]
    workspace_id = job["workspace_id"]
    validate_source_url(job["category_url"])
    source_host = urlparse(job["category_url"]).hostname or job["source"]
    found, warnings = 0, 0
    _log(job_id, workspace_id, f"Starting {job['category_name']} from {source_host}")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
            locale="tr-TR",
        )
        page: Page = context.new_page()
        for page_index in range(job["max_pages"]):
            if _cancelled(job_id):
                _log(job_id, workspace_id, "Job cancelled by user", "warning")
                browser.close()
                return

            page_number = job["start_page"] + page_index
            url = _paged_url(job["category_url"], page_number)
            _log(job_id, workspace_id, f"Collecting page {page_number}")
            page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(2500)

            cards = []
            matched_selector = ""
            for selector in CARD_SELECTORS:
                cards = page.query_selector_all(selector)
                if cards:
                    matched_selector = selector
                    break
            if not cards:
                _log(job_id, workspace_id, f"No product cards found on page {page_number}", "warning")
                break
            _log(job_id, workspace_id, f"Found {len(cards)} cards with {matched_selector}")

            page_product_ids: list[UUID] = []
            for card in cards:
                try:
                    product = _extract_product(card, source_host, job["category_name"])
                    if not product:
                        continue
                    product_id = _upsert_product(product, workspace_id)
                    page_product_ids.append(product_id)
                    found += 1
                    warnings += int(bool(product["price_warning"]))
                except Exception as exc:
                    _log(job_id, workspace_id, f"Skipped one product card: {exc}", "warning")

            progress = int(((page_index + 1) / job["max_pages"]) * 100)
            with connection() as conn:
                conn.execute(
                    """UPDATE scrape_jobs
                       SET progress = %s, pages_completed = %s,
                           products_found = %s, warning_count = %s
                       WHERE id = %s""",
                    (progress, page_index + 1, found, warnings, job_id),
                )
                conn.commit()

            if job["auto_enrich"]:
                for product_id in page_product_ids:
                    try:
                        enrich_product(product_id, workspace_id, job["seo_language"])
                    except Exception as exc:
                        _log(job_id, workspace_id, f"AI enrichment failed for {product_id}: {exc}", "warning")
            time.sleep(1.2)
        browser.close()

    with connection() as conn:
        conn.execute(
            """UPDATE scrape_jobs SET status = 'completed', progress = 100,
               products_found = %s, warning_count = %s, completed_at = now()
               WHERE id = %s AND status <> 'cancelled'""",
            (found, warnings, job_id),
        )
        conn.execute(
            """INSERT INTO activity_events(workspace_id, job_id, event_type, message, metadata)
               VALUES (%s, %s, 'scrape_completed', %s, jsonb_build_object(
                 'products_found', %s, 'warnings', %s
               ))""",
            (workspace_id, job_id, f"Scrape completed with {found} products", found, warnings),
        )
        conn.commit()
    _log(job_id, workspace_id, f"Completed: {found} products, {warnings} warnings")
