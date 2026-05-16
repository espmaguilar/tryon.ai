import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse


SERPER_API_URL = "https://google.serper.dev/search"
DEFAULT_LIMIT = 10
DEFAULT_RESULT_COUNT = 20
MAX_STYLE_LENGTH = 200
BLOCKED_DOMAINS = {
    "pinterest.com",
    "instagram.com",
    "facebook.com",
    "tiktok.com",
    "x.com",
    "twitter.com",
    "youtube.com",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Find similar clothing product URLs from a style description."
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
        help=f"Maximum number of results to print (default: {DEFAULT_LIMIT})",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON output instead of text output.",
    )
    parser.add_argument(
        "--show-snippet",
        action="store_true",
        help="Include snippets in text output.",
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


def search_serper(query: str, api_key: str, num_results: int = DEFAULT_RESULT_COUNT) -> dict:
    import requests  # lazy import keeps --help working without deps installed

    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
    payload = {"q": query, "num": num_results}

    for attempt in range(3):
        try:
            response = requests.post(
                SERPER_API_URL,
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


def extract_results(payload: dict) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    for item in payload.get("organic", []):
        link = item.get("link")
        if not isinstance(link, str) or not link.startswith(("http://", "https://")):
            continue
        if is_blocked_domain(link):
            continue

        title = item.get("title") if isinstance(item.get("title"), str) else "Untitled result"
        snippet = item.get("snippet") if isinstance(item.get("snippet"), str) else ""
        results.append({"title": title.strip(), "url": link.strip(), "snippet": snippet.strip()})

    # Stable dedupe by URL
    seen: set[str] = set()
    deduped: list[dict[str, str]] = []
    for result in results:
        url = result["url"]
        if url not in seen:
            seen.add(url)
            deduped.append(result)
    return deduped


def prompt_if_missing(style: str | None) -> str:
    if style:
        return style.strip()
    if not sys.stdin.isatty():
        return ""
    return input("Describe the style to match: ").strip()


def validate_limit(limit: int) -> int:
    if limit <= 0:
        raise ValueError("--limit must be > 0")
    return limit


def print_text(results: Iterable[dict[str, str]], limit: int, show_snippet: bool) -> None:
    for idx, result in enumerate(results, start=1):
        if idx > limit:
            break
        print(f"{idx}. {result['title']}")
        print(f"   {result['url']}")
        if show_snippet and result["snippet"]:
            print(f"   {result['snippet']}")
        print()


def print_json(results: list[dict[str, str]], limit: int) -> None:
    print(json.dumps(results[:limit], indent=2))


def main() -> int:
    args = parse_args()

    try:
        limit = validate_limit(args.limit)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    style_input = prompt_if_missing(args.style)
    try:
        style = normalize_style(style_input)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    if not style:
        print(
            "Error: style description is required. Pass it as an argument in non-interactive mode.",
            file=sys.stderr,
        )
        return 2

    from dotenv import load_dotenv  # lazy import keeps --help working without deps installed

    dotenv_path = Path(__file__).resolve().parent / ".env"
    load_dotenv(dotenv_path=dotenv_path, override=False)

    api_key = os.getenv("SERPER_API_KEY")
    if not api_key:
        print(
            "Error: SERPER_API_KEY is not set. Copy .env.example to .env and add your key.",
            file=sys.stderr,
        )
        return 2

    query = build_query(style)

    try:
        payload = search_serper(query, api_key)
        results = extract_results(payload)
    except Exception as exc:
        print(f"Error fetching search results: {exc}", file=sys.stderr)
        return 1

    if not results:
        print("No similar clothing links found after filtering.")
        return 0

    if args.json:
        print_json(results, limit)
    else:
        print_text(results, limit, args.show_snippet)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
