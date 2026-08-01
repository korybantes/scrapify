const encoder = new TextEncoder();

export function normalizeShopDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ? domain : "";
}

export function shopifyConfig(request?: Request) {
  const clientId = (process.env.SHOPIFY_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET ?? "").trim();
  const scopes = (process.env.SHOPIFY_SCOPES ?? "read_products,write_products,read_locations,write_inventory")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(",");
  const origin = request ? new URL(request.url).origin : "";
  const redirectUri = (process.env.SHOPIFY_REDIRECT_URI ?? `${origin}/api/shopify/oauth/callback`).trim();
  const apiVersion = (process.env.SHOPIFY_API_VERSION ?? "2026-07").trim();
  return { clientId, clientSecret, scopes, redirectUri, apiVersion };
}

async function hmac(message: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function verifyShopifyQueryHmac(searchParams: URLSearchParams) {
  const { clientSecret } = shopifyConfig();
  const supplied = searchParams.get("hmac") ?? "";
  if (!clientSecret || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const message = [...searchParams.entries()]
    .filter(([key]) => key !== "hmac")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => `${leftKey}=${leftValue}`.localeCompare(`${rightKey}=${rightValue}`))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const expected = [...await hmac(message, clientSecret)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return safeEqual(supplied.toLowerCase(), expected);
}

export async function verifyShopifyWebhook(rawBody: string, supplied: string) {
  const { clientSecret } = shopifyConfig();
  if (!clientSecret || !supplied) return false;
  const expected = btoa(String.fromCharCode(...await hmac(rawBody, clientSecret)));
  return safeEqual(supplied, expected);
}

export async function registerShopifyWebhooks(shop: string, token: string, request: Request) {
  const { apiVersion } = shopifyConfig(request);
  const callbackUrl = `${new URL(request.url).origin}/api/shopify/webhooks`;
  const mutation = `mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }) {
      userErrors { field message }
    }
  }`;
  const topics = ["APP_UNINSTALLED", "CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT", "SHOP_REDACT"];
  for (const topic of topics) {
    const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: mutation, variables: { topic, callbackUrl } }),
    });
    if (!response.ok) throw new Error(`Could not register Shopify webhook ${topic}`);
    const result = await response.json();
    const errors = result.data?.webhookSubscriptionCreate?.userErrors ?? result.errors ?? [];
    if (errors.length && !errors.some((error: { message?: string }) => error.message?.toLowerCase().includes("already"))) {
      throw new Error(errors.map((error: { message?: string }) => error.message).filter(Boolean).join("; "));
    }
  }
}
