import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

export const maxDuration = 300;

const LANGUAGES: Record<string, string> = {
  tr: "Turkish",
  en: "English",
  de: "German",
  fr: "French",
  es: "Spanish",
  pl: "Polish",
  ar: "Arabic",
  it: "Italian",
};

const systemPrompt = (language: string) => `You are a senior Shopify ecommerce copywriter.
Return only simple Shopify-safe HTML using <p>, <ul>, <li>, and <strong>.
Write one compact original paragraph and 2-3 short feature bullets.
Write entirely in ${language}.
Never mention the source retailer or invent product facts.
Use a premium, trustworthy tone without exaggerated claims.`;

class GroqRateLimitError extends Error {}

function cleanHtml(value: string) {
  return value
    .trim()
    .replace(/^```(?:html)?\s*|\s*```$/gi, "")
    .replace(/<(?!\/?(?:p|ul|li|strong)\b)[^>]*>/gi, "")
    .trim();
}

async function generateWithGroq(
  apiKey: string,
  language: string,
  product: Record<string, unknown>,
) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      temperature: 0.35,
      max_completion_tokens: 320,
      messages: [
        { role: "system", content: systemPrompt(language) },
        {
          role: "user",
          content: `Product: ${product.title}\nBrand: ${product.vendor || "Unknown"}\nCategory: ${product.category || "Unknown"}\nPrice: ${product.sale_price || "Unknown"} TRY`,
        },
      ],
    }),
  });
  if (response.status === 429) {
    throw new GroqRateLimitError("Groq free-tier limit reached");
  }
  if (!response.ok) throw new Error(`Groq returned ${response.status}`);
  const result = await response.json();
  const bodyHtml = cleanHtml(result.choices?.[0]?.message?.content ?? "");
  if (!bodyHtml) throw new Error("AI returned an empty description");
  return bodyHtml;
}

async function enrichWithVps(productId: string, workspaceId: string, language: string) {
  const backendUrl = process.env.SCRAPPIFY_BACKEND_URL?.replace(/\/$/, "");
  const backendKey = process.env.SCRAPPIFY_API_KEY;
  if (!backendUrl || !backendKey) {
    throw new Error("ScrapifyAI fallback is not configured");
  }
  const response = await fetch(`${backendUrl}/v1/ai/enrich`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Scrappify-Key": backendKey,
    },
    body: JSON.stringify({
      product_ids: [productId],
      workspace_id: workspaceId,
      language,
    }),
    signal: AbortSignal.timeout(190_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.failed?.length) {
    throw new Error(payload.detail || payload.failed?.[0]?.error || `ScrapifyAI returned ${response.status}`);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const apiKey = process.env.GROQ_API_KEY;
    const hasLocalFallback = Boolean(process.env.SCRAPPIFY_BACKEND_URL && process.env.SCRAPPIFY_API_KEY);
    if (!apiKey && !hasLocalFallback) {
      return Response.json({ error: "AI is not configured" }, { status: 503 });
    }
    const payload = await request.json();
    const languageCode = LANGUAGES[payload.language] ? payload.language : "tr";
    const language = LANGUAGES[languageCode];
    const ids = Array.isArray(payload.product_ids) ? payload.product_ids.slice(0, 100) : [];
    if (!ids.length) return Response.json({ error: "Select at least one product" }, { status: 400 });
    const sql = db();
    const products = await sql`
      SELECT id, title, vendor, category, sale_price
      FROM products
      WHERE id = ANY(${ids}::uuid[])
        AND workspace_id = ${auth.context.workspace.id}::uuid
    `;

    let enriched = 0;
    const failed: Array<{ id: string; error: string }> = [];
    for (const product of products) {
      try {
        let bodyHtml = "";
        let provider = "groq";
        if (apiKey) {
          try {
            bodyHtml = await generateWithGroq(apiKey, language, product);
          } catch (error) {
            if (!(error instanceof GroqRateLimitError) || !hasLocalFallback) throw error;
            await enrichWithVps(String(product.id), auth.context.workspace.id, languageCode);
            provider = "local";
          }
        } else {
          await enrichWithVps(String(product.id), auth.context.workspace.id, languageCode);
          provider = "local";
        }
        if (provider === "local") {
          enriched += 1;
          continue;
        }
        const tags = [product.vendor, product.category, "parfum"].filter(Boolean);
        await sql`
          UPDATE products SET body_html = ${bodyHtml}, tags = ${tags},
            ai_status = 'enriched', ai_error = NULL, seo_language = ${languageCode},
            updated_at = now()
          WHERE id = ${product.id} AND workspace_id = ${auth.context.workspace.id}::uuid
        `;
        await sql`
          INSERT INTO activity_events(workspace_id, product_id, event_type, message, metadata)
          VALUES (
            ${auth.context.workspace.id}::uuid, ${product.id}, 'ai_enriched',
            ${`AI description generated for ${product.title}`},
            ${JSON.stringify({ language: languageCode, provider })}::jsonb
          )
        `;
        enriched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI enrichment failed";
        failed.push({ id: String(product.id), error: message });
        await sql`
          UPDATE products SET ai_status = 'failed', ai_error = ${message.slice(0, 1000)},
            updated_at = now()
          WHERE id = ${product.id} AND workspace_id = ${auth.context.workspace.id}::uuid
        `;
      }
    }
    return Response.json({
      enriched,
      failed,
      products: products.map((product) => ({ id: String(product.id), title: String(product.title) })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
