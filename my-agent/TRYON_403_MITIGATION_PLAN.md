# Try-On 403 Mitigation Plan

Date: 2026-05-16  
POC: AdaL + Jonas  
TL;DR: We have two independent failure paths right now: (1) source image fetch returns HTTP 403, and (2) Google model calls fail due to quota/permissions (`429 RESOURCE_EXHAUSTED`, and potentially 403 permission errors). We should add explicit error classification, input preflight checks, and graceful fallbacks so runtime errors are actionable.

---

## 1) Current Findings (Confirmed)

1. `my-agent/.env` is loading correctly and `GOOGLE_API_KEY` is present.
2. Test image URLs returned `HTTP 403 Forbidden` during fetch.
3. Model invocation returned `429 RESOURCE_EXHAUSTED` with free-tier quota at `0` for image model.
4. Current code collapses many failures into generic:
   - `reason: "tryon_generation_failed"`
   - message contains raw exception text.

Impact: Hard to tell if failure is input fetch vs model permission/quota vs unsupported model.

---

## 2) Goals

1. Distinguish and surface **root-cause-specific** errors.
2. Prevent avoidable model calls when inputs are inaccessible.
3. Make runtime behavior resilient while billing/quota is being fixed.
4. Keep changes minimal and scoped to `my-agent/nano_banana.py` (and optional docs).

---

## 3) Proposed Changes (Minimal Blast Radius)

### A. Add explicit input preflight validation
Before `generate_content`:
- Validate pose image source can be read.
- Validate garment image source can be read.
- For URL failures, return structured error:
  - `reason: "pose_image_fetch_failed"` or `"merchandise_image_fetch_failed"`
  - include status hint (`403`, `404`, timeout, DNS, etc.) in message.

Why: avoids opaque model-layer errors when inputs are unreachable.

### B. Classify Google API failures
Wrap model call exception handling and map to specific reasons:
- 429 / `RESOURCE_EXHAUSTED` -> `reason: "model_quota_exhausted"`
- 403 / permission denied -> `reason: "model_access_forbidden"`
- invalid model / bad argument -> `reason: "invalid_model_or_request"`
- fallback -> `reason: "tryon_generation_failed"`

Why: gives immediate operator action path (billing, model access, config).

### C. Optional local-path-first guidance
If URL fetch fails, suggest using local file paths in returned message:
- “Source URL blocked (403). Use local file path or hosted URL with public access.”

Why: fast unblock during development.

### D. Keep existing contract stable
Do not change successful response shape.
Error responses remain:
- `status`, `reason`, `message`, plus existing `job_id`, `latency_ms`.

Why: preserve compatibility with caller/UI.

---

## 4) Risk & Trade-Offs

1. **Risk: Overfitting to exception string parsing**
   - Mitigation: check structured attributes when available, fallback to safe string checks.
2. **Risk: Too much verbose internal detail in user-facing messages**
   - Mitigation: concise message + actionable next step.
3. **Risk: Regression in happy path**
   - Mitigation: no changes to generation prompt/flow beyond guarded error handling.

---

## 5) Test Plan

### Unit-ish/functional checks (script-level)
1. Missing key -> `missing_api_key` (existing behavior preserved).
2. Pose URL 403 -> `pose_image_fetch_failed`.
3. Garment URL 403 -> `merchandise_image_fetch_failed`.
4. Quota exhausted (429) -> `model_quota_exhausted`.
5. Permission denied (403 from model) -> `model_access_forbidden`.
6. Happy path with valid local files + available quota -> `success` and image written.

### Regression checks
- `main.py` CLI still starts with `uv run python main.py --help`.
- `try_on_current_item()` still returns status/job/image fields.

---

## 6) Implementation Sequence (Small, Safe Steps)

1. Add helper to normalize fetch exceptions into reason/message.
2. Add helper to classify model/API exceptions.
3. Update `_run_tryon()` with staged try/except:
   - fetch pose
   - fetch garment
   - model call
4. Run targeted script checks for each failure mode.
5. Update doc snippet in `my-agent` readme/notes (optional).

---

## 7) Out of Scope (for now)

- Retries/backoff queue system.
- Caching downloaded images.
- Switching providers/models automatically.
- UI redesign for error banners.

---

## 8) Ready-to-Implement Diff Scope

Primary file:
- `my-agent/nano_banana.py`

Optional docs:
- `my-agent/README.md` (if we add troubleshooting section)

Expected diff size: small-to-medium, isolated to error handling paths.
