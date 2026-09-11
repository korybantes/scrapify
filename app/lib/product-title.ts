function comparable(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function exportProductTitle(titleValue: unknown, vendorValue: unknown) {
  const title = String(titleValue ?? "").replace(/\s+/g, " ").trim();
  const vendor = String(vendorValue ?? "").replace(/\s+/g, " ").trim();
  if (!vendor || !title) return title || vendor;
  const normalizedTitle = comparable(title);
  const normalizedVendor = comparable(vendor);
  if (normalizedTitle === normalizedVendor || normalizedTitle.startsWith(normalizedVendor + " ")) return title;
  return vendor + " - " + title;
}
