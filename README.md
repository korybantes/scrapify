# Scrappify

Scrappify is a production catalog pipeline for collecting products with
Playwright, reviewing them in a web dashboard, enriching selected records with
Groq, and exporting or syncing them to Shopify.

The repository contains two production surfaces:

- `app/`: the responsive dashboard and server-side API routes deployed with Sites.
- `backend/`: the FastAPI service and always-on Python Playwright worker.

There is no seeded or fallback product data. The dashboard reads products, jobs,
events, prices, warnings, and service status directly from Neon PostgreSQL.

## Architecture

1. The dashboard inserts a `queued` record into `scrape_jobs`.
2. The Python worker claims one job with PostgreSQL `FOR UPDATE SKIP LOCKED`.
3. Playwright collects real product cards and upserts products by source URL.
4. The dashboard polls Neon and displays live job progress.
5. Selected products can be enriched through Groq.
6. Shopify CSV is generated from the current database at download time.
7. Optional Shopify GraphQL sync uses `productSet` for handle-based upserts.

PostgreSQL is the queue and source of truth, so a separate Redis service is not
required for this workload.

## Local dashboard

Copy `.env.example` to `.env.local`, fill in the required values, then:

```bash
npm install
npm run dev
```

## Local API and worker

From `backend/`, create a Python 3.10+ environment and install dependencies:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m playwright install chromium
```

Run the API:

```bash
.venv/Scripts/python -m uvicorn app.api:app --host 0.0.0.0 --port 8000
```

Run the worker in a second process:

```bash
.venv/Scripts/python -m app.worker
```

The API and worker automatically apply the idempotent initial schema.

## Deployment

`render.yaml` defines an API service and a background worker. Set these secrets
in the deployment provider:

- `NEON_DB_URL`
- `GROQ_API_KEY`
- `SCRAPPIFY_API_KEY`
- `ALLOWED_ORIGINS`
- optional `SHOPIFY_STORE_DOMAIN`
- optional `SHOPIFY_ACCESS_TOKEN`

The GitHub workflow publishes the backend container to
`ghcr.io/korybantes/scrappify-backend:latest`.

## Security

- Credentials are environment variables and are excluded from Git.
- Source URLs are restricted to an explicit hostname allowlist.
- Database writes use parameterized queries.
- The FastAPI surface supports an `X-Scrappify-Key` shared secret.
- Shopify products default to draft unless the database record is explicitly
  marked published.
