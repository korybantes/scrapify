import re


def export_product_title(title_value, vendor_value) -> str:
    title = re.sub(r"\s+", " ", str(title_value or "")).strip()
    vendor = re.sub(r"\s+", " ", str(vendor_value or "")).strip()
    if not vendor or not title:
        return title or vendor
    comparable_title = re.sub(r"[^\w]+", " ", title.casefold()).strip()
    comparable_vendor = re.sub(r"[^\w]+", " ", vendor.casefold()).strip()
    if comparable_title == comparable_vendor or comparable_title.startswith(comparable_vendor + " "):
        return title
    return f"{vendor} - {title}"
