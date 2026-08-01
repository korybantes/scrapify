CREATE TABLE IF NOT EXISTS shopify_oauth_states (
  nonce text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  shop text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS shopify_oauth_states_expires_idx
  ON shopify_oauth_states (expires_at);
