import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

export async function PATCH(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const input = await request.json();
    const productIds = Array.isArray(input.product_ids)
      ? input.product_ids.map(String).slice(0, 250)
      : [];
    if (!productIds.length) {
      return Response.json({ error: "Select at least one product" }, { status: 400 });
    }

    const hasVendor = typeof input.vendor === "string" && input.vendor.trim().length > 0;
    const hasCategory = typeof input.category === "string" && input.category.trim().length > 0;
    const hasInventory = Number.isInteger(input.inventory_qty) && input.inventory_qty >= 0;
    const hasPublished = typeof input.published === "boolean";
    const hasTags = Array.isArray(input.tags);
    if (!hasVendor && !hasCategory && !hasInventory && !hasPublished && !hasTags) {
      return Response.json({ error: "Choose at least one field to update" }, { status: 400 });
    }

    const vendor = hasVendor ? input.vendor.trim().slice(0, 250) : "";
    const category = hasCategory ? input.category.trim().slice(0, 250) : "";
    const inventoryQty = hasInventory ? Math.min(input.inventory_qty, 1_000_000) : 0;
    const published = hasPublished ? input.published : false;
    const tags = hasTags
      ? input.tags.map((tag: unknown) => String(tag).trim().slice(0, 80)).filter(Boolean).slice(0, 30)
      : [];

    const sql = db();
    const rows = await sql`
      UPDATE products SET
        vendor = CASE WHEN ${hasVendor} THEN ${vendor} ELSE vendor END,
        category = CASE WHEN ${hasCategory} THEN ${category} ELSE category END,
        inventory_qty = CASE WHEN ${hasInventory} THEN ${inventoryQty} ELSE inventory_qty END,
        published = CASE WHEN ${hasPublished} THEN ${published} ELSE published END,
        tags = CASE WHEN ${hasTags} THEN ${tags} ELSE tags END,
        updated_at = now()
      WHERE id = ANY(${productIds}::uuid[])
        AND workspace_id = ${auth.context.workspace.id}::uuid
      RETURNING id
    `;

    await sql`
      INSERT INTO activity_events(workspace_id, event_type, message, metadata)
      VALUES (
        ${auth.context.workspace.id}::uuid,
        'products_bulk_updated',
        ${`${rows.length} products updated in bulk`},
        ${JSON.stringify({ count: rows.length, fields: { hasVendor, hasCategory, hasInventory, hasPublished, hasTags } })}::jsonb
      )
    `;

    return Response.json({ updated: rows.length });
  } catch (error) {
    return jsonError(error, 400);
  }
}
