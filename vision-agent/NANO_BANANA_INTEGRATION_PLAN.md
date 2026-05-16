# Nano Banana Virtual Try-On Integration Plan

Date: 2026-05-16  
POC: AdaL  
TL;DR: Add a custom `NanoBananaProcessor` to the existing `vision-agents` processor pipeline, trigger try-on generation in snapshot mode (not every frame), and emit result events to the frontend for low-latency UX.

## Current Baseline (confirmed)
- Existing real-time agent entrypoint: `main.py`
- Existing processors:
  - `ultralytics.YOLOPoseProcessor`
  - optional `decart.RestylingProcessor`
- LLM tool wiring via `@llm.register_function(...)`
- GetStream runtime is already configured through `getstream.Edge()` and call join flow.

## Why this approach
Generating a full try-on image on every frame will be too slow and expensive.  
The safest MVP is:
1. Keep live webcam/video stream real-time.
2. Trigger try-on from selected frames (voice/tool/button event).
3. Emit generated try-on result as event payload and let frontend render preview.

This minimizes regression risk in the existing stream loop and keeps architecture aligned with current code.

## Proposed Changes (minimal blast radius)

### 1) New file: `nano_banana.py`
Create a dedicated processor-like service class to manage:
- merchandise image state
- latest frame cache
- try-on generation trigger
- event payload creation

Planned class:
- `class NanoBananaProcessor:`
  - `__init__(...)`
  - `async set_merchandise(image_path_or_url: str) -> str`
  - `async capture_frame(frame) -> None`
  - `async generate_tryon() -> dict`

Behavior:
- `capture_frame` stores latest frame reference (or serialized image bytes path)
- `generate_tryon` calls image model using:
  - input frame (customer)
  - merchandise image (blank background or on-model)
- returns metadata:
  - `job_id`, `image_url` or local path, `latency_ms`, `status`

### 2) Modify `main.py`
Add Nano Banana wiring while preserving existing processors:
- initialize `nano_processor = NanoBananaProcessor(...)`
- append lightweight frame-capture processor wrapper so latest frame is always available
- register LLM tools:
  - `set_merchandise(image_path_or_url: str)`  
  - `try_on_current_item()`  
- emit custom event after generation:
  - event: `mirror_update`
  - payload: `{job_id, image_url, latency_ms, status}`

### 3) Environment variables (`.env` usage only, no hardcoded secrets)
Expected keys:
- `NANO_BANANA_API_KEY` (required for real model calls)
- optional:
  - `NANO_BANANA_MODEL` (default model id)
  - `TRYON_OUTPUT_DIR` (default `./outputs`)

### 4) Optional fallback mode (for local testing)
If Nano Banana key is missing:
- return deterministic mock output payload
- keep event path functional for frontend integration testing

## Alternatives considered
1. **Per-frame generation**
   - Rejected: high latency + cost, breaks real-time expectations.
2. **Replacing full stream with generated frames**
   - Rejected for MVP: risky with unknown plugin/frame API details.
3. **Pure backend REST polling**
   - Rejected: worse UX than custom event push; current architecture supports event-driven flow.

## Risks & Mitigations
1. Processor API mismatch (framework internals not fully visible)
   - Mitigation: isolate logic in `nano_banana.py`, keep `main.py` glue minimal.
2. Latency spikes from model inference
   - Mitigation: snapshot trigger mode, one in-flight job limit per call/user.
3. Merch image quality variability (flat lay vs on-model)
   - Mitigation: prompt guidance + optional preprocessing step later.

## Test Plan
1. Start agent and join call.
2. Verify stream still works with existing YOLO processor.
3. Call LLM function to set merchandise.
4. Trigger try-on generation.
5. Verify `mirror_update` event payload shape and frontend receipt.
6. Validate fallback mode when API key is absent.

## Exact Diff Scope
- `main.py` (modify)
- `nano_banana.py` (new)
- potentially `README.md` (small setup section update only)

No changes to unrelated project files.
