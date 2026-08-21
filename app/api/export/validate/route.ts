import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

type Issue = { code: string; label: string; count: number; severity: "error" | "warning" | "info" };

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const payload = await request.json();
    const ids = Array.isArray(payload.ids) ? payload.ids.slice(0, 10000) : [];
    const sessionId = String(payload.session_id || "").trim() || null;
    const readiness = String(payload.readiness || "all");
    const config = payload.config && typeof payload.config === "object" ? payload.config : {};
    const sql = db();
    const products = ids.length
      ? await sql`SELECT * FROM products
          WHERE workspace_id = ${auth.context.workspace.id}::uuid
            AND id = ANY(${ids}::uuid[])`
      : sessionId
        ? await sql`SELECT product.* FROM products product
            WHERE product.workspace_id = ${auth.context.workspace.id}::uuid
              AND EXISTS (
                SELECT 1 FROM scrape_job_products link
                WHERE link.product_id = product.id
                  AND link.job_id = ${sessionId}::uuid
                  AND link.workspace_id = ${auth.context.workspace.id}::uuid
              )
              AND (${readiness} <> 'ai_ready' OR (product.ai_status = 'enriched' AND product.body_html <> ''))`
        : await sql`SELECT * FROM products
            WHERE workspace_id = ${auth.context.workspace.id}::uuid
              AND (${readiness} <> 'ai_ready' OR (ai_status = 'enriched' AND body_html <> ''))`;

    const skuCounts = new Map<string, number>();
    const barcodeCounts = new Map<string, number>();
    let missingSku = 0;
    let missingBarcode = 0;
    let missingVariants = 0;
    for (const product of products) {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      if (!variants.length) missingVariants += 1;
      for (const variant of variants) {
        const sku = String(variant.sku || "").trim();
        const barcode = String(variant.barcode || "").trim();
        if (!sku) missingSku += 1;
        else skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
        if (!barcode) missingBarcode += 1;
        else barcodeCounts.set(barcode, (barcodeCounts.get(barcode) || 0) + 1);
      }
    }
    const count = (predicate: (product: Record<string, unknown>) => boolean) => products.filter(predicate).length;
    const allIssues: Issue[] = [
      { code: "missing_title", label: "Products without a title", count: count((p) => !String(p.title || "").trim()), severity: "error" },
      { code: "invalid_price", label: "Products without a valid price", count: count((p) => !Number.isFinite(Number(p.sale_price)) || Number(p.sale_price) <= 0), severity: "error" },
      { code: "missing_image", label: "Products without an image", count: count((p) => !String(p.image_url || "").trim()), severity: "warning" },
      { code: "missing_description", label: "Products without an SEO description", count: count((p) => !String(p.body_html || "").trim()), severity: "warning" },
      { code: "missing_category", label: "Products without an official Shopify category", count: config.categoryId ? 0 : count((p) => !String(p.category || "").includes(">")), severity: "warning" },
      { code: "ai_incomplete", label: "Products still awaiting AI", count: count((p) => p.ai_status !== "enriched"), severity: "warning" },
      { code: "missing_variants", label: "Products using a default variant", count: missingVariants, severity: "info" },
      { code: "missing_sku", label: "Variants without source SKU", count: missingSku, severity: "warning" },
      { code: "missing_barcode", label: "Variants without barcode", count: missingBarcode, severity: "info" },
      { code: "duplicate_sku", label: "Duplicate variant SKUs", count: [...skuCounts.values()].filter((value) => value > 1).length, severity: "error" },
      { code: "duplicate_barcode", label: "Duplicate variant barcodes", count: [...barcodeCounts.values()].filter((value) => value > 1).length, severity: "error" },
    ];
    const issues = allIssues.filter((issue) => issue.count > 0);

    const errors = issues.filter((issue) => issue.severity === "error").reduce((sum, issue) => sum + issue.count, 0);
    const warnings = issues.filter((issue) => issue.severity === "warning").reduce((sum, issue) => sum + issue.count, 0);
    const score = products.length ? Math.max(0, Math.round(100 - (errors * 12 + warnings * 3) / products.length)) : 0;
    return Response.json({
      total: products.length,
      ready: products.length > 0 && errors === 0,
      score,
      errors,
      warnings,
      issues,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
