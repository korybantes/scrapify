import hashlib
import ipaddress
import socket
import re
import time
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
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

PRICE_TOKEN_PATTERN = re.compile(
    r"(?<![%\d])(?:"
    r"\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?"
    r"|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?"
    r"|\d+,\d{1,2}"
    r"|\d+\.\d{1,2}"
    r"|\d+"
    r")(?!\d)"
)
BEYMEN_PRODUCT_ID_PATTERN = re.compile(r"_(\d+)(?:[/?#]|$)")


def parse_price(raw: str | None) -> tuple[Decimal | None, str | None]:
    if not raw:
        return None, None
    match = PRICE_TOKEN_PATTERN.search(str(raw).replace("\xa0", " "))
    if not match:
        return None, "Price text contains no digits"
    value = match.group(0).replace(" ", "")

    last_comma, last_dot = value.rfind(","), value.rfind(".")
    if last_comma == -1 and last_dot == -1:
        normalized = value
    elif last_comma > last_dot:
        decimals = value[last_comma + 1 :]
        if last_dot >= 0 or len(decimals) in (1, 2):
            normalized = value[:last_comma].replace(".", "").replace(",", "")
            normalized += f".{decimals.ljust(2, '0')}" if decimals else ""
        else:
            normalized = value.replace(",", "")
    else:
        digits_after_dot = value[last_dot + 1 :]
        if last_comma >= 0:
            normalized = value.replace(",", "")
        elif value.count(".") == 1 and len(digits_after_dot) in (1, 2):
            normalized = value
        else:
            normalized = value.replace(".", "")

    try:
        price = Decimal(normalized)
    except InvalidOperation:
        return None, f"Could not parse price: {raw}"
    if price >= Decimal("1000000000000"):
        return None, "Price exceeds the database storage limit"
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


def validate_source_url(url: str, workspace_id: UUID | None = None) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("A public HTTPS source URL is required")
    if parsed.hostname in get_settings().allowed_source_hosts:
        return
    if not workspace_id:
        raise ValueError("Source URL host is not allowed")
    with connection() as conn:
        allowed = conn.execute(
            "SELECT 1 FROM source_adapters WHERE workspace_id = %s AND source_host = %s AND status = 'verified'",
            (workspace_id, parsed.hostname),
        ).fetchone()
    if not allowed:
        raise ValueError("Verify this source in Source Builder before running it")


def _text(card, selectors: list[str], exclude: str = "") -> str:
    for selector in selectors:
        element = card.query_selector(selector)
        if element:
            candidate = element.inner_text().strip()
            if candidate and candidate != exclude:
                return candidate
    return ""


def _image_record(url: str, alt: str, position: int) -> dict:
    return {
        "id": hashlib.md5(url.encode("utf-8")).hexdigest(),
        "url": url,
        "source_url": url,
        "position": position,
        "alt": alt,
        "variant_ids": [],
        "processing_status": "original",
    }

def _extract_product(card, source: str, category: str, adapter: dict | None = None) -> dict | None:
    adapter = adapter or {}
    vendor = _text(card, [adapter["vendor"]] if adapter.get("vendor") else BRAND_SELECTORS)
    title = _text(card, [adapter["title"]] if adapter.get("title") else TITLE_SELECTORS, exclude=vendor)
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

    campaign_sale = bool(card.query_selector(".m-productCard__campaignPrice"))
    sale_selectors = [
        ".m-productCard__campaignPrice",
        ".m-productCard__newPrice",
        ".m-productPrice__salePrice",
        "[class*='salePrice']",
        "[class*='sale-price']",
        "[class*='price']",
    ]
    if adapter.get("price"):
        sale_selectors = [adapter["price"]]
    sale_price, price_warning = None, None
    for selector in sale_selectors:
        element = card.query_selector(selector)
        if element:
            sale_price, price_warning = parse_price(element.inner_text())
            break

    compare_selectors = [
        ".m-productCard__newPrice" if campaign_sale else ".m-productCard__oldPrice",
        ".m-productCard__oldPrice",
        ".m-productPrice__originalPrice",
        "[class*='originalPrice']",
        "[class*='original-price']",
        "[class*='old-price']",
    ]
    compare_at, compare_warning = None, None
    for selector in compare_selectors:
        element = card.query_selector(selector)
        if element:
            compare_at, compare_warning = parse_price(element.inner_text())
            break
    if compare_at and sale_price and compare_at <= sale_price:
        compare_at = None

    link = card.query_selector(adapter.get("link") or "a")
    href = (link.get_attribute("href") if link else "") or ""
    if href:
        href = urljoin(f"https://{source}", href)
    if not href:
        return None

    image_url = ""
    for selector in ([adapter["image"]] if adapter.get("image") else ["img[data-src]", "img[src]", "img"]):
        image = card.query_selector(selector)
        if image:
            image_url = image.get_attribute("data-src") or image.get_attribute("src") or ""
            if image_url.startswith("//"):
                image_url = f"https:{image_url}"
            break

    images = [_image_record(image_url, title, 1)] if image_url else []
    return {
        "source": source,
        "source_product_url": href,
        "title": title,
        "vendor": vendor,
        "category": category,
        "sale_price": sale_price,
        "compare_at_price": compare_at,
        "image_url": image_url,
        "images": images,
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


def _beymen_product_id(product_url: str) -> int | None:
    match = BEYMEN_PRODUCT_ID_PATTERN.search(product_url)
    return int(match.group(1)) if match else None


def _normalize_beymen_summary(payload: dict | None) -> dict:
    result = (payload or {}).get("result") or {}
    option_name = str(result.get("variant") or "Beden").strip()
    variants = []
    for size in result.get("sizes") or []:
        option_value = str(size.get("sizeName") or "").strip()
        if not option_value:
            continue
        try:
            inventory_qty = max(0, int(size.get("stockQuantity") or 0))
        except (TypeError, ValueError):
            inventory_qty = 0
        variants.append({
            "source_variant_id": str(size.get("variantId") or ""),
            "option_name": option_name,
            "option_value": option_value,
            "sku": str(size.get("variantCode") or ""),
            "barcode": str(size.get("variantBarcode") or ""),
            "inventory_qty": inventory_qty,
            "available": bool(size.get("inStock")) and inventory_qty > 0,
        })
    try:
        aggregate_inventory = max(0, int(result.get("stockQuantity") or 0))
    except (TypeError, ValueError):
        aggregate_inventory = 0
    if variants:
        aggregate_inventory = sum(variant["inventory_qty"] for variant in variants)
    primary_image = str(result.get("image") or "").replace("{width}", "1600").replace("{height}", "1600")
    return {
        "loaded": bool(result),
        "variants": variants,
        "inventory_qty": aggregate_inventory,
        "option_name": option_name,
        "vendor": str(result.get("brandName") or "").strip(),
        "title": str(result.get("displayName") or "").strip(),
        "images": [_image_record(primary_image, str(result.get("displayName") or ""), 1)] if primary_image else [],
    }


def test_source_adapter(adapter_id: UUID, workspace_id: UUID, url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("A public HTTPS URL is required")
    for result in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM):
        address = ipaddress.ip_address(result[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
            raise ValueError("Private network source URLs are not allowed")
    with connection() as conn:
        adapter_row = conn.execute(
            "SELECT source_host, config FROM source_adapters WHERE id = %s AND workspace_id = %s",
            (adapter_id, workspace_id),
        ).fetchone()
    if not adapter_row or adapter_row["source_host"] != parsed.hostname:
        raise ValueError("Source adapter does not match this URL")
    adapter = adapter_row["config"] or {}
    card_selector = adapter.get("card")
    if not card_selector:
        raise ValueError("A product-card selector is required")
    products = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(url, wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_timeout(2500)
        cards = page.query_selector_all(card_selector)
        for card in cards[:10]:
            product = _extract_product(card, parsed.hostname, "Preview", adapter)
            if product:
                products.append({
                    "title": product["title"], "vendor": product["vendor"],
                    "price": str(product["sale_price"] or ""), "image_url": product["image_url"],
                    "url": product["source_product_url"],
                })
        browser.close()
    if not products:
        raise ValueError("No valid products matched these selectors")
    return {"count": len(cards), "products": products}

def _load_beymen_summaries(page: Page, product_ids: list[int]) -> dict[str, dict]:
    if not product_ids:
        return {}
    return page.evaluate(
        """async (ids) => {
          const results = {};
          let cursor = 0;
          async function worker() {
            while (cursor < ids.length) {
              const id = ids[cursor++];
              try {
                const response = await fetch(`/sf-api/api/product/${id}/productsummary`, {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                });
                if (response.ok) results[String(id)] = await response.json();
              } catch (_) {}
            }
          }
          await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
          return results;
        }""",
        product_ids,
    )


def _load_beymen_details(page: Page, products: list[dict]) -> dict[str, dict]:
    if not products:
        return {}
    return page.evaluate(
        """async (items) => {
          const results = {};
          let cursor = 0;
          function productNode(value) {
            if (!value) return null;
            if (Array.isArray(value)) {
              for (const item of value) { const found = productNode(item); if (found) return found; }
              return null;
            }
            if (typeof value !== "object") return null;
            const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
            if (types.includes("Product")) return value;
            if (value["@graph"]) return productNode(value["@graph"]);
            return null;
          }
          async function worker() {
            while (cursor < items.length) {
              const item = items[cursor++];
              try {
                const response = await fetch(item.url, { credentials: "same-origin" });
                if (!response.ok) continue;
                const html = await response.text();
                const document = new DOMParser().parseFromString(html, "text/html");
                let product = null;
                for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
                  try { product = productNode(JSON.parse(script.textContent || "null")); } catch (_) {}
                  if (product) break;
                }
                if (!product) continue;
                const rawImages = Array.isArray(product.image) ? product.image : [product.image];
                results[String(item.id)] = {
                  title: String(product.name || "").trim(),
                  vendor: String(product.brand?.name || product.brand || "").trim(),
                  images: rawImages.map(String).filter(url => url.startsWith("https://")),
                };
              } catch (_) {}
            }
          }
          await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker));
          return results;
        }""",
        products,
    )

def _merge_product_images(incoming: list[dict], existing: list[dict]) -> list[dict]:
    incoming_sources = {
        str(item.get("source_url") or item.get("url") or "")
        for item in incoming if item.get("source_url") or item.get("url")
    }
    # Replace the old single card thumbnail once the product page exposes a real gallery.
    # Keep galleries that users reordered, processed, captioned, or mapped to variants.
    if len(existing) == 1 and len(incoming) > 1:
        legacy = existing[0]
        legacy_source = str(legacy.get("source_url") or legacy.get("url") or "")
        customized = (
            legacy.get("processing_status") not in {None, "", "original"}
            or bool(legacy.get("variant_ids"))
            or bool(legacy.get("sha256"))
        )
        if legacy_source not in incoming_sources and not customized:
            existing = []
    merged = []
    seen = set()
    incoming_by_source = {
        str(item.get("source_url") or item.get("url") or ""): item
        for item in incoming if item.get("source_url") or item.get("url")
    }
    for stored in existing:
        key = str(stored.get("source_url") or stored.get("url") or "")
        if not key or key in seen:
            continue
        merged.append({**incoming_by_source.get(key, {}), **stored})
        seen.add(key)
    for item in incoming:
        key = str(item.get("source_url") or item.get("url") or "")
        if not key or key in seen:
            continue
        merged.append(item)
        seen.add(key)
    return [dict(item, position=index + 1) for index, item in enumerate(merged)]

def _upsert_product(product: dict, workspace_id: UUID, job_id: UUID) -> UUID:
    import json
    tracked_fields = ["title", "vendor", "category", "sale_price", "compare_at_price", "image_url", "images", "inventory_qty", "variants"]
    with connection() as conn:
        existing = conn.execute(
            """SELECT * FROM products WHERE workspace_id = %s AND source = %s AND source_product_url = %s""",
            (workspace_id, product["source"], product["source_product_url"]),
        ).fetchone()
        product["images"] = _merge_product_images(product.get("images") or [], list(existing.get("images") or []) if existing else [])
        product["image_url"] = str(product["images"][0].get("url") or "") if product["images"] else product.get("image_url", "")
        product["raw_data"]["images"] = product["images"]
        approval_row = conn.execute(
            """SELECT coalesce(recipe.approval_required, false) AS required
               FROM scrape_jobs job LEFT JOIN automation_recipes recipe ON recipe.id = job.automation_recipe_id
               WHERE job.id = %s""",
            (job_id,),
        ).fetchone()
        approval_required = bool(approval_row and approval_row["required"])
        changed = []
        if existing:
            for field in tracked_fields:
                incoming = product.get(field)
                if field == "variants" and not product.get("variants_loaded"):
                    continue
                current = existing.get(field)
                if str(current or "") != str(incoming or ""):
                    changed.append((field, current, incoming))
            if changed:
                snapshot = {field: existing.get(field) for field in tracked_fields}
                conn.execute(
                    """INSERT INTO product_versions(workspace_id,product_id,snapshot,source)
                       VALUES(%s,%s,%s::jsonb,'source_monitor')""",
                    (workspace_id, existing["id"], json.dumps(snapshot, default=str, ensure_ascii=False)),
                )

        if existing and approval_required and changed:
            conn.execute(
                """UPDATE products SET raw_data=%s::jsonb,last_seen_at=now(),updated_at=now()
                   WHERE id=%s""",
                (json.dumps(product["raw_data"], ensure_ascii=False), existing["id"]),
            )
            product_id = existing["id"]
        else:
            row = conn.execute(
                """INSERT INTO products (
                     workspace_id, source, source_product_url, title, vendor, category,
                     sale_price, compare_at_price, image_url, price_warning, raw_data,
                     variants, inventory_qty, images
                   ) VALUES (
                     %(workspace_id)s, %(source)s, %(source_product_url)s, %(title)s, %(vendor)s, %(category)s,
                     %(sale_price)s, %(compare_at_price)s, %(image_url)s, %(price_warning)s,
                     %(raw_data)s::jsonb, %(variants)s::jsonb, %(inventory_qty)s, %(images)s::jsonb
                   )
                   ON CONFLICT (workspace_id, source, source_product_url) DO UPDATE SET
                     title=EXCLUDED.title,vendor=EXCLUDED.vendor,category=EXCLUDED.category,
                     sale_price=EXCLUDED.sale_price,compare_at_price=EXCLUDED.compare_at_price,
                     image_url=EXCLUDED.image_url,images=EXCLUDED.images,price_warning=EXCLUDED.price_warning,raw_data=EXCLUDED.raw_data,
                     variants=CASE WHEN %(variants_loaded)s THEN EXCLUDED.variants ELSE products.variants END,
                     inventory_qty=CASE WHEN %(variants_loaded)s THEN EXCLUDED.inventory_qty ELSE products.inventory_qty END,
                     last_seen_at=now(),updated_at=now() RETURNING id""",
                {**product,"workspace_id":workspace_id,"raw_data":json.dumps(product["raw_data"],ensure_ascii=False),"variants":json.dumps(product.get("variants") or [],ensure_ascii=False),"images":json.dumps(product.get("images") or [],ensure_ascii=False),"inventory_qty":product.get("inventory_qty",0),"variants_loaded":bool(product.get("variants_loaded"))},
            ).fetchone()
            product_id = row["id"]

        change_ids = []
        for field, old_value, new_value in changed:
            status = "pending" if approval_required else "applied"
            row = conn.execute(
                """INSERT INTO catalog_changes(workspace_id,product_id,field,old_value,new_value,source,status,reviewed_at)
                   SELECT %s,%s,%s,%s::jsonb,%s::jsonb,'source',%s,CASE WHEN %s='applied' THEN now() END
                   WHERE NOT EXISTS (SELECT 1 FROM catalog_changes WHERE product_id=%s AND field=%s AND status='pending' AND new_value=%s::jsonb)
                   RETURNING id""",
                (workspace_id,product_id,field,json.dumps(old_value,default=str),json.dumps(new_value,default=str),status,status,product_id,field,json.dumps(new_value,default=str)),
            ).fetchone()
            if row:
                change_ids.append(row["id"])
        if approval_required and change_ids:
            conn.execute(
                """INSERT INTO approval_requests(workspace_id,product_id,change_ids,requested_by,note)
                   VALUES(%s,%s,%s,'Automation','Source changes require approval')""",
                (workspace_id, product_id, change_ids),
            )
        if not existing:
            snapshot = {field: product.get(field) for field in tracked_fields}
            conn.execute(
                """INSERT INTO product_versions(workspace_id,product_id,snapshot,source)
                   VALUES(%s,%s,%s::jsonb,'initial_scrape')""",
                (workspace_id, product_id, json.dumps(snapshot, default=str, ensure_ascii=False)),
            )
        conn.execute(
            """INSERT INTO scrape_job_products(job_id,product_id,workspace_id) VALUES(%s,%s,%s)
               ON CONFLICT(job_id,product_id) DO NOTHING""",
            (job_id, product_id, workspace_id),
        )
        conn.commit()
    return product_id

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
    validate_source_url(job["category_url"], workspace_id)
    source_host = urlparse(job["category_url"]).hostname or job["source"]
    found, warnings = 0, 0
    adapter = {}
    if job.get("source_adapter_id"):
        with connection() as conn:
            row = conn.execute(
                "SELECT config FROM source_adapters WHERE id = %s AND workspace_id = %s",
                (job["source_adapter_id"], workspace_id),
            ).fetchone()
            adapter = row["config"] if row else {}
    card_selectors = [adapter["card"]] if adapter.get("card") else CARD_SELECTORS
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
            for selector in card_selectors:
                cards = page.query_selector_all(selector)
                if cards:
                    matched_selector = selector
                    break
            if not cards:
                _log(job_id, workspace_id, f"No product cards found on page {page_number}", "warning")
                break
            _log(job_id, workspace_id, f"Found {len(cards)} cards with {matched_selector}")

            extracted_products: list[dict] = []
            for card in cards:
                try:
                    product = _extract_product(card, source_host, job["category_name"], adapter)
                    if not product:
                        continue
                    extracted_products.append(product)
                except Exception as exc:
                    _log(job_id, workspace_id, f"Skipped one product card: {exc}", "warning")

            beymen_ids = [
                product_id for product in extracted_products
                if (product_id := _beymen_product_id(product["source_product_url"])) is not None
            ] if source_host.endswith("beymen.com") else []
            summaries = _load_beymen_summaries(page, list(dict.fromkeys(beymen_ids)))
            details = _load_beymen_details(page, [
                {"id": product_id, "url": product["source_product_url"]}
                for product in extracted_products
                if (product_id := _beymen_product_id(product["source_product_url"])) is not None
            ]) if beymen_ids else {}
            variant_products = 0
            page_product_ids: list[UUID] = []
            for product in extracted_products:
                try:
                    source_product_id = _beymen_product_id(product["source_product_url"])
                    summary = _normalize_beymen_summary(summaries.get(str(source_product_id))) if source_product_id else {"loaded": False}
                    detail = details.get(str(source_product_id), {}) if source_product_id else {}
                    product["vendor"] = detail.get("vendor") or summary.get("vendor") or product["vendor"]
                    product["title"] = detail.get("title") or summary.get("title") or product["title"]
                    gallery_urls = detail.get("images") or [item.get("url") for item in summary.get("images", [])]
                    if gallery_urls:
                        gallery_urls = list(dict.fromkeys(url for url in gallery_urls if url))[:20]
                        product["images"] = [_image_record(url, product["title"], index + 1) for index, url in enumerate(gallery_urls)]
                        product["image_url"] = product["images"][0]["url"]
                    product["raw_data"].update({"title": product["title"], "vendor": product["vendor"], "images": product.get("images", [])})
                    product["variants_loaded"] = bool(summary.get("loaded"))
                    if product["variants_loaded"]:
                        product["variants"] = summary["variants"]
                        product["inventory_qty"] = summary["inventory_qty"]
                        product["raw_data"]["variants"] = summary["variants"]
                        product["raw_data"]["variant_option_name"] = summary["option_name"]
                        variant_products += int(bool(summary["variants"]))
                    product_id = _upsert_product(product, workspace_id, job_id)
                    page_product_ids.append(product_id)
                    found += 1
                    warnings += int(bool(product["price_warning"]))
                except Exception as exc:
                    _log(job_id, workspace_id, f"Could not save one product: {exc}", "warning")
            if beymen_ids:
                _log(job_id, workspace_id, f"Loaded galleries plus real size and stock variants for {variant_products} products")

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
