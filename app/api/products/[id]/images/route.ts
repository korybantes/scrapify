import { jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const backend = process.env.SCRAPPIFY_BACKEND_URL?.replace(/\/$/, "");
    const key = process.env.SCRAPPIFY_API_KEY;
    if (!backend || !key) return Response.json({ error: "Image worker is not configured" }, { status: 503 });
    const { id } = await context.params;
    const payload = await request.json();
    const response = await fetch(`${backend}/v1/products/${id}/images/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Scrappify-Key": key,
        "X-Workspace-ID": auth.context.workspace.id,
      },
      body: JSON.stringify({ image_id: payload.image_id, action: payload.action }),
      signal: AbortSignal.timeout(payload.action === "remove_background" ? 290000 : 90000),
    });
    const result = await response.json();
    if (!response.ok) return Response.json({ error: result.detail || result.error || "Image processing failed" }, { status: response.status });
    return Response.json(result);
  } catch (error) {
    return jsonError(error, 400);
  }
}
