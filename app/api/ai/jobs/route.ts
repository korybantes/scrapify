import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

const languages = new Set(["tr", "en", "de", "fr", "es", "pl", "ar", "it"]);

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const sql = db();
    const rows = await sql`
      SELECT id, language, status, total, completed, succeeded, failed,
        current_product_title, logs, created_at, started_at, completed_at
      FROM ai_enrichment_jobs
      WHERE workspace_id = ${auth.context.workspace.id}::uuid
      ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1
    `;
    return Response.json({ job: rows[0] ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load AI job";
    if (message.includes("ai_enrichment_jobs")) return Response.json({ job: null, migration_required: true });
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const payload = await request.json();
    const ids = Array.isArray(payload.product_ids) ? [...new Set<string>(payload.product_ids)].slice(0, 5000) : [];
    const language = languages.has(payload.language) ? payload.language : "tr";
    if (!ids.length) return Response.json({ error: "Select at least one product" }, { status: 400 });
    const sql = db();
    const active = await sql`
      SELECT id FROM ai_enrichment_jobs
      WHERE workspace_id = ${auth.context.workspace.id}::uuid AND status IN ('queued','running')
      ORDER BY created_at DESC LIMIT 1
    `;
    if (active.length) return Response.json({ error: "An AI enrichment run is already active", job_id: active[0].id }, { status: 409 });
    const products = await sql`
      SELECT id FROM products
      WHERE workspace_id = ${auth.context.workspace.id}::uuid AND id = ANY(${ids}::uuid[])
    `;
    if (!products.length) return Response.json({ error: "No matching products found" }, { status: 404 });
    const jobs = await sql`
      INSERT INTO ai_enrichment_jobs(workspace_id, language, total, logs)
      VALUES (${auth.context.workspace.id}::uuid, ${language}, ${products.length},
        ${JSON.stringify([{ id: crypto.randomUUID(), title: "AI queue prepared", status: "running", message: `${products.length} products queued`, at: new Date().toISOString() }])}::jsonb)
      RETURNING *
    `;
    const jobId = jobs[0].id;
    await sql`
      INSERT INTO ai_enrichment_job_items(job_id, product_id)
      SELECT ${jobId}::uuid, id FROM products
      WHERE workspace_id = ${auth.context.workspace.id}::uuid AND id = ANY(${ids}::uuid[])
      ON CONFLICT DO NOTHING
    `;
    return Response.json({ job: jobs[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
