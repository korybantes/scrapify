ALTER TABLE products
  ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
-- statement-breakpoint
UPDATE products
SET images = jsonb_build_array(jsonb_build_object(
  'id', md5(image_url),
  'url', image_url,
  'source_url', image_url,
  'position', 1,
  'alt', title,
  'variant_ids', '[]'::jsonb,
  'processing_status', 'original'
))
WHERE image_url <> '' AND images = '[]'::jsonb;
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS products_images_gin_idx
  ON products USING gin (images);
