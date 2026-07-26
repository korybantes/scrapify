import { allowedSourceHosts, db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

const LANGUAGES = new Set(["tr", "en", "de", "fr", "es", "pl", "ar", "it"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const { id } = await params;
    const payload = await request.json();
    const categoryUrl = new URL(String(payload.category_url || ""));
    if (categoryUrl.protocol !== "https:" || !allowedSourceHosts.has(categoryUrl.hostname)) {
      return Response.json({ error: "Only approved HTTPS source URLs are allowed" }, { status: 400 });
    }
    const sql = db();
    const rows = await sql`
      UPDATE saved_sources SET
        name = ${String(payload.name || "").trim().slice(0, 80)},
        source_host = ${categoryUrl.hostname},
        category_name = ${String(payload.category_name || "").trim().slice(0, 160)},
        category_url = ${categoryUrl.toString()},
        start_page = ${Math.max(1, Number(payload.start_page) || 1)},
        max_pages = ${Math.min(100, Math.max(1, Number(payload.max_pages) || 1))},
        seo_language = ${LANGUAGES.has(payload.seo_language) ? payload.seo_language : "tr"},
        auto_enrich = ${Boolean(payload.auto_enrich)},
        enabled = ${payload.enabled !== false},
        updated_at = now()
      WHERE id = ${id}::uuid AND workspace_id = ${auth.context.workspace.id}::uuid
      RETURNING *
    `;
    if (!rows.length) return Response.json({ error: "Saved source not found" }, { status: 404 });
    return Response.json({ source: rows[0] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const { id } = await params;
    const sql = db();
    const rows = await sql`
      DELETE FROM saved_sources
      WHERE id = ${id}::uuid AND workspace_id = ${auth.context.workspace.id}::uuid
      RETURNING id
    `;
    if (!rows.length) return Response.json({ error: "Saved source not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
