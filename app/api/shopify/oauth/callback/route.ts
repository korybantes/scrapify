import { db } from "@/app/lib/server-db";
import { encryptSecret } from "@/app/lib/secrets";
import { normalizeShopDomain, registerShopifyWebhooks, shopifyConfig, verifyShopifyQueryHmac } from "@/app/lib/shopify";
import { requireWorkspace } from "@/app/lib/workspace";

function returnToApp(request: Request, status: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(`/app?shopify=${encodeURIComponent(status)}`, request.url).toString(),
      "Set-Cookie": "scrappify_shopify_state=; Path=/api/shopify/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    },
  });
}

function cookieValue(request: Request, name: string) {
  const part = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (!await verifyShopifyQueryHmac(url.searchParams)) {
      console.error("Shopify OAuth callback rejected: HMAC validation failed");
      return returnToApp(request, "invalid_signature");
    }
    const auth = await requireWorkspace(request);
    if (!auth.context) return Response.redirect(new URL("/login?shopify=resume", request.url), 302);
    const shop = normalizeShopDomain(url.searchParams.get("shop") ?? "");
    const code = url.searchParams.get("code") ?? "";
    const nonce = url.searchParams.get("state") ?? "";
    const sql = db();
    const states = nonce ? await sql`
      SELECT workspace_id, user_id, shop, expires_at FROM shopify_oauth_states
      WHERE nonce = ${nonce} AND expires_at >= now()
    ` : [];
    const state = states[0];
    const cookieMatches = Boolean(nonce && cookieValue(request, "scrappify_shopify_state") === nonce);
    if (!shop || !code || (!state && !cookieMatches)) {
      console.error("Shopify OAuth callback rejected: installation state not found", { hasNonce: Boolean(nonce), cookieMatches, stateFound: Boolean(state) });
      return returnToApp(request, "invalid_state");
    }
    if (state && (String(state.shop) !== shop || String(state.user_id) !== auth.context.user.id)) {
      console.error("Shopify OAuth callback rejected: installation state ownership mismatch");
      return returnToApp(request, "invalid_state");
    }
    const workspaceId = state ? String(state.workspace_id) : auth.context.workspace.id;
    const memberships = await sql`
      SELECT role FROM workspace_members
      WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${auth.context.user.id}
    `;
    if (!memberships.length || !["owner", "admin"].includes(String(memberships[0].role))) {
      console.error("Shopify OAuth callback rejected: workspace membership validation failed");
      return returnToApp(request, "invalid_state");
    }
    const config = shopifyConfig(request);
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
    });
    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload.access_token) return returnToApp(request, "token_failed");
    const encryptedToken = await encryptSecret(String(tokenPayload.access_token));
    await sql`
      INSERT INTO workspace_shopify_integrations (workspace_id, store_domain, access_token_encrypted, api_version)
      VALUES (${workspaceId}::uuid, ${shop}, ${encryptedToken}, ${config.apiVersion})
      ON CONFLICT (workspace_id) DO UPDATE SET
        store_domain = EXCLUDED.store_domain,
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        api_version = EXCLUDED.api_version,
        updated_at = now()
    `;
    let webhookStatus = "registered";
    try {
      await registerShopifyWebhooks(shop, String(tokenPayload.access_token), request);
    } catch (error) {
      webhookStatus = error instanceof Error ? error.message : "registration_failed";
    }
    await sql`
      INSERT INTO activity_events(workspace_id, event_type, message, metadata)
      VALUES (${workspaceId}::uuid, 'shopify_connected', ${`Connected ${shop} through Shopify OAuth`},
        ${JSON.stringify({ scopes: tokenPayload.scope ?? config.scopes, webhooks: webhookStatus })}::jsonb)
    `;
    await sql`DELETE FROM shopify_oauth_states WHERE nonce = ${nonce}`;
    return returnToApp(request, "connected");
  } catch {
    return returnToApp(request, "failed");
  }
}
