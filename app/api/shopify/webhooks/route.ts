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
  if (topic === "products/update") {
    const payload = JSON.parse(rawBody);
    const integrations = await sql`SELECT workspace_id FROM workspace_shopify_integrations WHERE store_domain = ${shop}`;
    for (const integration of integrations) {
      const gid = `gid://shopify/Product/${payload.id}`;
      const products = await sql`SELECT * FROM products WHERE workspace_id = ${integration.workspace_id}::uuid AND shopify_product_id = ${gid}`;
      const product = products[0];
      if (!product) continue;
      const fields: Array<[string, unknown, unknown]> = [
        ["title", product.title, payload.title], ["vendor", product.vendor, payload.vendor],
        ["category", product.category, payload.product_type], ["body_html", product.body_html, payload.body_html],
        ["sale_price", Number(product.sale_price || 0), Number(payload.variants?.[0]?.price || 0)],
      ];
      for (const [field, oldValue, newValue] of fields) {
        if (String(oldValue ?? "") === String(newValue ?? "")) continue;
        await sql`INSERT INTO catalog_changes(workspace_id,product_id,field,old_value,new_value,source,status)
          SELECT ${integration.workspace_id}::uuid,${product.id}::uuid,${field},${JSON.stringify(oldValue)}::jsonb,${JSON.stringify(newValue)}::jsonb,'shopify_webhook','pending'
          WHERE NOT EXISTS(SELECT 1 FROM catalog_changes WHERE product_id=${product.id}::uuid AND field=${field} AND status='pending' AND new_value=${JSON.stringify(newValue)}::jsonb)`;
      }
      await sql`INSERT INTO activity_events(workspace_id,product_id,event_type,message,metadata) VALUES(${integration.workspace_id}::uuid,${product.id}::uuid,'shopify_change_detected',${`Shopify changed ${payload.title}`},${JSON.stringify({ topic })}::jsonb)`;
    }
  }
  if (topic === "inventory_levels/update") {
    const integrations = await sql`SELECT workspace_id FROM workspace_shopify_integrations WHERE store_domain = ${shop}`;
    for (const integration of integrations) await sql`INSERT INTO activity_events(workspace_id,event_type,message,metadata) VALUES(${integration.workspace_id}::uuid,'shopify_inventory_changed','Shopify inventory changed',${rawBody}::jsonb)`;
  }  if (topic === "app/uninstalled" || topic === "shop/redact") {
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
