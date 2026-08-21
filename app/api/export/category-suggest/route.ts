import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";
import taxonomyPayload from "@/public/shopify-taxonomy-2026-05.json";

const taxonomy = taxonomyPayload.categories as Array<[string, string]>;
const translations: Record<string, string[]> = {
  ayakkabi: ["shoes", "sneakers"], sneaker: ["sneakers", "shoes"], spor: ["sporting", "sneakers"],
  parfum: ["perfumes", "colognes", "fragrance"], koku: ["perfumes", "colognes"],
  canta: ["bags", "handbags"], giyim: ["clothing", "apparel"], elbise: ["dresses", "clothing"],
  gomlek: ["shirts", "clothing"], pantolon: ["pants", "clothing"], kozmetik: ["cosmetics", "beauty"],
  saat: ["watches"], gozluk: ["eyewear", "sunglasses"], aksesuar: ["accessories"],
};
const stopWords = new Set(["ve", "ile", "icin", "erkek", "kadin", "unisex", "the", "and", "for", "ml", "edp", "edt"]);

function normalize(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function rankCandidates(products: Array<Record<string, unknown>>) {
  const frequencies = new Map<string, number>();
  for (const product of products) {
    const words = normalize([product.title, product.vendor, product.category].filter(Boolean).join(" ")).split(/\s+/);
    for (const word of words) {
      if (!word || word.length < 3 || stopWords.has(word) || /^\d+$/.test(word)) continue;
      frequencies.set(word, (frequencies.get(word) || 0) + 1);
      for (const translated of translations[word] || []) frequencies.set(translated, (frequencies.get(translated) || 0) + 2);
    }
  }
  return taxonomy.map(([id, breadcrumb]) => {
    const normalized = normalize(breadcrumb);
    const leaf = normalize(breadcrumb.split(" > ").pop() || breadcrumb);
    let score = 0;
    for (const [token, frequency] of frequencies) {
      if (leaf.includes(token)) score += frequency * 8;
      else if (normalized.includes(token)) score += frequency * 3;
    }
    return { id, breadcrumb, score };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.breadcrumb.split(" > ").length - b.breadcrumb.split(" > ").length)
    .slice(0, 40);
}

function parseSuggestion(value: string, candidates: Array<{ id: string; breadcrumb: string; score: number }>) {
  const cleaned = value.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?|```/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const candidate = candidates.find((item) => item.id === String(parsed.id || ""));
    if (!candidate) return null;
    return {
      ...candidate,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 75)),
      reason: String(parsed.reason || "Best match for this product selection").slice(0, 240),
    };
  } catch {
    return null;
  }
}

async function suggestWithGroq(products: Array<Record<string, unknown>>, candidates: Array<{ id: string; breadcrumb: string; score: number }>) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Groq is not configured");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      temperature: 0,
      max_completion_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Choose exactly one Shopify taxonomy candidate. Return JSON only with id, confidence from 0 to 100, and a short reason. Never invent an ID." },
        { role: "user", content: JSON.stringify({ products: products.slice(0, 12).map((p) => ({ title: p.title, vendor: p.vendor, source_category: p.category })), candidates }) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Groq returned ${response.status}`);
  const result = await response.json();
  return parseSuggestion(result.choices?.[0]?.message?.content || "", candidates);
}

async function suggestWithVps(products: Array<Record<string, unknown>>, candidates: Array<{ id: string; breadcrumb: string; score: number }>) {
  const backendUrl = process.env.SCRAPPIFY_BACKEND_URL?.replace(/\/$/, "");
  const backendKey = process.env.SCRAPPIFY_API_KEY;
  if (!backendUrl || !backendKey) throw new Error("ScrapifyAI is not configured");
  const response = await fetch(`${backendUrl}/v1/ai/category-suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Scrappify-Key": backendKey },
    body: JSON.stringify({
      products: products.slice(0, 12).map((p) => ({ title: p.title, vendor: p.vendor, category: p.category })),
      candidates,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || "ScrapifyAI category suggestion failed");
  const candidate = candidates.find((item) => item.id === result.id);
  return candidate ? { ...candidate, confidence: Number(result.confidence || 75), reason: String(result.reason || "Best match for this product selection") } : null;
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const payload = await request.json();
    const ids = Array.isArray(payload.ids) ? payload.ids.slice(0, 1000) : [];
    const sessionId = String(payload.session_id || "").trim() || null;
    const sql = db();
    const products = ids.length
      ? await sql`SELECT title, vendor, category FROM products
          WHERE workspace_id = ${auth.context.workspace.id}::uuid AND id = ANY(${ids}::uuid[]) LIMIT 100`
      : sessionId
        ? await sql`SELECT product.title, product.vendor, product.category FROM products product
            WHERE product.workspace_id = ${auth.context.workspace.id}::uuid
              AND EXISTS (SELECT 1 FROM scrape_job_products link
                WHERE link.product_id = product.id AND link.job_id = ${sessionId}::uuid
                  AND link.workspace_id = ${auth.context.workspace.id}::uuid)
            LIMIT 100`
        : await sql`SELECT title, vendor, category FROM products
            WHERE workspace_id = ${auth.context.workspace.id}::uuid ORDER BY updated_at DESC LIMIT 100`;
    if (!products.length) return Response.json({ error: "No products available for category analysis" }, { status: 400 });
    const candidates = rankCandidates(products);
    if (!candidates.length) return Response.json({ error: "No category candidates could be found" }, { status: 422 });

    let suggestion = null;
    let provider = "ScrapifyAI";
    try {
      suggestion = await suggestWithVps(products, candidates);
    } catch {
      try {
        suggestion = await suggestWithGroq(products, candidates);
        provider = "Groq";
      } catch {
        suggestion = { ...candidates[0], confidence: 55, reason: "Suggested from product titles and source categories" };
        provider = "Catalog intelligence";
      }
    }
    if (!suggestion) suggestion = { ...candidates[0], confidence: 55, reason: "Suggested from product titles and source categories" };
    return Response.json({ suggestion, provider, alternatives: candidates.slice(0, 5), analyzed: products.length });
  } catch (error) {
    return jsonError(error);
  }
}