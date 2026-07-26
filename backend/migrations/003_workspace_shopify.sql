CREATE TABLE IF NOT EXISTS workspace_shopify_integrations (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  store_domain text NOT NULL,
  access_token_encrypted text NOT NULL,
  api_version text NOT NULL DEFAULT '2026-07',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
