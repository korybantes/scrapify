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

    const [summaryRows, jobs, products, events, sourceRows, shopifyRows] = await Promise.all([
      sql`
        SELECT count(*)::int AS total_products,
          count(*) FILTER (WHERE ai_status = 'enriched')::int AS ai_enriched,
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
      query && source
        ? sql`SELECT * FROM products
              WHERE (title ILIKE ${`%${query}%`} OR vendor ILIKE ${`%${query}%`})
                AND source = ${source}
                AND workspace_id = ${workspaceId}::uuid
              ORDER BY updated_at DESC LIMIT 100`
        : query
          ? sql`SELECT * FROM products
                WHERE workspace_id = ${workspaceId}::uuid
                  AND (title ILIKE ${`%${query}%`} OR vendor ILIKE ${`%${query}%`})
                ORDER BY updated_at DESC LIMIT 100`
          : source
            ? sql`SELECT * FROM products
                  WHERE source = ${source} AND workspace_id = ${workspaceId}::uuid
                  ORDER BY updated_at DESC LIMIT 100`
            : sql`SELECT * FROM products
                  WHERE workspace_id = ${workspaceId}::uuid
                  ORDER BY updated_at DESC LIMIT 100`,
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
      events,
      sources: sourceRows.map((row) => row.source),
      account: auth.context,
      services: {
        database: true,
        groq: Boolean(process.env.GROQ_API_KEY),
        shopify: Boolean(shopifyRows.length),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
