from uuid import UUID

import httpx
from slugify import slugify

from .config import get_settings
from .db import connection


PRODUCT_SET_MUTATION = """
mutation UpsertProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, identifier: $identifier, synchronous: true) {
    product { id handle status }
    userErrors { field message code }
  }
}
"""


def sync_product(product_id: UUID | str, workspace_id: UUID | str) -> dict:
    settings = get_settings()
    if not settings.shopify_store_domain or not settings.shopify_access_token:
        raise RuntimeError("Shopify credentials are not configured")

    with connection() as conn:
        product = conn.execute(
            "SELECT * FROM products WHERE id = %s AND workspace_id = %s",
            (product_id, workspace_id),
        ).fetchone()
    if not product:
        raise ValueError("Product not found")

    handle = slugify(product["title"]) or f"scrappify-{product['id']}"
    variant = {
        "optionValues": [{"optionName": "Title", "name": "Default Title"}],
        "price": str(product["sale_price"] or "0.00"),
        "inventoryItem": {"sku": str(product["id"])},
    }
    if product["compare_at_price"] and product["compare_at_price"] > (product["sale_price"] or 0):
        variant["compareAtPrice"] = str(product["compare_at_price"])

    variables = {
        "identifier": {"handle": handle},
        "input": {
            "title": product["title"],
            "handle": handle,
            "descriptionHtml": product["body_html"],
            "vendor": product["vendor"],
            "productType": product["category"],
            "tags": product["tags"],
            "status": "ACTIVE" if product["published"] else "DRAFT",
            "productOptions": [{"name": "Title", "values": [{"name": "Default Title"}]}],
            "variants": [variant],
        },
    }
    url = (
        f"https://{settings.shopify_store_domain}/admin/api/"
        f"{settings.shopify_api_version}/graphql.json"
    )
    response = httpx.post(
        url,
        headers={
            "X-Shopify-Access-Token": settings.shopify_access_token,
            "Content-Type": "application/json",
        },
        json={"query": PRODUCT_SET_MUTATION, "variables": variables},
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("errors"):
        raise RuntimeError(str(payload["errors"]))
    result = payload["data"]["productSet"]
    if result["userErrors"]:
        raise RuntimeError("; ".join(error["message"] for error in result["userErrors"]))

    shopify_product = result["product"]
    with connection() as conn:
        conn.execute(
            """UPDATE products SET shopify_product_id = %s, shopify_status = %s,
               updated_at = now() WHERE id = %s AND workspace_id = %s""",
            (
                shopify_product["id"],
                shopify_product["status"].lower(),
                product_id,
                workspace_id,
            ),
        )
        conn.execute(
            """INSERT INTO activity_events(workspace_id, product_id, event_type, message, metadata)
               VALUES (%s, %s, 'shopify_synced', %s, %s::jsonb)""",
            (
                workspace_id,
                product_id,
                f"Synced {product['title']} to Shopify",
                '{"shopify_product_id": "' + shopify_product["id"] + '"}',
            ),
        )
        conn.commit()
    return shopify_product
