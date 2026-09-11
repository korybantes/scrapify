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
- Product review, multi-image galleries, quality checks, Shopify CSV export, and Shopify Admin API sync
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
- FastAPI, Playwright worker, Ollama, and image processing: **Ubuntu VPS with Docker Compose**
- Database: any supported PostgreSQL provider

`vercel.json` deploys the web application. The VPS runs `docker-compose.yml`,
with persistent volumes for Ollama models, processed product media, and the
background-removal model. Only the API needs a public HTTPS domain; the worker
remains private.

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
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_SCOPES`
- `SHOPIFY_REDIRECT_URI`

Each workspace owner connects Shopify through the official OAuth approval
screen. The resulting offline Admin API token is encrypted at rest with
`WORKSPACE_ENCRYPTION_SECRET`; merchants never copy or expose a token.

### Shopify app configuration

Create a public app in the Shopify Dev Dashboard and configure:

- App URL: `https://scrapify-mu.vercel.app/app`
- Allowed callback URL: `https://scrapify-mu.vercel.app/api/shopify/oauth/callback`
- Webhook URL: `https://scrapify-mu.vercel.app/api/shopify/webhooks`
- Scopes: `read_products,write_products,read_locations,write_inventory`

Add the client ID and client secret to Vercel, redeploy, then use **Settings →
Connect Shopify**. Installations initiated from Shopify are also supported: an
existing merchant is returned to OAuth automatically, while a new merchant is
asked to create a Scrapify account first.

The callback validates Shopify's HMAC and a signed, expiring workspace state
before exchanging the authorization code. The app registers uninstall and
privacy webhooks after installation. AI-ready products can then be published
directly from the guided Export screen.

### Backend environment

- `DATABASE_URL`
- `GROQ_API_KEY`
- `SCRAPPIFY_API_KEY`
- `PUBLIC_API_URL` (the same public HTTPS backend origin used by Vercel)
- `ALLOWED_ORIGINS`
- `ALLOWED_SOURCE_HOSTS`
- optional `SHOPIFY_STORE_DOMAIN`
- optional `SHOPIFY_ACCESS_TOKEN`

The GitHub workflow publishes the backend container to
`ghcr.io/korybantes/scrappify-backend:latest`.

### Product media

Every product can keep up to 20 ordered images. The product editor supports
cover selection, drag-to-reorder, alt text, variant-specific image assignment,
duplicate detection, resolution and aspect-ratio checks, 1600 × 1600 canvas
normalization, and real background removal. Shopify CSV and Admin API exports
preserve the complete gallery and variant mappings.

Existing products receive their current primary image during migration. Re-run
a saved source once to collect the full source gallery. The first background
cleanup downloads its model into the persistent `rembg_models` volume; later
runs reuse it.
## Security

- Passwords and sessions are managed by Better Auth.
- Credentials are environment variables and excluded from Git.
- Every customer-facing database operation is scoped to a verified workspace.
- Source URLs are restricted to an explicit hostname allowlist.
- Database writes use parameterized queries.
- Shopify products default to draft unless explicitly marked published.
