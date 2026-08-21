import os
import unittest
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")

from app.scraper import _beymen_product_id, _normalize_beymen_summary, parse_price


class ParsePriceTests(unittest.TestCase):
    def test_turkish_price(self):
        self.assertEqual(parse_price("12.990,00 TL"), (Decimal("12990.00"), None))

    def test_decimal_price(self):
        self.assertEqual(parse_price("1.299,9 ₺"), (Decimal("1299.90"), None))

    def test_us_price(self):
        self.assertEqual(parse_price("$1,299.90"), (Decimal("1299.90"), None))

    def test_uses_only_first_price_in_combined_text(self):
        self.assertEqual(
            parse_price("12.265,00 TL 9.812,00 TL"),
            (Decimal("12265.00"), None),
        )

    def test_ignores_discount_percentage(self):
        self.assertEqual(
            parse_price("-%12\n7.840 TL\n6.860 TL"),
            (Decimal("7840"), None),
        )

    def test_storage_overflow_is_not_returned(self):
        self.assertEqual(
            parse_price("1000000000000 TL"),
            (None, "Price exceeds the database storage limit"),
        )


class BeymenVariantTests(unittest.TestCase):
    def test_extracts_product_id(self):
        self.assertEqual(
            _beymen_product_id("https://www.beymen.com/tr/p_valentino-shoe_1861592"),
            1861592,
        )

    def test_normalizes_real_size_stock(self):
        summary = _normalize_beymen_summary({"result": {
            "variant": "Beden",
            "stockQuantity": 5,
            "sizes": [
                {"variantId": 1, "sizeName": "40", "variantCode": "SKU40", "variantBarcode": "BC40", "stockQuantity": 3, "inStock": True},
                {"variantId": 2, "sizeName": "41", "variantCode": "SKU41", "variantBarcode": "BC41", "stockQuantity": 0, "inStock": False},
            ],
        }})
        self.assertTrue(summary["loaded"])
        self.assertEqual(summary["inventory_qty"], 3)
        self.assertEqual(summary["variants"][0]["option_value"], "40")
        self.assertEqual(summary["variants"][0]["sku"], "SKU40")
        self.assertFalse(summary["variants"][1]["available"])


if __name__ == "__main__":
    unittest.main()
