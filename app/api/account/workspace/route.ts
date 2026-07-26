import { db, jsonError } from "@/app/lib/server-db";
import { auth } from "@/app/lib/auth";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    const payload = await request.json();
    const workspaceId = String(payload.workspace_id || "");
    const sql = db();
    const rows = await sql`
      SELECT workspace_id FROM workspace_members
      WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${session.user.id}
    `;
    if (!rows.length) {
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    }
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": `scrappify_workspace=${encodeURIComponent(workspaceId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000; Secure`,
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}
