import { db, jsonError } from "@/app/lib/server-db";
import { decryptSecret } from "@/app/lib/secrets";
import { requireWorkspace } from "@/app/lib/workspace";

const mutation = `
mutation UpsertProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, identifier: $identifier, synchronous: true) {
    product { id handle status }
    userErrors { field message code }
  }
}`;

const slugify = (value: string) =>
  value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-");

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const sql = db();
    const integrations = await sql`
      SELECT store_domain, access_token_encrypted, api_version
      FROM workspace_shopify_integrations
      WHERE workspace_id = ${auth.context.workspace.id}::uuid
    `;
    if (!integrations.length) return Response.json({ error: "Connect Shopify for this workspace first" }, { status: 503 });
    const domain = String(integrations[0].store_domain);
    const token = await decryptSecret(String(integrations[0].access_token_encrypted));
    const apiVersion = String(integrations[0].api_version);
    const payload = await request.json();
    const ids = Array.isArray(payload.product_ids) ? payload.product_ids.slice(0, 100) : [];
    if (!ids.length) return Response.json({ error: "Select at least one product" }, { status: 400 });
    const products = await sql`
      SELECT * FROM products
      WHERE id = ANY(${ids}::uuid[])
        AND workspace_id = ${auth.context.workspace.id}::uuid
    `;
    const synced: Array<{ id: string; shopify_product_id: string }> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const product of products) {
      try {
        const handle = slugify(product.title) || `scrappify-${product.id}`;
        const variant: Record<string, unknown> = {
          optionValues: [{ optionName: "Title", name: "Default Title" }],
          price: String(product.sale_price ?? "0.00"),
          inventoryItem: { sku: String(product.id) },
        };
        if (product.compare_at_price && Number(product.compare_at_price) > Number(product.sale_price ?? 0)) {
          variant.compareAtPrice = String(product.compare_at_price);
        }
        const response = await fetch(
          `https://${domain}/admin/api/${apiVersion}/graphql.json`,
          {
            method: "POST",
            headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
            body: JSON.stringify({
              query: mutation,
              variables: {
                identifier: { handle },
                input: {
                  title: product.title,
                  handle,
                  descriptionHtml: product.body_html,
                  vendor: product.vendor,
                  productType: product.category,
                  tags: product.tags,
                  status: product.published ? "ACTIVE" : "DRAFT",
                  productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
                  variants: [variant],
                },
              },
            }),
          },
        );
        const result = await response.json();
        if (!response.ok || result.errors?.length) throw new Error(result.errors?.[0]?.message ?? `Shopify returned ${response.status}`);
        const operation = result.data?.productSet;
        if (operation?.userErrors?.length) throw new Error(operation.userErrors.map((item: { message: string }) => item.message).join("; "));
        const shopifyProduct = operation.product;
        await sql`
          UPDATE products SET shopify_product_id = ${shopifyProduct.id},
            shopify_status = ${String(shopifyProduct.status).toLowerCase()},
            updated_at = now()
          WHERE id = ${product.id} AND workspace_id = ${auth.context.workspace.id}::uuid
        `;
        await sql`
          INSERT INTO activity_events(workspace_id, product_id, event_type, message, metadata)
          VALUES (${auth.context.workspace.id}::uuid, ${product.id}, 'shopify_synced', ${`Synced ${product.title} to Shopify`},
            ${JSON.stringify({ shopify_product_id: shopifyProduct.id })}::jsonb)
        `;
        synced.push({ id: String(product.id), shopify_product_id: shopifyProduct.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Shopify sync failed";
        failed.push({ id: String(product.id), error: message });
        await sql`
          UPDATE products SET shopify_status = 'failed', updated_at = now()
          WHERE id = ${product.id} AND workspace_id = ${auth.context.workspace.id}::uuid
        `;
      }
    }
    return Response.json({ synced, failed });
  } catch (error) {
    return jsonError(error);
  }
}
