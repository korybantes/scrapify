export type ProductImage = {
  id: string;
  url: string;
  source_url?: string;
  position: number;
  alt?: string;
  width?: number;
  height?: number;
  aspect_ratio?: number;
  bytes?: number;
  sha256?: string;
  duplicate_of?: string | null;
  quality_status?: "ready" | "warning";
  quality_warnings?: string[];
  processing_status?: "original" | "normalized" | "background_removed";
  variant_ids?: string[];
};

export function productImages(product: Record<string, unknown>): ProductImage[] {
  const values = Array.isArray(product.images) ? product.images : [];
  const fallback = String(product.image_url || "").trim();
  const source = values.length ? values : fallback ? [{ id: fallback, url: fallback, position: 1 }] : [];
  const seen = new Set<string>();
  return source
    .map((value, index) => {
      const image = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const url = String(image.url || "").trim();
      const key = String(image.sha256 || image.source_url || url).trim().toLowerCase();
      const duplicate = Boolean(key && seen.has(key));
      if (key) seen.add(key);
      return {
        ...image,
        id: String(image.id || url || index),
        url,
        source_url: String(image.source_url || url),
        position: index + 1,
        alt: String(image.alt || product.title || ""),
        variant_ids: Array.isArray(image.variant_ids) ? image.variant_ids.map(String) : [],
        duplicate_of: image.duplicate_of ? String(image.duplicate_of) : duplicate ? "gallery" : null,
      } as ProductImage;
    })
    .filter((image) => /^https:\/\//i.test(image.url));
}
