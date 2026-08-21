CREATE TABLE IF NOT EXISTS export_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  template_key text NOT NULL DEFAULT 'custom',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS export_presets_workspace_updated_idx
  ON export_presets (workspace_id, updated_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS export_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  preset_id uuid REFERENCES export_presets(id) ON DELETE SET NULL,
  session_id uuid REFERENCES scrape_jobs(id) ON DELETE SET NULL,
  created_by text,
  name text NOT NULL,
  format text NOT NULL DEFAULT 'shopify_csv',
  scope text NOT NULL DEFAULT 'all',
  product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS export_runs_workspace_created_idx
  ON export_runs (workspace_id, created_at DESC);
