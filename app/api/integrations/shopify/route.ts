import { db, jsonError } from "@/app/lib/server-db";
import { encryptSecret } from "@/app/lib/secrets";
import { requireWorkspace } from "@/app/lib/workspace";

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const sql = db();
    const rows = await sql`
      SELECT store_domain, api_version, updated_at
      FROM workspace_shopify_integrations
      WHERE workspace_id = ${auth.context.workspace.id}::uuid
    `;
    return Response.json({
      configured: Boolean(rows.length),
      oauth_available: Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET),
      store_domain: rows[0]?.store_domain ?? "",
      api_version: rows[0]?.api_version ?? "2026-07",
      updated_at: rows[0]?.updated_at ?? null,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    if (!["owner", "admin"].includes(auth.context.workspace.role)) {
      return Response.json({ error: "Owner or admin access required" }, { status: 403 });
    }
    const payload = await request.json();
    const domain = normalizeDomain(String(payload.store_domain || ""));
    const token = String(payload.access_token || "").trim();
    if (!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      return Response.json({ error: "Enter a valid Shopify store domain" }, { status: 400 });
    }
    const sql = db();
    const existing = await sql`
      SELECT access_token_encrypted FROM workspace_shopify_integrations
      WHERE workspace_id = ${auth.context.workspace.id}::uuid
    `;
    if (!token && !existing.length) {
      return Response.json({ error: "Enter a Shopify Admin API access token" }, { status: 400 });
    }
    const encrypted = token ? await encryptSecret(token) : existing[0].access_token_encrypted;
    await sql`
      INSERT INTO workspace_shopify_integrations (
        workspace_id, store_domain, access_token_encrypted, api_version
      ) VALUES (
        ${auth.context.workspace.id}::uuid, ${domain}, ${encrypted}, '2026-07'
      )
      ON CONFLICT (workspace_id) DO UPDATE SET
        store_domain = EXCLUDED.store_domain,
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        api_version = EXCLUDED.api_version,
        updated_at = now()
    `;
    return Response.json({ configured: true, store_domain: domain });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    if (!["owner", "admin"].includes(auth.context.workspace.role)) {
      return Response.json({ error: "Owner or admin access required" }, { status: 403 });
    }
    const sql = db();
    await sql`
      DELETE FROM workspace_shopify_integrations
      WHERE workspace_id = ${auth.context.workspace.id}::uuid
    `;
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
