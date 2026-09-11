import { db, jsonError } from "@/app/lib/server-db";
import { productImages } from "@/app/lib/product-images";
import { exportProductTitle } from "@/app/lib/product-title";
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

function adjustedPrice(rawPrice: unknown, config: Record<string, unknown>) {
  let price = Math.max(0, Number(rawPrice || 0));
  const value = Number(config.priceValue || 0);
  if (config.priceMode === "percent") price *= 1 + value / 100;
  if (config.priceMode === "fixed") price += value;
  if (config.rounding === "whole") price = Math.round(price);
  if (config.rounding === "ending_90") price = Math.floor(price) + 0.9;
  if (config.rounding === "ending_99") price = Math.floor(price) + 0.99;
  return Math.max(0, Number(price.toFixed(2)));
}

async function shopifyGraphql(domain: string, version: string, token: string, query: string, variables: Record<string, unknown>) {
  const response = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || `Shopify returned ${response.status}`);
  }
  return payload.data;
}

async function resolveCollections(domain: string, version: string, token: string, names: string[]) {
  const ids: string[] = [];
  for (const name of names.slice(0, 10)) {
    const found = await shopifyGraphql(
      domain, version, token,
      "query FindCollection($query: String!) { collections(first: 1, query: $query) { nodes { id title } } }",
      { query: `title:${JSON.stringify(name)}` },
    );
    let id = String(found.collections?.nodes?.[0]?.id || "");
    if (!id) {
      const created = await shopifyGraphql(
        domain, version, token,
        "mutation CreateCollection($input: CollectionInput!) { collectionCreate(input: $input) { collection { id title } userErrors { message } } }",
        { input: { title: name } },
      );
      if (created.collectionCreate?.userErrors?.length) {
        throw new Error(created.collectionCreate.userErrors.map((item: { message: string }) => item.message).join("; "));
      }
      id = String(created.collectionCreate?.collection?.id || "");
    }
    if (id) ids.push(id);
  }
  return ids;
}

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
    const config = payload.export_config && typeof payload.export_config === "object" ? payload.export_config : {};
    const categoryUid = String(config.categoryId || payload.category_id || "").trim();
    const productTypeOverride = String(config.productType || payload.product_type || "").trim().slice(0, 255);
    const extraTags = Array.isArray(config.tags)
      ? config.tags.map(String).map((tag: string) => tag.trim()).filter(Boolean).slice(0, 250)
      : String(payload.extra_tags || "").split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 250);
    if (!ids.length) return Response.json({ error: "Select at least one product" }, { status: 400 });
    if (categoryUid && !/^[a-z]{2}(?:-\d+)*$/i.test(categoryUid)) {
      return Response.json({ error: "Select a valid Shopify taxonomy category" }, { status: 400 });
    }

    const products = await sql`SELECT * FROM products
      WHERE id = ANY(${ids}::uuid[]) AND workspace_id = ${auth.context.workspace.id}::uuid`;
    let locationId = "";
    try {
      const data = await shopifyGraphql(
        domain, apiVersion, token,
        "query ScrapifyLocation { locations(first: 1) { nodes { id name } } }",
        {},
      );
      locationId = String(data.locations?.nodes?.[0]?.id || "");
    } catch {
      locationId = "";
    }
    const collectionNames = Array.isArray(config.collections)
      ? config.collections.map(String).map((name: string) => name.trim()).filter(Boolean)
      : [];
    const collectionIds = collectionNames.length
      ? await resolveCollections(domain, apiVersion, token, collectionNames)
      : [];

    const synced: Array<{ id: string; shopify_product_id: string }> = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const product of products) {
      try {
        const exportTitle = exportProductTitle(product.title, product.vendor);
        const handle = slugify(exportTitle) || "scrappify-" + product.id;
        const sourceVariants = Array.isArray(product.variants) && product.variants.length ? product.variants : [{
          option_name: "Title", option_value: "Default Title", sku: String(product.id),
          barcode: "", inventory_qty: Number(product.inventory_qty || 0),
        }];
        const optionName = String(sourceVariants[0].option_name || "Title");
        const gallery = productImages(product as Record<string, unknown>);
        const shopifyFiles = gallery.map((image) => ({ originalSource: image.url, alt: image.alt || exportTitle }));
        const price = adjustedPrice(product.sale_price, config);
        const compareAtPrice = Number(config.compareAtPercent || 0) > 0
          ? Number((price * (1 + Number(config.compareAtPercent) / 100)).toFixed(2))
          : Number(product.compare_at_price || 0);
        const variants = sourceVariants.map((sourceVariant: Record<string, unknown>) => {
          const variant: Record<string, unknown> = {
            optionValues: [{ optionName, name: String(sourceVariant.option_value || "Default Title") }],
            price: String(price),
            inventoryItem: { sku: String(sourceVariant.sku || product.id), tracked: true },
            inventoryPolicy: config.inventoryPolicy === "continue" ? "CONTINUE" : "DENY",
          };
          const variantKey = String(sourceVariant.source_variant_id || sourceVariant.option_value || "");
          const variantImage = gallery.find((image) => image.variant_ids?.includes(variantKey));
          if (variantImage) variant.file = { originalSource: variantImage.url, alt: variantImage.alt || exportTitle };
          if (sourceVariant.barcode) variant.barcode = String(sourceVariant.barcode);
          if (locationId) variant.inventoryQuantities = [{
            locationId, name: "available", quantity: Number(sourceVariant.inventory_qty || 0),
          }];
          if (compareAtPrice > price) variant.compareAtPrice = String(compareAtPrice);
          return variant;
        });

        const attributeEntries = {
          color: config.attributes?.color,
          material: config.attributes?.material,
          size_system: config.attributes?.sizeSystem,
          scent_family: config.attributes?.scentFamily,
          volume: config.attributes?.volume,
          google_product_category: config.google?.category,
          google_gender: config.google?.gender,
          google_age_group: config.google?.ageGroup,
          google_condition: config.google?.condition,
        };
        const metafields = Object.entries(attributeEntries)
          .filter(([, value]) => String(value || "").trim())
          .map(([key, value]) => ({
            namespace: "custom", key, type: "single_line_text_field", value: String(value),
          }));

        const productInput: Record<string, unknown> = {
          title: exportTitle,
          handle,
          descriptionHtml: product.body_html,
          vendor: product.vendor,
          productType: productTypeOverride || product.category,
          tags: Array.from(new Set([...(Array.isArray(product.tags) ? product.tags : []), ...extraTags])),
          status: String(config.status || (product.published ? "active" : "draft")).toUpperCase(),
          productOptions: [{
            name: optionName,
            values: sourceVariants.map((sourceVariant: Record<string, unknown>) => ({
              name: String(sourceVariant.option_value || "Default Title"),
            })),
          }],
          variants,
          files: shopifyFiles,
        };
        if (categoryUid) productInput.category = `gid://shopify/TaxonomyCategory/${categoryUid}`;
        if (collectionIds.length) productInput.collections = collectionIds;
        if (metafields.length) productInput.metafields = metafields;

        const data = await shopifyGraphql(domain, apiVersion, token, mutation, {
          identifier: product.shopify_product_id ? { id: product.shopify_product_id } : null,
          input: productInput,
        });
        const operation = data.productSet;
        if (operation?.userErrors?.length) throw new Error(operation.userErrors.map((item: { message: string }) => item.message).join("; "));
        const shopifyProduct = operation.product;
        await sql`UPDATE products SET shopify_product_id = ${shopifyProduct.id},
            shopify_status = ${String(shopifyProduct.status).toLowerCase()}, updated_at = now()
          WHERE id = ${product.id} AND workspace_id = ${auth.context.workspace.id}::uuid`;
        await sql`INSERT INTO activity_events(workspace_id, product_id, event_type, message, metadata)
          VALUES (${auth.context.workspace.id}::uuid, ${product.id}, 'shopify_synced',
            ${`Synced ${exportTitle} to Shopify`},
            ${JSON.stringify({ shopify_product_id: shopifyProduct.id, collections: collectionNames, category: categoryUid })}::jsonb)`;
        synced.push({ id: String(product.id), shopify_product_id: shopifyProduct.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Shopify sync failed";
        failed.push({ id: String(product.id), error: message });
        await sql`UPDATE products SET shopify_status = 'failed', updated_at = now()
          WHERE id = ${product.id} AND workspace_id = ${auth.context.workspace.id}::uuid`;
      }
    }
    return Response.json({ synced, failed, collections: collectionNames });
  } catch (error) {
    return jsonError(error);
  }
}
