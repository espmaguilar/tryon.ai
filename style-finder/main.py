import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse


SERPER_API_URL = "https://google.serper.dev/search"
SERPER_SHOPPING_API_URL = "https://google.serper.dev/shopping"
DEFAULT_LIMIT = 10
DEFAULT_RESULT_COUNT = 20
MAX_STYLE_LENGTH = 200
MAX_BACKPLAN_ATTEMPTS = 8
BLOCKED_DOMAINS = {
    "pinterest.com",
    "instagram.com",
    "facebook.com",
    "tiktok.com",
    "x.com",
    "twitter.com",
    "youtube.com",
}
NON_STORE_DOMAINS = {
    "reddit.com",
    "quora.com",
    "wikipedia.org",
    "medium.com",
    "blogspot.com",
    "wordpress.com",
    "tumblr.com",
}
BACKPLAN_QUERY_SUFFIXES = (
    "clothing product page buy",
    "fashion product buy online",
    "store product detail page",
    "buy now add to cart",
)

# Marker variables to be filled later.
PROMPT = ""
URL = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Find a specific clothing product URL from a style description."
    )
    parser.add_argument(
        "style",
        nargs="?",
        help='Style description, e.g. "minimalist monochrome streetwear"',
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Maximum number of results to collect before selecting output URL (default: {DEFAULT_LIMIT})",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON output.",
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=MAX_BACKPLAN_ATTEMPTS,
        help=f"Maximum number of backplan attempts (default: {MAX_BACKPLAN_ATTEMPTS})",
    )
    return parser.parse_args()


def normalize_style(style: str) -> str:
    normalized = " ".join(style.strip().split())
    if len(normalized) > MAX_STYLE_LENGTH:
        raise ValueError(f"style description is too long (max {MAX_STYLE_LENGTH} characters)")
    return normalized


def build_query(style: str) -> str:
    normalized = normalize_style(style)
    return f"{normalized} clothing outfit online store buy"


def search_serper(
    query: str,
    api_key: str,
    num_results: int = DEFAULT_RESULT_COUNT,
    endpoint: str = SERPER_API_URL,
) -> dict:
    import requests  # lazy import keeps --help working without deps installed

    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
    payload = {"q": query, "num": num_results}

    for attempt in range(3):
        try:
            response = requests.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=20,
            )
        except requests.Timeout as exc:
            if attempt < 2:
                time.sleep(attempt + 1)
                continue
            raise RuntimeError("Serper request timed out after retries.") from exc
        except requests.ConnectionError as exc:
            if attempt < 2:
                time.sleep(attempt + 1)
                continue
            raise RuntimeError("Network connection error while contacting Serper.") from exc
        except requests.RequestException as exc:
            raise RuntimeError(f"Serper request failed: {exc}") from exc

        if response.status_code == 429:
            raise RuntimeError("Serper quota exceeded (HTTP 429).")
        if 500 <= response.status_code < 600:
            if attempt < 2:
                time.sleep(attempt + 1)
                continue
            raise RuntimeError(f"Serper service unavailable (HTTP {response.status_code}).")

        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise RuntimeError(f"Serper request failed (HTTP {response.status_code}).") from exc

        try:
            return response.json()
        except ValueError as exc:
            raise RuntimeError("Serper response was not valid JSON.") from exc

    raise RuntimeError("Unable to fetch search results from Serper.")


def domain_from_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed.netloc.lower().replace("www.", "", 1)


def is_blocked_domain(url: str) -> bool:
    domain = domain_from_url(url)
    return any(domain == blocked or domain.endswith(f".{blocked}") for blocked in BLOCKED_DOMAINS)


def is_non_store_domain(url: str) -> bool:
    domain = domain_from_url(url)
    return any(domain == blocked or domain.endswith(f".{blocked}") for blocked in NON_STORE_DOMAINS)


def is_google_redirect_url(url: str) -> bool:
    parsed = urlparse(url)
    domain = domain_from_url(url)
    return domain.endswith("google.com") and parsed.path.startswith("/search")


def extract_results(payload: dict) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    for item in payload.get("organic", []):
        link = item.get("link")
        if not isinstance(link, str) or not link.startswith(("http://", "https://")):
            continue
        if is_blocked_domain(link):
            continue
        if is_non_store_domain(link):
            continue
        if is_google_redirect_url(link):
            continue

        title = item.get("title") if isinstance(item.get("title"), str) else "Untitled result"
        snippet = item.get("snippet") if isinstance(item.get("snippet"), str) else ""
        results.append({"title": title.strip(), "url": link.strip(), "snippet": snippet.strip()})

    seen: set[str] = set()
    deduped: list[dict[str, str]] = []
    for result in results:
        url = result["url"]
        if url not in seen:
            seen.add(url)
            deduped.append(result)
    return deduped


def extract_shopping_results(payload: dict) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    for item in payload.get("shopping", []):
        link = item.get("link")
        if not isinstance(link, str) or not link.startswith(("http://", "https://")):
            continue
        if is_blocked_domain(link):
            continue
        if is_non_store_domain(link):
            continue
        if is_google_redirect_url(link):
            continue

        title = item.get("title") if isinstance(item.get("title"), str) else "Untitled result"
        snippet = item.get("snippet") if isinstance(item.get("snippet"), str) else ""
        results.append({"title": title.strip(), "url": link.strip(), "snippet": snippet.strip()})

    seen: set[str] = set()
    deduped: list[dict[str, str]] = []
    for result in results:
        url = result["url"]
        if url not in seen:
            seen.add(url)
            deduped.append(result)
    return deduped


def resolve_shopping_to_product_url(
    shopping_payload: dict, serper_api_key: str, limit: int, google_api_key: str = ""
) -> tuple[str, list[dict[str, str]]]:
    for item in shopping_payload.get("shopping", [])[:5]:
        title = item.get("title")
        source = item.get("source")
        if not isinstance(title, str) or not title.strip():
            continue

        query_parts = [title.strip()]
        if isinstance(source, str) and source.strip():
            query_parts.append(source.strip())
        query_parts.append("buy")
        query = " ".join(query_parts)

        try:
            payload = search_serper(query, serper_api_key, num_results=max(limit, 10))
        except Exception:
            continue

        results = extract_results(payload)
        output_url = select_output_url(results, google_api_key)
        if output_url:
            return output_url, results

    return "", []


def prompt_if_missing(style: str | None) -> str:
    if style:
        return style.strip()
    if not sys.stdin.isatty():
        return ""
    return input("Describe the style to match: ").strip()


def resolve_style_input(cli_style: str | None) -> str:
    candidate = cli_style
    if not candidate and PROMPT:
        candidate = PROMPT
    return prompt_if_missing(candidate)


def validate_limit(limit: int) -> int:
    if limit <= 0:
        raise ValueError("--limit must be > 0")
    return limit


def validate_max_attempts(max_attempts: int) -> int:
    if max_attempts <= 0:
        raise ValueError("--max-attempts must be > 0")
    return max_attempts


def is_likely_product_url(url: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path.lower().strip("/")
    query = parsed.query.lower()

    if not path:
        return False

    product_path_markers = (
        "/product/",
        "/products/",
        "/item/",
        "/dp/",
        "/p/",
    )
    if any(marker in parsed.path.lower() for marker in product_path_markers):
        return True

    if any(token in query for token in ("product", "sku=", "pid=", "variant=", "item=")):
        return True

    non_product_path_markers = (
        "/collections/",
        "/collection/",
        "/category/",
        "/categories/",
        "/search",
        "/shop",
    )
    if any(marker in parsed.path.lower() for marker in non_product_path_markers):
        return False

    segments = [segment for segment in path.split("/") if segment]
    if len(segments) >= 2 and any(char.isdigit() for char in path):
        return True

    return False


def select_output_url(results: Iterable[dict[str, str]], google_api_key: str = "") -> str:
    global URL
    result_list = list(results)
    if not result_list:
        URL = ""
        return URL

    # Use AI call to select URL if API key is provided
    if google_api_key:
        import requests
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={google_api_key}"
        prompt = "You are a shopping assistant. I have a list of search results. Return ONLY the best product URL to buy the clothing item described in the snippets. Return the raw URL string, nothing else. Do not use markdown formatting. Results:\n"
        for r in result_list:
            prompt += f"URL: {r['url']} | Title: {r['title']} | Snippet: {r['snippet']}\n"
        payload = {"contents": [{"parts": [{"text": prompt}]}]}
        try:
            response = requests.post(api_url, json=payload, timeout=10)
            data = response.json()
            if "candidates" in data and len(data["candidates"]) > 0:
                text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                if text.startswith("http"):
                    URL = text
                    return URL
        except Exception:
            pass

    # Fallback to heuristics
    for result in result_list:
        if is_likely_product_url(result["url"]):
            URL = result["url"]
            return URL

    URL = ""
    return URL


def build_backplan(style: str, max_attempts: int) -> list[tuple[str, str]]:
    plan: list[tuple[str, str]] = [(SERPER_API_URL, build_query(style))]
    for suffix in BACKPLAN_QUERY_SUFFIXES:
        plan.append((SERPER_API_URL, f"{style} {suffix}"))
    plan.append((SERPER_SHOPPING_API_URL, f"{style} clothing"))
    return plan[:max_attempts]


def find_product_url_with_backplan(
    style: str, serper_api_key: str, limit: int, max_attempts: int, google_api_key: str = ""
) -> tuple[str, list[dict[str, str]], int, list[str]]:
    attempts = 0
    errors: list[str] = []
    latest_results: list[dict[str, str]] = []

    for endpoint, query in build_backplan(style, max_attempts):
        attempts += 1
        try:
            payload = search_serper(
                query,
                serper_api_key,
                num_results=max(limit + 10, DEFAULT_RESULT_COUNT),
                endpoint=endpoint,
            )
        except Exception as exc:
            errors.append(f"attempt {attempts}: {exc}")
            continue

        if endpoint == SERPER_SHOPPING_API_URL:
            attempt_results = extract_shopping_results(payload)
        else:
            attempt_results = extract_results(payload)

        if attempt_results:
            latest_results = attempt_results

        output_url = select_output_url(attempt_results, google_api_key)
        if output_url:
            return output_url, latest_results, attempts, errors

        if endpoint == SERPER_SHOPPING_API_URL:
            resolved_url, resolved_results = resolve_shopping_to_product_url(payload, serper_api_key, limit, google_api_key)
            if resolved_results:
                latest_results = resolved_results
            if resolved_url:
                return resolved_url, latest_results, attempts, errors

    return "", latest_results, attempts, errors


def print_json(
    prompt: str, url: str, results: list[dict[str, str]], limit: int, attempts: int, errors: list[str]
) -> None:
    payload = {
        "prompt": prompt,
        "url": url,
        "attempts": attempts,
        "errors": errors,
        "results": results[:limit],
    }
    print(json.dumps(payload, indent=2))


def main() -> int:
    global URL
    URL = ""
    args = parse_args()

    try:
        limit = validate_limit(args.limit)
        max_attempts = validate_max_attempts(args.max_attempts)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    style_input = resolve_style_input(args.style)
    try:
        style = normalize_style(style_input)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    if not style:
        print(
            "Error: style description is required. Pass it as an argument or set PROMPT.",
            file=sys.stderr,
        )
        return 2

    from dotenv import load_dotenv  # lazy import keeps --help working without deps installed

    dotenv_path = Path(__file__).resolve().parent / ".env"
    load_dotenv(dotenv_path=dotenv_path, override=False)

    serper_api_key = os.getenv("serper_API")
    google_api_key = os.getenv("GOOGLE_API_KEY", "")
    if not serper_api_key:
        print(
            "Error: serper_API is not set. Add it to style-finder/.env.",
            file=sys.stderr,
        )
        return 2

    output_url, results, attempts, errors = find_product_url_with_backplan(
        style, serper_api_key, limit, max_attempts, google_api_key
    )

    if args.json:
        print_json(style, output_url, results, limit, attempts, errors)
    else:
        print(output_url if output_url else "No specific product URL found after backplan retries.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
