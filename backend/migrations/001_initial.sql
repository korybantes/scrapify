CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS scrape_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  category_name text NOT NULL,
  category_url text NOT NULL,
  start_page integer NOT NULL DEFAULT 1 CHECK (start_page > 0),
  max_pages integer NOT NULL DEFAULT 1 CHECK (max_pages BETWEEN 1 AND 100),
  download_images boolean NOT NULL DEFAULT false,
  auto_enrich boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  pages_completed integer NOT NULL DEFAULT 0,
  products_found integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error text,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS scrape_jobs_status_created_idx
  ON scrape_jobs (status, created_at);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_product_url text NOT NULL,
  title text NOT NULL,
  vendor text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  sale_price numeric(14,2),
  compare_at_price numeric(14,2),
  image_url text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}'::text[],
  published boolean NOT NULL DEFAULT false,
  inventory_qty integer NOT NULL DEFAULT 10,
  price_warning text,
  ai_status text NOT NULL DEFAULT 'pending'
    CHECK (ai_status IN ('pending', 'enriched', 'failed', 'skipped')),
  ai_error text,
  shopify_product_id text,
  shopify_status text NOT NULL DEFAULT 'not_synced'
    CHECK (shopify_status IN ('not_synced', 'draft', 'active', 'failed')),
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_product_url)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS products_updated_idx ON products (updated_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS products_source_idx ON products (source);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS products_ai_status_idx ON products (ai_status);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS activity_events (
  id bigserial PRIMARY KEY,
  job_id uuid REFERENCES scrape_jobs(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  level text NOT NULL DEFAULT 'info',
  event_type text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_events_created_idx
  ON activity_events (created_at DESC);
