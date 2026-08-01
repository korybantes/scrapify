CREATE TABLE IF NOT EXISTS scrape_job_products (
  job_id uuid NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, product_id)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS scrape_job_products_workspace_job_idx
  ON scrape_job_products (workspace_id, job_id);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS scrape_job_products_product_idx
  ON scrape_job_products (product_id);
-- statement-breakpoint
INSERT INTO scrape_job_products (job_id, product_id, workspace_id, discovered_at)
SELECT DISTINCT j.id, p.id, j.workspace_id, p.last_seen_at
FROM scrape_jobs j
JOIN products p
  ON p.workspace_id = j.workspace_id
 AND p.source = j.source
 AND p.last_seen_at >= COALESCE(j.started_at, j.created_at)
 AND p.last_seen_at <= COALESCE(j.completed_at, now()) + interval '5 minutes'
WHERE j.status IN ('running', 'completed')
ON CONFLICT (job_id, product_id) DO NOTHING;
