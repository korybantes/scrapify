import { createShopifyState, normalizeShopDomain, shopifyConfig } from "@/app/lib/shopify";
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
  const state = await createShopifyState({ workspaceId: auth.context.workspace.id, userId: auth.context.user.id, shop });
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("scope", config.scopes);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("state", state);
  return Response.redirect(authorize, 302);
}
