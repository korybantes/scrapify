import os
import unittest
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")

from app.scraper import parse_price


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


if __name__ == "__main__":
    unittest.main()
