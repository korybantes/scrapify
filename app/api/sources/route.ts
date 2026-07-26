import { allowedSourceHosts, db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

const LANGUAGES = new Set(["tr", "en", "de", "fr", "es", "pl", "ar", "it"]);

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const sql = db();
    const sources = await sql`
      SELECT * FROM saved_sources
      WHERE workspace_id = ${auth.context.workspace.id}::uuid
      ORDER BY updated_at DESC
    `;
    return Response.json({ sources });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const payload = await request.json();
    const name = String(payload.name || "").trim().slice(0, 80);
    const categoryName = String(payload.category_name || "").trim().slice(0, 160);
    const categoryUrl = new URL(String(payload.category_url || ""));
    const language = LANGUAGES.has(payload.seo_language) ? payload.seo_language : "tr";
    if (!name || !categoryName || categoryUrl.protocol !== "https:" || !allowedSourceHosts.has(categoryUrl.hostname)) {
      return Response.json({ error: "Enter a valid name and approved HTTPS category URL" }, { status: 400 });
    }
    const startPage = Math.max(1, Number(payload.start_page) || 1);
    const maxPages = Math.min(100, Math.max(1, Number(payload.max_pages) || 1));
    const sql = db();
    const rows = await sql`
      INSERT INTO saved_sources (
        workspace_id, name, source_host, category_name, category_url,
        start_page, max_pages, seo_language, auto_enrich
      ) VALUES (
        ${auth.context.workspace.id}::uuid, ${name}, ${categoryUrl.hostname},
        ${categoryName}, ${categoryUrl.toString()}, ${startPage}, ${maxPages},
        ${language}, ${Boolean(payload.auto_enrich)}
      )
      RETURNING *
    `;
    return Response.json({ source: rows[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
