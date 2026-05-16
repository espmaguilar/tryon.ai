# Style Finder Agent

AI workflow: take a style prompt, search web stores, and output one URL for a matching item.

## Marker variables

Edit these top-level variables in `main.py` (they are placeholders for later-provided values):

- `PROMPT` → style prompt marker
- `URL` → output URL marker (updated with the selected result)

## Setup

```bash
cd style-finder
printf "SERPER_API_KEY=your_serper_api_key_here\n" > .env
```

Install dependencies:

```bash
# with uv
uv sync

# or pip
python3 -m pip install -e .
```

## Run

CLI prompt input:

```bash
cd style-finder
uv run python main.py "minimalist monochrome streetwear"
```

Marker prompt input (set `PROMPT` in `main.py`, then run without CLI style):

```bash
uv run python main.py
```

JSON output:

```bash
uv run python main.py "techwear monochrome" --json --limit 5 --max-attempts 10
```

## Output behavior

- Default output: prints **one URL only** (best first match)
- Also writes selected URL into `URL` marker variable in process memory
- `--json` output includes:
  - `prompt`
  - `url`
  - `attempts`
  - `errors`
  - `results` (top filtered candidates)
- Use `--max-attempts` to control how many backplan retries are allowed.

## Notes

- Social/aggregation domains (Pinterest/Instagram/TikTok/Facebook/X/YouTube) are filtered out.
- Serper API key is required via `SERPER_API_KEY`.

## Quick tests

```bash
cd style-finder
python3 -m unittest discover -s tests -p "test_*.py" -q
```
