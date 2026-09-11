import { db, jsonError } from "@/app/lib/server-db";
import { productImages } from "@/app/lib/product-images";
import { exportProductTitle } from "@/app/lib/product-title";
import { requireWorkspace } from "@/app/lib/workspace";

const columns = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type", "Collection",
  "Tags", "Published", "Option1 Name", "Option1 Value", "Variant SKU",
  "Variant Barcode", "Variant Price", "Variant Compare At Price", "Variant Inventory Qty",
  "Variant Inventory Policy", "Variant Fulfillment Service",
  "Variant Requires Shipping", "Variant Taxable", "Variant Image", "Image Src",
  "Image Position", "Image Alt Text", "SEO Title", "SEO Description",
  "Google Shopping / Google Product Category", "Google Shopping / Gender",
  "Google Shopping / Age Group", "Google Shopping / Condition", "Google Shopping / MPN",
  "Google Shopping / Custom Label 0", "Google Shopping / Custom Label 1",
  "Google Shopping / Custom Label 2", "Google Shopping / Custom Label 3",
  "Google Shopping / Custom Label 4",
  "Color (product.metafields.custom.color)", "Material (product.metafields.custom.material)",
  "Size system (product.metafields.custom.size_system)",
  "Scent family (product.metafields.custom.scent_family)",
  "Volume (product.metafields.custom.volume)", "Status",
];

type ExportConfig = {
  name?: string;
  presetId?: string;
  categoryId?: string;
  categoryBreadcrumb?: string;
  productType?: string;
  collections?: string[];
  tags?: string[];
  status?: "active" | "draft";
  inventoryPolicy?: "deny" | "continue";
  priceMode?: "none" | "percent" | "fixed";
  priceValue?: number;
  rounding?: "none" | "whole" | "ending_90" | "ending_99";
  compareAtPercent?: number;
  attributes?: { color?: string; material?: string; sizeSystem?: string; scentFamily?: string; volume?: string };
  google?: { category?: string; gender?: string; ageGroup?: string; condition?: string; mpn?: string; labels?: string[] };
};

const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const slugify = (value: string) =>
  value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-");
const plainText = (value: unknown) => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function parseConfig(url: URL): ExportConfig {
  const encoded = url.searchParams.get("config");
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return {
    categoryId: (url.searchParams.get("category") || "").trim(),
    productType: (url.searchParams.get("product_type") || "").trim(),
    collections: (url.searchParams.get("collection") || "").split(",").map((item) => item.trim()).filter(Boolean),
    tags: (url.searchParams.get("tags") || "").split(",").map((item) => item.trim()).filter(Boolean),
  };
}

function adjustedPrice(rawPrice: unknown, config: ExportConfig) {
  let price = Math.max(0, Number(rawPrice || 0));
  const value = Number(config.priceValue || 0);
  if (config.priceMode === "percent") price *= 1 + value / 100;
  if (config.priceMode === "fixed") price += value;
  if (config.rounding === "whole") price = Math.round(price);
  if (config.rounding === "ending_90") price = Math.floor(price) + 0.9;
  if (config.rounding === "ending_99") price = Math.floor(price) + 0.99;
  return Math.max(0, Number(price.toFixed(2)));
}

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const sql = db();
    const url = new URL(request.url);
    const historyId = (url.searchParams.get("history_id") || "").trim();
    let config = parseConfig(url);
    let ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
    let sessionId = (url.searchParams.get("session_id") ?? "").trim() || null;
    let readiness = (url.searchParams.get("readiness") ?? "all").trim();
    let scope = ids.length ? "selected" : readiness;

    if (historyId) {
      const runs = await sql`SELECT product_ids, session_id, scope, config
        FROM export_runs
        WHERE id = ${historyId}::uuid AND workspace_id = ${auth.context.workspace.id}::uuid`;
      if (!runs.length) return Response.json({ error: "Export history record not found" }, { status: 404 });
      ids = Array.isArray(runs[0].product_ids) ? runs[0].product_ids.map(String) : [];
      sessionId = runs[0].session_id ? String(runs[0].session_id) : null;
      scope = String(runs[0].scope || "history");
      readiness = "all";
      config = runs[0].config && typeof runs[0].config === "object" ? runs[0].config as ExportConfig : {};
    }

    const query = (url.searchParams.get("query") ?? "").trim();
    const source = (url.searchParams.get("source") ?? "").trim();
    const aiStatus = (url.searchParams.get("ai_status") ?? "").trim();
    const searchPattern = `%${query}%`;
    const products = ids.length
      ? await sql`SELECT * FROM products
          WHERE id = ANY(${ids}::uuid[])
            AND workspace_id = ${auth.context.workspace.id}::uuid
          ORDER BY updated_at DESC`
      : sessionId
        ? await sql`SELECT product.* FROM products product
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
          ORDER BY product.updated_at DESC`
        : await sql`SELECT * FROM products
          WHERE workspace_id = ${auth.context.workspace.id}::uuid
            AND (${query} = '' OR title ILIKE ${searchPattern} OR vendor ILIKE ${searchPattern})
            AND (${source} = '' OR source = ${source})
            AND (${aiStatus} = '' OR ai_status = ${aiStatus})
            AND (${readiness} <> 'ai_ready' OR (ai_status = 'enriched' AND body_html <> ''))
            AND (${readiness} <> 'published' OR published = true)
            AND (${readiness} <> 'needs_ai' OR ai_status IN ('pending', 'failed'))
          ORDER BY updated_at DESC`;

    const rows = products.flatMap((product) => {
      const exportTitle = exportProductTitle(product.title, product.vendor);
      const storedVariants = Array.isArray(product.variants) ? product.variants : [];
      const variants = storedVariants.length ? storedVariants : [{
        option_name: "Title", option_value: "Default Title", sku: String(product.id),
        barcode: "", inventory_qty: Number(product.inventory_qty || 0),
      }];
      const gallery = productImages(product as Record<string, unknown>);
      const tags = Array.from(new Set([
        ...(Array.isArray(product.tags) ? product.tags : []),
        ...(Array.isArray(config.tags) ? config.tags : []),
      ]));
      const price = adjustedPrice(product.sale_price, config);
      const configuredCompareAt = Number(config.compareAtPercent || 0) > 0
        ? Number((price * (1 + Number(config.compareAtPercent) / 100)).toFixed(2))
        : Number(product.compare_at_price || 0) || "";
      const seoDescription = plainText(product.body_html).slice(0, 320);
      const googleLabels = Array.isArray(config.google?.labels) ? config.google!.labels!.slice(0, 5) : [];
      const handle = slugify(exportTitle);

      const variantRows = variants.map((variant: Record<string, unknown>, index: number) => {
        const image = gallery[index];
        const variantKey = String(variant.source_variant_id || variant.option_value || "");
        const variantImage = gallery.find((item) => item.variant_ids?.includes(variantKey));
        return [
          handle, exportTitle, product.body_html, product.vendor,
          config.categoryId || product.category,
          config.productType || product.category,
          config.collections?.[0] || "",
          tags.join(","),
          (config.status || (product.published ? "active" : "draft")) === "active" ? "TRUE" : "FALSE",
          String(variant.option_name || "Title"), String(variant.option_value || "Default Title"),
          String(variant.sku || product.id), String(variant.barcode || ""),
          price, configuredCompareAt, Number(variant.inventory_qty || 0),
          config.inventoryPolicy || "deny", "manual", "TRUE", "TRUE",
          variantImage?.url || "",
          image?.url || "", image ? String(index + 1) : "", image ? (image.alt || exportTitle) : "",
          index === 0 ? exportTitle.slice(0, 70) : "", index === 0 ? seoDescription : "",
          config.google?.category || "", config.google?.gender || "",
          config.google?.ageGroup || "", config.google?.condition || "new",
          config.google?.mpn === "sku" ? String(variant.sku || product.id) : config.google?.mpn || "",
          ...Array.from({ length: 5 }, (_, labelIndex) => googleLabels[labelIndex] || ""),
          config.attributes?.color || "", config.attributes?.material || "",
          config.attributes?.sizeSystem || "", config.attributes?.scentFamily || "",
          config.attributes?.volume || "",
          config.status || (product.published ? "active" : "draft"),
        ].map(escapeCsv).join(",");
      });

      const extraImageRows = gallery.slice(variants.length).map((image) => {
        const cells = Array(columns.length).fill("");
        cells[0] = handle;
        cells[21] = image.url;
        cells[22] = String(image.position);
        cells[23] = image.alt || exportTitle;
        return cells.map(escapeCsv).join(",");
      });
      return [...variantRows, ...extraImageRows];
    });
    if (!historyId && url.searchParams.get("record") !== "false" && products.length) {
      const warningCount = products.filter((product) =>
        !product.image_url || !product.body_html || !product.sale_price || product.ai_status !== "enriched"
      ).length;
      try {
        await sql`INSERT INTO export_runs(
            workspace_id, preset_id, session_id, created_by, name, format, scope,
            product_ids, config, product_count, warning_count
          ) VALUES (
            ${auth.context.workspace.id}::uuid,
            ${config.presetId || null}::uuid,
            ${sessionId}::uuid,
            ${auth.context.user.name},
            ${config.name || `Shopify export · ${new Date().toLocaleDateString("en-GB")}`},
            'shopify_csv', ${scope},
            ${products.map((product) => product.id)}::uuid[],
            ${JSON.stringify(config)}::jsonb,
            ${products.length}, ${warningCount}
          )`;
      } catch {
        // Export remains available while an older VPS is still applying the history migration.
      }
    }

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
