# Style Finder Agent

CLI agent that takes a style description, searches for similar clothing online, and prints high-signal links (title + URL).

## Setup

```bash
cd style-finder
cp .env.example .env
# add your SERPER_API_KEY in .env
```

Install dependencies:

```bash
# with uv
uv sync

# or pip
python3 -m pip install -e .
```

## Run

```bash
cd style-finder
uv run python main.py "minimalist monochrome streetwear"
```

Interactive prompt mode:

```bash
uv run python main.py
```

Limit results:

```bash
uv run python main.py "boho summer dresses" --limit 5
```

Include snippets in text output:

```bash
uv run python main.py "90s grunge" --show-snippet
```

JSON output for automation:

```bash
uv run python main.py "techwear monochrome" --json --limit 5
```

## Output

- Default: numbered text output with `title` and `url`
- `--json`: machine-readable array of objects:
  - `title`
  - `url`
  - `snippet`

## Notes

- Social/aggregation domains (e.g., Pinterest/Instagram/TikTok/Facebook/X/YouTube) are filtered out.
- If no links survive filtering, the CLI prints a clear message.

## Quick tests

```bash
cd style-finder
python3 -m unittest discover -s tests -p "test_*.py" -q
```
