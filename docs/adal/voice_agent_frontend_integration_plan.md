# Voice Agent ↔ Frontend Integration Plan
Date: 2026-05-16
POC: AdaL
TL;DR: Make both frontend and `voice-agent` join the same stable Stream call and add a minimal `voice_command` custom event bridge.

## What is broken today
1. `voice-agent/main.py` creates `call_id = f"voice-{int(time.time())}"`, so it changes every run.
2. Frontend does not get that dynamic call id, so it can’t reliably be in the same call.
3. `voice-agent` currently stores transcript to file but does not send a frontend-consumable custom event.

## Proposed minimal changes

### 1) `voice-agent/main.py`
- Replace dynamic call id with env-driven stable id:
  - `STREAM_CALL_TYPE` (default: `default`)
  - `STREAM_CALL_ID` (default: `tryon-mirror`)
- After transcript is ready, emit Stream custom event:
  - type: `voice_command`
  - payload: `{ transcript: <text> }`
- Keep existing save-to-file behavior unchanged.

Why:
- Smallest change that enables deterministic frontend-agent connection.
- Preserves current transcription flow and local persistence.

Risk:
- If env vars differ between frontend and agent, events still won’t connect.
Mitigation:
- Print effective `call_type` and `call_id` at startup.

### 2) `try-on-react/src/main.jsx`
- Initialize Stream client/call using env:
  - `STREAM_API_KEY`
  - `VITE_STREAM_USER_ID`, `VITE_STREAM_USER_TOKEN`
  - `STREAM_CALL_TYPE`, `STREAM_CALL_ID`
- Set `window.streamCall` so existing app event hooks keep working.

Why:
- Existing `App.jsx` already relies on `window.streamCall` and custom events.
- Keeps blast radius low (no large React context refactor).

Risk:
- Missing token/user env causes silent integration failure.
Mitigation:
- Clear startup warning + null-guarded usage.

### 3) `try-on-react/src/App.jsx`
- Extend existing `streamCustomHandler` to listen for `voice_command`.
- On receipt, store transcript in local state (e.g. `voiceTranscript`) and optionally display it (non-blocking UI).
- Do not alter existing camera/mirror controls.

Why:
- Needed to prove voice-agent is connected and delivering actionable events.
- Minimal UI impact.

Risk:
- None significant; event listener already exists for mirror events.

## Alternatives considered
1. Keep dynamic call id and pass it to frontend manually each run.
   - Rejected: operationally fragile.
2. Add backend orchestration service for session routing.
   - Rejected: too large for current request.

## Validation plan
1. Run `voice-agent` with `STREAM_CALL_TYPE=default`, `STREAM_CALL_ID=tryon-mirror`.
2. Run frontend with matching call type/id and valid Stream user token.
3. Confirm:
   - Both join same call.
   - transcript completion emits `voice_command`.
   - frontend receives and logs/renders transcript.
4. Run frontend checks:
   - `npm run lint`
   - `npm run build`

## Files to edit
- `voice-agent/main.py`
- `try-on-react/src/main.jsx`
- `try-on-react/src/App.jsx`

## Approval requested
If approved, I will apply exactly these minimal edits and run lint/build verification.
