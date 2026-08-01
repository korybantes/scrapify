import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const sql = db();
    const sessions = await sql`
      SELECT
        job.id, job.source, job.category_name, job.category_url,
        job.status, job.progress, job.pages_completed, job.max_pages,
        job.products_found, job.warning_count, job.seo_language,
        job.created_at, job.started_at, job.completed_at,
        count(link.product_id)::int AS session_products,
        count(link.product_id) FILTER (WHERE product.ai_status = 'enriched')::int AS ai_ready,
        count(link.product_id) FILTER (WHERE product.ai_status = 'pending')::int AS ai_pending,
        count(link.product_id) FILTER (WHERE product.ai_status = 'failed')::int AS ai_failed,
        count(link.product_id) FILTER (
          WHERE product.ai_status = 'enriched' AND product.body_html <> ''
        )::int AS export_ready,
        count(link.product_id) FILTER (WHERE product.price_warning IS NOT NULL)::int AS product_warnings
      FROM scrape_jobs job
      LEFT JOIN scrape_job_products link
        ON link.job_id = job.id AND link.workspace_id = job.workspace_id
      LEFT JOIN products product
        ON product.id = link.product_id AND product.workspace_id = job.workspace_id
      WHERE job.workspace_id = ${auth.context.workspace.id}::uuid
      GROUP BY job.id
      ORDER BY job.created_at DESC
      LIMIT 50
    `;
    return Response.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load sessions";
    if (message.includes("scrape_job_products")) {
      return Response.json({ sessions: [], migration_required: true });
    }
    return jsonError(error);
  }
}
