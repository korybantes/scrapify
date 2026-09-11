export const DEFAULT_GROQ_MODEL = "qwen/qwen3.6-27b";

const RETIRED_GROQ_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
]);

export function activeGroqModel(configured = process.env.GROQ_MODEL) {
  const model = configured?.trim();
  return !model || RETIRED_GROQ_MODELS.has(model) ? DEFAULT_GROQ_MODEL : model;
}