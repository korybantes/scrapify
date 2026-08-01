import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const url = new URL(request.url);
    const query = (url.searchParams.get("query") ?? "").trim();
    const source = (url.searchParams.get("source") ?? "").trim();
    const aiStatus = (url.searchParams.get("ai_status") ?? "").trim();
    const sessionId = (url.searchParams.get("session_id") ?? "").trim() || null;
    const searchPattern = `%${query}%`;
    const sql = db();
    const rows = sessionId
      ? await sql`
          SELECT product.id FROM products product
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
          ORDER BY updated_at DESC
        `
      : await sql`
          SELECT id FROM products
          WHERE workspace_id = ${auth.context.workspace.id}::uuid
            AND (${query} = '' OR title ILIKE ${searchPattern} OR vendor ILIKE ${searchPattern})
            AND (${source} = '' OR source = ${source})
            AND (${aiStatus} = '' OR ai_status = ${aiStatus})
          ORDER BY updated_at DESC
        `;
    return Response.json({ ids: rows.map((row) => row.id), total: rows.length });
  } catch (error) {
    return jsonError(error);
  }
}
