import io
import unittest
from unittest.mock import patch

import main


class TestStyleFinderCore(unittest.TestCase):
    def test_normalize_style_collapses_whitespace(self):
        self.assertEqual(main.normalize_style("  90s   grunge   streetwear  "), "90s grunge streetwear")

    def test_normalize_style_rejects_too_long_input(self):
        too_long = "a" * (main.MAX_STYLE_LENGTH + 1)
        with self.assertRaises(ValueError):
            main.normalize_style(too_long)

    def test_build_query_contains_normalized_style_and_shopping_intent(self):
        query = main.build_query("  minimal  monochrome ")
        self.assertIn("minimal monochrome", query)
        self.assertIn("clothing", query)
        self.assertIn("buy", query)

    def test_is_blocked_domain(self):
        self.assertTrue(main.is_blocked_domain("https://www.pinterest.com/pin/123"))
        self.assertTrue(main.is_blocked_domain("https://m.instagram.com/p/something"))
        self.assertTrue(main.is_blocked_domain("https://blog.pinterest.com/trends"))
        self.assertFalse(main.is_blocked_domain("https://www.zara.com/us/en/jacket-p123"))

    def test_is_non_store_domain(self):
        self.assertTrue(main.is_non_store_domain("https://www.reddit.com/r/goth/comments/abc"))
        self.assertTrue(main.is_non_store_domain("https://fashion.medium.com/some-post"))
        self.assertFalse(main.is_non_store_domain("https://www.zara.com/us/en/jacket-p123"))

    def test_is_google_redirect_url(self):
        self.assertTrue(
            main.is_google_redirect_url(
                "https://www.google.com/search?ibp=oshop&q=goth+clothing&udm=28"
            )
        )
        self.assertFalse(main.is_google_redirect_url("https://store.com/products/black-gothic-dress"))

    def test_is_likely_product_url(self):
        self.assertTrue(main.is_likely_product_url("https://store.com/products/black-dress"))
        self.assertTrue(main.is_likely_product_url("https://store.com/p/sku123"))
        self.assertTrue(main.is_likely_product_url("https://store.com/women/dress-12345"))
        self.assertFalse(main.is_likely_product_url("https://store.com"))
        self.assertFalse(main.is_likely_product_url("https://store.com/collections/goth"))
        self.assertFalse(main.is_likely_product_url("https://store.com/shop"))

    def test_extract_results_filters_and_dedupes(self):
        payload = {
            "organic": [
                {
                    "title": "Black Bomber Jacket",
                    "link": "https://www.zara.com/us/en/black-bomber-jacket-p123.html",
                    "snippet": "A clean bomber jacket",
                },
                {
                    "title": "Reddit thread",
                    "link": "https://www.reddit.com/r/goth/comments/abc",
                    "snippet": "Where to shop",
                },
                {
                    "title": "Inspo board",
                    "link": "https://www.pinterest.com/pin/abc",
                    "snippet": "Mood board",
                },
                {
                    "title": "Black Bomber Jacket duplicate",
                    "link": "https://www.zara.com/us/en/black-bomber-jacket-p123.html",
                    "snippet": "Duplicate link",
                },
                {
                    "title": 7,
                    "link": "https://www.uniqlo.com/us/en/products/E123456-000/00",
                    "snippet": None,
                },
                {"title": "Bad link", "link": "ftp://example.com/item", "snippet": "Nope"},
            ]
        }

        results = main.extract_results(payload)

        self.assertEqual(len(results), 2)
        self.assertEqual(
            results[0]["url"],
            "https://www.zara.com/us/en/black-bomber-jacket-p123.html",
        )
        self.assertEqual(
            results[1]["url"],
            "https://www.uniqlo.com/us/en/products/E123456-000/00",
        )
        self.assertEqual(results[1]["title"], "Untitled result")
        self.assertEqual(results[1]["snippet"], "")

    def test_extract_shopping_results_filters_and_dedupes(self):
        payload = {
            "shopping": [
                {
                    "title": "Black Gothic Dress",
                    "link": "https://store.com/products/black-gothic-dress",
                    "snippet": "Lace gothic dress",
                },
                {
                    "title": "Google redirect",
                    "link": "https://www.google.com/search?ibp=oshop&q=goth+clothing&udm=28",
                    "snippet": "Redirect",
                },
                {
                    "title": "Discussion thread",
                    "link": "https://www.reddit.com/r/goth/comments/abc",
                    "snippet": "Where to buy",
                },
                {
                    "title": "Duplicate",
                    "link": "https://store.com/products/black-gothic-dress",
                    "snippet": "Duplicate",
                },
            ]
        }

        results = main.extract_shopping_results(payload)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "https://store.com/products/black-gothic-dress")

    def test_prompt_if_missing_non_interactive(self):
        with patch("sys.stdin.isatty", return_value=False):
            self.assertEqual(main.prompt_if_missing(None), "")

    def test_prompt_if_missing_uses_existing_style(self):
        with patch("builtins.input") as mocked_input:
            value = main.prompt_if_missing("  goth formal  ")
            self.assertEqual(value, "goth formal")
            mocked_input.assert_not_called()

    def test_resolve_style_input_uses_prompt_marker(self):
        with patch.object(main, "PROMPT", "dark academia"), patch("sys.stdin.isatty", return_value=False):
            self.assertEqual(main.resolve_style_input(None), "dark academia")

    def test_select_output_url_prefers_product_page(self):
        with patch.object(main, "URL", ""):
            url = main.select_output_url(
                [
                    {"title": "Store homepage", "url": "https://store.com", "snippet": ""},
                    {"title": "Category", "url": "https://store.com/collections/goth", "snippet": ""},
                    {"title": "Product", "url": "https://store.com/products/black-lace-dress", "snippet": ""},
                ]
            )
            self.assertEqual(url, "https://store.com/products/black-lace-dress")
            self.assertEqual(main.URL, "https://store.com/products/black-lace-dress")

    def test_select_output_url_returns_empty_without_product(self):
        with patch.object(main, "URL", ""):
            url = main.select_output_url(
                [
                    {"title": "Store", "url": "https://store.com", "snippet": ""},
                    {"title": "Category", "url": "https://store.com/collections/goth", "snippet": ""},
                ]
            )
            self.assertEqual(url, "")
            self.assertEqual(main.URL, "")

    def test_backplan_retries_until_url_found(self):
        side_effect = [
            {"organic": [{"title": "Store", "link": "https://store.com", "snippet": ""}]},
            {"organic": []},
            {
                "organic": [
                    {
                        "title": "Item",
                        "link": "https://shop.example/products/black-goth-dress-123",
                        "snippet": "",
                    }
                ]
            },
        ]
        with patch("main.search_serper", side_effect=side_effect):
            url, results, attempts, errors = main.find_product_url_with_backplan("goth", "key", 5, 8)

        self.assertEqual(url, "https://shop.example/products/black-goth-dress-123")
        self.assertGreaterEqual(attempts, 3)
        self.assertEqual(errors, [])
        self.assertTrue(results)

    def test_backplan_continues_after_search_error(self):
        side_effect = [
            RuntimeError("temporary failure"),
            {
                "organic": [
                    {
                        "title": "Item",
                        "link": "https://shop.example/products/vintage-goth-coat-444",
                        "snippet": "",
                    }
                ]
            },
        ]
        with patch("main.search_serper", side_effect=side_effect):
            url, results, attempts, errors = main.find_product_url_with_backplan("goth", "key", 5, 8)

        self.assertEqual(url, "https://shop.example/products/vintage-goth-coat-444")
        self.assertGreaterEqual(attempts, 2)
        self.assertEqual(len(errors), 1)
        self.assertTrue(results)

    def test_validate_limit_raises_for_non_positive(self):
        with self.assertRaises(ValueError):
            main.validate_limit(0)
        with self.assertRaises(ValueError):
            main.validate_limit(-3)
        self.assertEqual(main.validate_limit(2), 2)

    def test_validate_max_attempts_raises_for_non_positive(self):
        with self.assertRaises(ValueError):
            main.validate_max_attempts(0)
        with self.assertRaises(ValueError):
            main.validate_max_attempts(-1)
        self.assertEqual(main.validate_max_attempts(3), 3)

    def test_main_returns_2_for_missing_style_in_non_interactive_mode(self):
        argv = ["main.py"]
        stderr = io.StringIO()
        with patch("sys.argv", argv), patch("sys.stdin.isatty", return_value=False), patch(
            "sys.stderr", stderr
        ), patch.object(main, "PROMPT", ""):
            code = main.main()
        self.assertEqual(code, 2)
        self.assertIn("style description is required", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
