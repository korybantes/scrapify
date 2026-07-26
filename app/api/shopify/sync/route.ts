import { db, jsonError } from "@/app/lib/server-db";

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
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.SHOPIFY_ACCESS_TOKEN;
    if (!domain || !token) {
      return Response.json({ error: "Shopify Admin API is not configured" }, { status: 503 });
    }
    const payload = await request.json();
    const ids = Array.isArray(payload.product_ids) ? payload.product_ids.slice(0, 100) : [];
    if (!ids.length) return Response.json({ error: "Select at least one product" }, { status: 400 });
    const sql = db();
    const products = await sql`SELECT * FROM products WHERE id = ANY(${ids}::uuid[])`;
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
          `https://${domain}/admin/api/${process.env.SHOPIFY_API_VERSION ?? "2026-07"}/graphql.json`,
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
            updated_at = now() WHERE id = ${product.id}
        `;
        await sql`
          INSERT INTO activity_events(product_id, event_type, message, metadata)
          VALUES (${product.id}, 'shopify_synced', ${`Synced ${product.title} to Shopify`},
            ${JSON.stringify({ shopify_product_id: shopifyProduct.id })}::jsonb)
        `;
        synced.push({ id: String(product.id), shopify_product_id: shopifyProduct.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Shopify sync failed";
        failed.push({ id: String(product.id), error: message });
        await sql`UPDATE products SET shopify_status = 'failed', updated_at = now() WHERE id = ${product.id}`;
      }
    }
    return Response.json({ synced, failed });
  } catch (error) {
    return jsonError(error);
  }
}
