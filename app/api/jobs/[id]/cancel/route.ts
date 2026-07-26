import { db, jsonError } from "@/app/lib/server-db";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const sql = db();
    const rows = await sql`
      UPDATE scrape_jobs SET status = 'cancelled', completed_at = now()
      WHERE id = ${id}::uuid AND status IN ('queued','running')
      RETURNING *
    `;
    if (!rows.length) {
      return Response.json({ error: "Job is not cancellable" }, { status: 409 });
    }
    return Response.json(rows[0]);
  } catch (error) {
    return jsonError(error);
  }
}
