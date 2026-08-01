import { db } from "@/app/lib/server-db";
import { normalizeShopDomain, verifyShopifyWebhook } from "@/app/lib/shopify";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  if (!await verifyShopifyWebhook(rawBody, hmac)) {
    return Response.json({ error: "Invalid Shopify webhook signature" }, { status: 401 });
  }
  const topic = (request.headers.get("x-shopify-topic") ?? "").toLowerCase();
  const shop = normalizeShopDomain(request.headers.get("x-shopify-shop-domain") ?? "");
  if (!shop) return Response.json({ ok: true });
  const sql = db();
  if (topic === "app/uninstalled" || topic === "shop/redact") {
    const integrations = await sql`
      DELETE FROM workspace_shopify_integrations
      WHERE store_domain = ${shop}
      RETURNING workspace_id
    `;
    if (topic === "shop/redact") {
      for (const integration of integrations) {
        await sql`
          UPDATE products SET shopify_product_id = NULL, shopify_status = 'not_synced', updated_at = now()
          WHERE workspace_id = ${integration.workspace_id}::uuid
        `;
      }
    }
  }
  return Response.json({ ok: true });
}
