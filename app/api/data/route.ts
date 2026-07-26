import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const workspaceId = auth.context.workspace.id;
    const sql = db();
    const url = new URL(request.url);
    const query = (url.searchParams.get("query") ?? "").trim();
    const source = (url.searchParams.get("source") ?? "").trim();
    const aiStatus = (url.searchParams.get("ai_status") ?? "").trim();
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(20, Number(url.searchParams.get("page_size")) || 50));
    const offset = (page - 1) * pageSize;
    const searchPattern = `%${query}%`;

    const [summaryRows, jobs, products, productCountRows, events, sourceRows, shopifyRows] = await Promise.all([
      sql`
        SELECT count(*)::int AS total_products,
          count(*) FILTER (WHERE ai_status = 'enriched')::int AS ai_enriched,
          count(*) FILTER (WHERE ai_status = 'pending')::int AS ai_pending,
          count(*) FILTER (WHERE ai_status = 'failed')::int AS ai_failed,
          count(*) FILTER (WHERE ai_status = 'skipped')::int AS ai_skipped,
          count(*) FILTER (WHERE price_warning IS NOT NULL)::int AS warnings,
          count(*) FILTER (WHERE shopify_status IN ('draft','active'))::int AS shopify_synced,
          coalesce(sum(sale_price * inventory_qty), 0)::text AS catalog_value
        FROM products
        WHERE workspace_id = ${workspaceId}::uuid
      `,
      sql`
        SELECT id, source, category_name, category_url, start_page, max_pages,
          status, progress, pages_completed, products_found, warning_count,
          error, logs, created_at, started_at, completed_at
        FROM scrape_jobs
        WHERE workspace_id = ${workspaceId}::uuid
        ORDER BY created_at DESC LIMIT 20
      `,
      sql`
        SELECT * FROM products
        WHERE workspace_id = ${workspaceId}::uuid
          AND (${query} = '' OR title ILIKE ${searchPattern} OR vendor ILIKE ${searchPattern})
          AND (${source} = '' OR source = ${source})
          AND (${aiStatus} = '' OR ai_status = ${aiStatus})
        ORDER BY updated_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      sql`
        SELECT count(*)::int AS count
        FROM products
        WHERE workspace_id = ${workspaceId}::uuid
          AND (${query} = '' OR title ILIKE ${searchPattern} OR vendor ILIKE ${searchPattern})
          AND (${source} = '' OR source = ${source})
          AND (${aiStatus} = '' OR ai_status = ${aiStatus})
      `,
      sql`
        SELECT id, level, event_type, message, created_at
        FROM activity_events
        WHERE workspace_id = ${workspaceId}::uuid
        ORDER BY created_at DESC LIMIT 12
      `,
      sql`
        SELECT DISTINCT source FROM products
        WHERE workspace_id = ${workspaceId}::uuid
        ORDER BY source
      `,
      sql`
        SELECT store_domain FROM workspace_shopify_integrations
        WHERE workspace_id = ${workspaceId}::uuid
      `,
    ]);

    return Response.json({
      summary: summaryRows[0],
      jobs,
      products,
      pagination: {
        page,
        page_size: pageSize,
        total: Number(productCountRows[0]?.count ?? 0),
        total_pages: Math.max(1, Math.ceil(Number(productCountRows[0]?.count ?? 0) / pageSize)),
      },
      events,
      sources: sourceRows.map((row) => row.source),
      account: auth.context,
      services: {
        database: true,
        groq: Boolean(
          process.env.GROQ_API_KEY ||
          (process.env.SCRAPPIFY_BACKEND_URL && process.env.SCRAPPIFY_API_KEY)
        ),
        shopify: Boolean(shopifyRows.length),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
