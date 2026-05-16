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

    def test_extract_results_filters_and_dedupes(self):
        payload = {
            "organic": [
                {
                    "title": "Black Bomber Jacket",
                    "link": "https://www.zara.com/us/en/black-bomber-jacket-p123.html",
                    "snippet": "A clean bomber jacket",
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

    def test_prompt_if_missing_non_interactive(self):
        with patch("sys.stdin.isatty", return_value=False):
            self.assertEqual(main.prompt_if_missing(None), "")

    def test_prompt_if_missing_uses_existing_style(self):
        with patch("builtins.input") as mocked_input:
            value = main.prompt_if_missing("  goth formal  ")
            self.assertEqual(value, "goth formal")
            mocked_input.assert_not_called()

    def test_validate_limit_raises_for_non_positive(self):
        with self.assertRaises(ValueError):
            main.validate_limit(0)
        with self.assertRaises(ValueError):
            main.validate_limit(-3)
        self.assertEqual(main.validate_limit(2), 2)

    def test_main_returns_2_for_missing_style_in_non_interactive_mode(self):
        argv = ["main.py"]
        stderr = io.StringIO()
        with patch("sys.argv", argv), patch("sys.stdin.isatty", return_value=False), patch(
            "sys.stderr", stderr
        ):
            code = main.main()
        self.assertEqual(code, 2)
        self.assertIn("style description is required", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
