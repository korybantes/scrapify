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
    const searchPattern = `%${query}%`;
    const sql = db();
    const rows = await sql`
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
