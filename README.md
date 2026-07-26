# Scrappify

Scrappify is a multi-tenant catalog operations platform for collecting real
products with Playwright, reviewing them in isolated workspaces, generating
multilingual SEO descriptions with Groq, and exporting or syncing them to
Shopify.

There is no seeded, fallback, or demo catalog. Every product, job, event,
warning, and metric shown in the authenticated dashboard comes from PostgreSQL.

## What is included

- Public marketing site and email/password accounts
- Organizations and independent workspaces
- Reusable saved sources with page settings and default SEO language
- Turkish, English, German, French, Spanish, Polish, Arabic, and Italian AI copy
- Live scrape queue and Playwright background worker
- Product review, Shopify CSV export, and Shopify Admin API sync
- Workspace-scoped products, sources, jobs, events, exports, and AI actions

## Architecture

1. The web app authenticates the user and resolves their selected workspace.
2. A saved or one-time source creates a workspace-scoped `queued` scrape job.
3. The Python worker claims work with PostgreSQL `FOR UPDATE SKIP LOCKED`.
4. Playwright collects real product cards and upserts them inside the workspace.
5. Groq can enrich each product in the language selected for the run.
6. CSV exports and Shopify sync only read products from the selected workspace.

PostgreSQL is both the job queue and source of truth, so Redis is not required.

## Local development

Copy `.env.example` to `.env.local`, configure the values, then:

```bash
npm install
npm run dev
```

For the API and worker, create a Python 3.10+ environment in `backend/`:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m playwright install chromium
```

Run the API and worker in separate terminals:

```bash
.venv/Scripts/python -m uvicorn app.api:app --host 0.0.0.0 --port 8000
.venv/Scripts/python -m app.worker
```

The API and worker apply all idempotent SQL migrations on startup.

## Recommended deployment

- Frontend and authenticated web routes: **Vercel**
- FastAPI service and Playwright worker: **Railway**
- Database: any supported PostgreSQL provider

`vercel.json` uses the standard Next.js build. For Railway, create two services
from this repository:

1. API service using `railway-api.toml`
2. Worker service using `railway-worker.toml`

Both services use the same Docker image and database. The API gets a public
domain; the worker remains private. `docker-compose.yml` provides the equivalent
two-service layout for local or compose-based deployment.

### Frontend environment

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `WORKSPACE_ENCRYPTION_SECRET`
- `INITIAL_OWNER_EMAIL` (the only signup allowed to claim the migrated catalog)
- `GROQ_API_KEY`
- `GROQ_MODEL`
- `ALLOWED_SOURCE_HOSTS`

Each workspace owner connects its Shopify store from the Settings screen. The
Admin API token is encrypted at rest with `WORKSPACE_ENCRYPTION_SECRET`.

### Backend environment

- `DATABASE_URL`
- `GROQ_API_KEY`
- `SCRAPPIFY_API_KEY`
- `ALLOWED_ORIGINS`
- `ALLOWED_SOURCE_HOSTS`
- optional `SHOPIFY_STORE_DOMAIN`
- optional `SHOPIFY_ACCESS_TOKEN`

The GitHub workflow publishes the backend container to
`ghcr.io/korybantes/scrappify-backend:latest`.

## Security

- Passwords and sessions are managed by Better Auth.
- Credentials are environment variables and excluded from Git.
- Every customer-facing database operation is scoped to a verified workspace.
- Source URLs are restricted to an explicit hostname allowlist.
- Database writes use parameterized queries.
- Shopify products default to draft unless explicitly marked published.
