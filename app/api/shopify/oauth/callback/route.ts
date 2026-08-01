import { db } from "@/app/lib/server-db";
import { encryptSecret } from "@/app/lib/secrets";
import { normalizeShopDomain, registerShopifyWebhooks, shopifyConfig, verifyShopifyQueryHmac } from "@/app/lib/shopify";
import { requireWorkspace } from "@/app/lib/workspace";

function returnToApp(request: Request, status: string) {
  return Response.redirect(new URL(`/app?shopify=${encodeURIComponent(status)}`, request.url), 302);
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
      DELETE FROM shopify_oauth_states
      WHERE nonce = ${nonce} AND expires_at >= now()
      RETURNING workspace_id, user_id, shop
    ` : [];
    const state = states[0];
    if (!shop || !code || !state || String(state.shop) !== shop || String(state.user_id) !== auth.context.user.id) {
      console.error("Shopify OAuth callback rejected: signed state validation failed");
      return returnToApp(request, "invalid_state");
    }
    const memberships = await sql`
      SELECT role FROM workspace_members
      WHERE workspace_id = ${state.workspace_id}::uuid AND user_id = ${auth.context.user.id}
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
      VALUES (${state.workspace_id}::uuid, ${shop}, ${encryptedToken}, ${config.apiVersion})
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
      VALUES (${state.workspace_id}::uuid, 'shopify_connected', ${`Connected ${shop} through Shopify OAuth`},
        ${JSON.stringify({ scopes: tokenPayload.scope ?? config.scopes, webhooks: webhookStatus })}::jsonb)
    `;
    return returnToApp(request, "connected");
  } catch {
    return returnToApp(request, "failed");
  }
}
