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
    const url = new URL(request.url);
    const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
    const query = (url.searchParams.get("query") ?? "").trim();
    const source = (url.searchParams.get("source") ?? "").trim();
    const aiStatus = (url.searchParams.get("ai_status") ?? "").trim();
    const sessionId = (url.searchParams.get("session_id") ?? "").trim() || null;
    const readiness = (url.searchParams.get("readiness") ?? "all").trim();
    const searchPattern = `%${query}%`;
    const products = ids.length
      ? await sql`
          SELECT * FROM products
          WHERE id = ANY(${ids}::uuid[])
            AND workspace_id = ${auth.context.workspace.id}::uuid
          ORDER BY updated_at DESC
        `
      : sessionId
        ? await sql`
          SELECT product.* FROM products product
          WHERE product.workspace_id = ${auth.context.workspace.id}::uuid
            AND (${query} = '' OR title ILIKE ${searchPattern} OR vendor ILIKE ${searchPattern})
            AND (${source} = '' OR source = ${source})
            AND (${aiStatus} = '' OR ai_status = ${aiStatus})
            AND EXISTS (
              SELECT 1 FROM scrape_job_products link
              WHERE link.product_id = product.id
                AND link.job_id = ${sessionId}::uuid
                AND link.workspace_id = ${auth.context.workspace.id}::uuid
            )
            AND (${readiness} <> 'ai_ready' OR (product.ai_status = 'enriched' AND product.body_html <> ''))
            AND (${readiness} <> 'published' OR product.published = true)
            AND (${readiness} <> 'needs_ai' OR product.ai_status IN ('pending', 'failed'))
          ORDER BY product.updated_at DESC
        `
        : await sql`
          SELECT * FROM products
          WHERE workspace_id = ${auth.context.workspace.id}::uuid
            AND (${query} = '' OR title ILIKE ${searchPattern} OR vendor ILIKE ${searchPattern})
            AND (${source} = '' OR source = ${source})
            AND (${aiStatus} = '' OR ai_status = ${aiStatus})
            AND (${readiness} <> 'ai_ready' OR (ai_status = 'enriched' AND body_html <> ''))
            AND (${readiness} <> 'published' OR published = true)
            AND (${readiness} <> 'needs_ai' OR ai_status IN ('pending', 'failed'))
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
        "Content-Disposition": `attachment; filename="scrappify-${sessionId ? `session-${sessionId.slice(0, 8)}-` : ""}shopify-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
