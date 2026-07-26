import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

const editableFields = new Set([
  "title",
  "vendor",
  "category",
  "sale_price",
  "compare_at_price",
  "body_html",
  "tags",
  "published",
  "inventory_qty",
]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const { id } = await context.params;
    const sql = db();
    const rows = await sql`
      SELECT *
      FROM products
      WHERE id = ${id}::uuid AND workspace_id = ${auth.context.workspace.id}::uuid
      LIMIT 1
    `;
    if (!rows.length) return Response.json({ error: "Product not found" }, { status: 404 });
    return Response.json(rows[0]);
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const { id } = await context.params;
    const input = await request.json();
    const payload = Object.fromEntries(
      Object.entries(input).filter(([key]) => editableFields.has(key)),
    );
    const sql = db();
    const rows = await sql`
      UPDATE products SET
        title = CASE WHEN ${"title" in payload} THEN ${payload.title as string ?? null} ELSE title END,
        vendor = CASE WHEN ${"vendor" in payload} THEN ${payload.vendor as string ?? null} ELSE vendor END,
        category = CASE WHEN ${"category" in payload} THEN ${payload.category as string ?? null} ELSE category END,
        sale_price = CASE WHEN ${"sale_price" in payload} THEN ${payload.sale_price as string ?? null} ELSE sale_price END,
        compare_at_price = CASE WHEN ${"compare_at_price" in payload} THEN ${payload.compare_at_price as string ?? null} ELSE compare_at_price END,
        body_html = CASE WHEN ${"body_html" in payload} THEN ${payload.body_html as string ?? null} ELSE body_html END,
        tags = CASE WHEN ${"tags" in payload} THEN ${payload.tags as string[] ?? []} ELSE tags END,
        published = CASE WHEN ${"published" in payload} THEN ${payload.published as boolean ?? false} ELSE published END,
        inventory_qty = CASE WHEN ${"inventory_qty" in payload} THEN ${payload.inventory_qty as number ?? 0} ELSE inventory_qty END,
        updated_at = now()
      WHERE id = ${id}::uuid AND workspace_id = ${auth.context.workspace.id}::uuid
      RETURNING *
    `;
    if (!rows.length) return Response.json({ error: "Product not found" }, { status: 404 });
    return Response.json(rows[0]);
  } catch (error) {
    return jsonError(error, 400);
  }
}
