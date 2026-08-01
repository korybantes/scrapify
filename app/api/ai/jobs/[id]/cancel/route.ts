import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const { id } = await params;
    const sql = db();
    const rows = await sql`
      UPDATE ai_enrichment_jobs SET status = 'cancelled', completed_at = now(), updated_at = now()
      WHERE id = ${id}::uuid AND workspace_id = ${auth.context.workspace.id}::uuid
        AND status IN ('queued','running')
      RETURNING id
    `;
    if (!rows.length) return Response.json({ error: "Active AI job not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
