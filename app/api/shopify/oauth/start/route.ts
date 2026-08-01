import { db } from "@/app/lib/server-db";
import { normalizeShopDomain, shopifyConfig } from "@/app/lib/shopify";
import { requireWorkspace } from "@/app/lib/workspace";

export async function GET(request: Request) {
  const auth = await requireWorkspace(request);
  if (!auth.context) return auth.response;
  if (!["owner", "admin"].includes(auth.context.workspace.role)) {
    return Response.json({ error: "Owner or admin access required" }, { status: 403 });
  }
  const shop = normalizeShopDomain(new URL(request.url).searchParams.get("shop") ?? "");
  if (!shop) return Response.json({ error: "Enter your permanent .myshopify.com store domain" }, { status: 400 });
  const config = shopifyConfig(request);
  if (!config.clientId || !config.clientSecret) {
    return Response.json({ error: "Shopify OAuth is not configured" }, { status: 503 });
  }
  const sql = db();
  await sql`
    CREATE TABLE IF NOT EXISTS shopify_oauth_states (
      nonce text PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      shop text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`DELETE FROM shopify_oauth_states WHERE expires_at < now()`;
  const state = crypto.randomUUID();
  await sql`
    INSERT INTO shopify_oauth_states (nonce, workspace_id, user_id, shop, expires_at)
    VALUES (${state}, ${auth.context.workspace.id}::uuid, ${auth.context.user.id}, ${shop}, now() + interval '30 minutes')
  `;
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("scope", config.scopes);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("state", state);
  return Response.redirect(authorize, 302);
}
