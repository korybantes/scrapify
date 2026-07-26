CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session" (user_id);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account (user_id);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS saved_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_host text NOT NULL,
  category_name text NOT NULL,
  category_url text NOT NULL,
  start_page integer NOT NULL DEFAULT 1 CHECK (start_page > 0),
  max_pages integer NOT NULL DEFAULT 1 CHECK (max_pages BETWEEN 1 AND 100),
  seo_language text NOT NULL DEFAULT 'tr',
  auto_enrich boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
-- statement-breakpoint
INSERT INTO organizations (id, name, slug)
VALUES ('00000000-0000-4000-8000-000000000001', 'Scrappify Studio', 'scrappify-studio')
ON CONFLICT (id) DO NOTHING;
-- statement-breakpoint
INSERT INTO workspaces (id, organization_id, name, slug)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'Production Catalog',
  'production-catalog'
)
ON CONFLICT (id) DO NOTHING;
-- statement-breakpoint
ALTER TABLE scrape_jobs ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
-- statement-breakpoint
ALTER TABLE scrape_jobs ADD COLUMN IF NOT EXISTS saved_source_id uuid REFERENCES saved_sources(id) ON DELETE SET NULL;
-- statement-breakpoint
ALTER TABLE scrape_jobs ADD COLUMN IF NOT EXISTS seo_language text NOT NULL DEFAULT 'tr';
-- statement-breakpoint
UPDATE scrape_jobs
SET workspace_id = '00000000-0000-4000-8000-000000000002'
WHERE workspace_id IS NULL;
-- statement-breakpoint
ALTER TABLE scrape_jobs ALTER COLUMN workspace_id SET NOT NULL;
-- statement-breakpoint
ALTER TABLE products ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
-- statement-breakpoint
ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_language text NOT NULL DEFAULT 'tr';
-- statement-breakpoint
UPDATE products
SET workspace_id = '00000000-0000-4000-8000-000000000002'
WHERE workspace_id IS NULL;
-- statement-breakpoint
ALTER TABLE products ALTER COLUMN workspace_id SET NOT NULL;
-- statement-breakpoint
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
-- statement-breakpoint
UPDATE activity_events event
SET workspace_id = COALESCE(
  (SELECT workspace_id FROM scrape_jobs WHERE id = event.job_id),
  (SELECT workspace_id FROM products WHERE id = event.product_id),
  '00000000-0000-4000-8000-000000000002'::uuid
)
WHERE workspace_id IS NULL;
-- statement-breakpoint
ALTER TABLE activity_events ALTER COLUMN workspace_id SET NOT NULL;
-- statement-breakpoint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_source_source_product_url_key;
-- statement-breakpoint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_workspace_source_url_key;
-- statement-breakpoint
ALTER TABLE products
  ADD CONSTRAINT products_workspace_source_url_key
  UNIQUE (workspace_id, source, source_product_url);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS scrape_jobs_workspace_created_idx
  ON scrape_jobs (workspace_id, created_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS products_workspace_updated_idx
  ON products (workspace_id, updated_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_events_workspace_created_idx
  ON activity_events (workspace_id, created_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS saved_sources_workspace_idx
  ON saved_sources (workspace_id, updated_at DESC);
