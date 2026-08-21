-- Catalog operations platform
ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;
-- statement-breakpoint
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check CHECK (role IN ('owner', 'admin', 'member', 'reviewer'));
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS product_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE, snapshot jsonb NOT NULL, source text NOT NULL DEFAULT 'scraper', actor text, created_at timestamptz NOT NULL DEFAULT now());
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS product_versions_product_created_idx ON product_versions(product_id, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS catalog_changes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE, field text NOT NULL, old_value jsonb, new_value jsonb, source text NOT NULL DEFAULT 'source', status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','applied')), detected_at timestamptz NOT NULL DEFAULT now(), reviewed_by text, reviewed_at timestamptz);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS catalog_changes_workspace_status_idx ON catalog_changes(workspace_id, status, detected_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS automation_recipes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name text NOT NULL, source_id uuid REFERENCES saved_sources(id) ON DELETE SET NULL, schedule text NOT NULL DEFAULT 'daily' CHECK (schedule IN ('hourly','daily','weekly','manual')), actions jsonb NOT NULL DEFAULT '[]'::jsonb, enabled boolean NOT NULL DEFAULT true, approval_required boolean NOT NULL DEFAULT true, last_run_at timestamptz, next_run_at timestamptz, created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS automation_recipes_due_idx ON automation_recipes(enabled, next_run_at);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS approval_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE, change_ids uuid[] NOT NULL DEFAULT '{}'::uuid[], status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), requested_by text, reviewed_by text, note text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS approval_requests_workspace_status_idx ON approval_requests(workspace_id, status, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS workspace_invitations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, email text NOT NULL, role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','reviewer')), token text NOT NULL UNIQUE, invited_by text, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')), expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, email));
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS source_adapters (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name text NOT NULL, source_host text NOT NULL, config jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','verified','failed')), sample_count integer NOT NULL DEFAULT 0, last_tested_at timestamptz, created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, source_host));
-- statement-breakpoint
ALTER TABLE scrape_jobs ADD COLUMN IF NOT EXISTS source_adapter_id uuid REFERENCES source_adapters(id) ON DELETE SET NULL;
-- statement-breakpoint
ALTER TABLE scrape_jobs ADD COLUMN IF NOT EXISTS automation_recipe_id uuid REFERENCES automation_recipes(id) ON DELETE SET NULL;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS product_translations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE, locale text NOT NULL, market text NOT NULL DEFAULT '', title text, body_html text, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','published','failed')), provider text, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(product_id, locale, market));
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS product_translations_workspace_locale_idx ON product_translations(workspace_id, locale, status);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS workspace_catalog_profiles (workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, brand_voice text NOT NULL DEFAULT '', forbidden_words text[] NOT NULL DEFAULT '{}'::text[], target_keywords text[] NOT NULL DEFAULT '{}'::text[], approval_required boolean NOT NULL DEFAULT true, auto_publish boolean NOT NULL DEFAULT false, white_label_name text NOT NULL DEFAULT '', white_label_logo_url text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now());
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS product_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE, author_id text, author_name text NOT NULL, body text NOT NULL, mentions text[] NOT NULL DEFAULT '{}'::text[], created_at timestamptz NOT NULL DEFAULT now());
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS product_comments_product_created_idx ON product_comments(product_id, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS operation_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, recipe_id uuid REFERENCES automation_recipes(id) ON DELETE SET NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')), summary jsonb NOT NULL DEFAULT '{}'::jsonb, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS operation_runs_workspace_started_idx ON operation_runs(workspace_id, started_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS organization_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name text NOT NULL, config jsonb NOT NULL DEFAULT '{}'::jsonb, created_by text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, name));
