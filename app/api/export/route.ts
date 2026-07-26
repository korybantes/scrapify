import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

const columns = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type",
  "Tags", "Published", "Option1 Name", "Option1 Value", "Variant SKU",
  "Variant Price", "Variant Compare At Price", "Variant Inventory Qty",
  "Variant Inventory Policy", "Variant Fulfillment Service",
  "Variant Requires Shipping", "Variant Taxable", "Image Src",
  "Image Position", "Image Alt Text", "Status",
];

const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const slugify = (value: string) =>
  value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-");

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const sql = db();
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    const products = ids.length
      ? await sql`
          SELECT * FROM products
          WHERE id = ANY(${ids}::uuid[])
            AND workspace_id = ${auth.context.workspace.id}::uuid
          ORDER BY updated_at DESC
        `
      : await sql`
          SELECT * FROM products
          WHERE workspace_id = ${auth.context.workspace.id}::uuid
          ORDER BY updated_at DESC
        `;
    const rows = products.map((product) => [
      slugify(product.title),
      product.title,
      product.body_html,
      product.vendor,
      product.category,
      product.category,
      product.tags.join(","),
      product.published ? "TRUE" : "FALSE",
      "Title",
      "Default Title",
      product.id,
      product.sale_price,
      product.compare_at_price,
      product.inventory_qty,
      "deny",
      "manual",
      "TRUE",
      "TRUE",
      product.image_url,
      "1",
      product.title,
      product.published ? "active" : "draft",
    ].map(escapeCsv).join(","));
    const csv = "\ufeff" + [columns.map(escapeCsv).join(","), ...rows].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="scrappify-shopify-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
