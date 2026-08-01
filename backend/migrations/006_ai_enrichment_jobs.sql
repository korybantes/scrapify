CREATE TABLE IF NOT EXISTS ai_enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'tr',
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'completed_with_errors', 'cancelled')),
  total integer NOT NULL DEFAULT 0,
  completed integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  current_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  current_product_title text,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  claimed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_enrichment_jobs_workspace_created_idx
  ON ai_enrichment_jobs (workspace_id, created_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_enrichment_jobs_status_idx
  ON ai_enrichment_jobs (status, created_at);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_enrichment_job_items (
  job_id uuid NOT NULL REFERENCES ai_enrichment_jobs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'enriched', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, product_id)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_enrichment_job_items_queue_idx
  ON ai_enrichment_job_items (job_id, status, created_at);
