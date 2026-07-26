import { allowedSourceHosts, db, jsonError } from "@/app/lib/server-db";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const categoryUrl = new URL(String(payload.category_url ?? ""));
    if (categoryUrl.protocol !== "https:" || !allowedSourceHosts.has(categoryUrl.hostname)) {
      return Response.json({ error: "Only approved HTTPS source URLs are allowed" }, { status: 400 });
    }
    const maxPages = Math.min(100, Math.max(1, Number(payload.max_pages ?? 1)));
    const startPage = Math.max(1, Number(payload.start_page ?? 1));
    const source = String(payload.source || categoryUrl.hostname).slice(0, 80);
    const categoryName = String(payload.category_name || "Products").slice(0, 160);
    const sql = db();
    const rows = await sql`
      INSERT INTO scrape_jobs (
        source, category_name, category_url, start_page, max_pages,
        download_images, auto_enrich
      ) VALUES (
        ${source}, ${categoryName}, ${categoryUrl.toString()}, ${startPage},
        ${maxPages}, ${Boolean(payload.download_images)}, ${Boolean(payload.auto_enrich)}
      )
      RETURNING *
    `;
    return Response.json(rows[0], { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
