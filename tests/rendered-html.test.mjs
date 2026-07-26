import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://user:password@localhost:5432/scrappify";
process.env.BETTER_AUTH_SECRET ||= "test-secret-that-is-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the public Scrappify landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /SCRAPPIFY/);
  assert.match(html, /Your product catalog/);
  assert.match(html, /Create account/);
  assert.match(html, /Organizations for your business/);
  assert.match(html, /multilingual AI copy/);
  assert.doesNotMatch(html, /Neon connected|No products in Neon|mock data/i);
});

test("renders account entry points without seeded catalog claims", async () => {
  const response = await render("/login?mode=signup");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Create account/);
  assert.match(html, /Secure accounts/);
  assert.doesNotMatch(html, /\b12,540\b|\b8,250\b|demo catalog/i);
});
