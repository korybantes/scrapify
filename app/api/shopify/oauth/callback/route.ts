import { db } from "@/app/lib/server-db";
import { encryptSecret } from "@/app/lib/secrets";
import { normalizeShopDomain, registerShopifyWebhooks, shopifyConfig, verifyShopifyQueryHmac, verifyShopifyState } from "@/app/lib/shopify";
import { requireWorkspace } from "@/app/lib/workspace";

function returnToApp(request: Request, status: string) {
  return Response.redirect(new URL(`/app?shopify=${encodeURIComponent(status)}`, request.url), 302);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (!await verifyShopifyQueryHmac(url.searchParams)) return returnToApp(request, "invalid_signature");
    const auth = await requireWorkspace(request);
    if (!auth.context) return Response.redirect(new URL("/login?shopify=resume", request.url), 302);
    const shop = normalizeShopDomain(url.searchParams.get("shop") ?? "");
    const code = url.searchParams.get("code") ?? "";
    const state = await verifyShopifyState(url.searchParams.get("state") ?? "");
    if (!shop || !code || !state || state.shop !== shop || state.workspaceId !== auth.context.workspace.id || state.userId !== auth.context.user.id) {
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
    const sql = db();
    await sql`
      INSERT INTO workspace_shopify_integrations (workspace_id, store_domain, access_token_encrypted, api_version)
      VALUES (${auth.context.workspace.id}::uuid, ${shop}, ${encryptedToken}, ${config.apiVersion})
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
      VALUES (${auth.context.workspace.id}::uuid, 'shopify_connected', ${`Connected ${shop} through Shopify OAuth`},
        ${JSON.stringify({ scopes: tokenPayload.scope ?? config.scopes, webhooks: webhookStatus })}::jsonb)
    `;
    return returnToApp(request, "connected");
  } catch {
    return returnToApp(request, "failed");
  }
}
