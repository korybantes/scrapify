import { allowedSourceHosts, db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

const LANGUAGES = new Set(["tr", "en", "de", "fr", "es", "pl", "ar", "it"]);

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const payload = await request.json();
    const sql = db();
    const savedSourceId = payload.saved_source_id ? String(payload.saved_source_id) : "";
    const savedSources = savedSourceId
      ? await sql`
          SELECT * FROM saved_sources
          WHERE id = ${savedSourceId}::uuid
            AND workspace_id = ${auth.context.workspace.id}::uuid
            AND enabled = true
        `
      : [];
    const savedSource = savedSources[0];
    const categoryUrl = new URL(String(savedSource?.category_url ?? payload.category_url ?? ""));
    if (categoryUrl.protocol !== "https:" || !allowedSourceHosts.has(categoryUrl.hostname)) {
      return Response.json({ error: "Only approved HTTPS source URLs are allowed" }, { status: 400 });
    }
    const maxPages = Math.min(100, Math.max(1, Number(savedSource?.max_pages ?? payload.max_pages ?? 1)));
    const startPage = Math.max(1, Number(savedSource?.start_page ?? payload.start_page ?? 1));
    const source = String(savedSource?.source_host || payload.source || categoryUrl.hostname).slice(0, 80);
    const categoryName = String(savedSource?.category_name || payload.category_name || "Products").slice(0, 160);
    const language = LANGUAGES.has(savedSource?.seo_language ?? payload.seo_language)
      ? String(savedSource?.seo_language ?? payload.seo_language)
      : "tr";
    const rows = await sql`
      INSERT INTO scrape_jobs (
        workspace_id, saved_source_id, source, category_name, category_url,
        start_page, max_pages, download_images, auto_enrich, seo_language
      ) VALUES (
        ${auth.context.workspace.id}::uuid, ${savedSource?.id ?? null}::uuid,
        ${source}, ${categoryName}, ${categoryUrl.toString()}, ${startPage},
        ${maxPages}, ${Boolean(payload.download_images)},
        ${Boolean(savedSource?.auto_enrich ?? payload.auto_enrich)}, ${language}
      )
      RETURNING *
    `;
    return Response.json(rows[0], { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
