ALTER TABLE products
  ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '[]'::jsonb;
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS products_variants_gin_idx
  ON products USING gin (variants);
