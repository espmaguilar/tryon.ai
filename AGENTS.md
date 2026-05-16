# AGENTS.md

This file provides guidance to agents (i.e., ADAL) when working with code in this repository.

## Repository Scope (important)

- The actual app code lives in `try-on-react/`.
- Repository root currently acts as a container; most engineering commands must run from `try-on-react/`.
- If a command fails at root, retry with:
  ```bash
  cd try-on-react
  ```

---

## Quick Start (under 30 seconds)

```bash
cd try-on-react
npm install
npm run dev
```

Open the local Vite URL shown in terminal (typically `http://localhost:5173`).

---

## Essential Commands

Run all commands from `try-on-react/` unless explicitly noted.

### Install dependencies
```bash
npm install
```
- Uses `package-lock.json` (npm, not pnpm/yarn).

### Development server
```bash
npm run dev
```
- Starts Vite dev server with HMR.

### Production build
```bash
npm run build
```
- Outputs static assets to `try-on-react/dist/`.

### Preview production build
```bash
npm run preview
```
- Serves built output locally for smoke testing.

### Lint
```bash
npm run lint
```
- Uses ESLint with React hooks/react-refresh rules configured in `eslint.config.js`.

---

## Testing Status / Single-Test Guidance

- No dedicated test script/framework was found in current `package.json`.
- There is no built-in “run one test file” command yet.
- If tests are introduced later (Vitest/Jest), add exact commands here immediately.

---

## Critical Gotchas

1. **Working directory trap**
   - Running `npm run dev/build/lint/preview` at repo root will fail (no root package scripts).
   - Use `try-on-react/`.

2. **Camera permission behavior**
   - App uses `navigator.mediaDevices.getUserMedia`.
   - Requires browser permission and secure context (`https://` or `localhost`).
   - Camera-related UI failures are often permission/environment issues, not React bugs.

3. **Resource cleanup matters**
   - Camera stream lifecycle is managed in `App.jsx`.
   - Changes to camera toggling must preserve stopping tracks on deactivation/unmount to avoid camera lock and LED staying on.

4. **Modern toolchain assumptions**
   - Vite 8 + React 19 stack expects modern Node runtime.
   - If install/build errors appear, check Node version first.

5. **No backend contract in repo (current state)**
   - Data shown for closet/recommendations is mock/static in frontend component state.
   - Don’t assume API shape exists unless you add one.

---

## Non-Obvious Architecture (cross-file flow)

## Boot flow (runtime entry chain)

1. `try-on-react/index.html`
   - Provides root mount element and loads app entry script.
2. `try-on-react/src/main.jsx`
   - Initializes React and renders `<App />`.
3. `try-on-react/src/App.jsx`
   - Contains primary Smart Mirror UI, interaction logic, and camera stream handling.

This is a mostly single-feature frontend app; behavior concentration is in `App.jsx`.

## State and UI control flow (in `App.jsx`)

- Core UI state includes:
  - active tab/view selection
  - selected closet item
  - camera active/inactive state
- User action → state update → conditional rendering in same component.
- There is no global store (Redux/Zustand/etc.) at this stage.

## Camera lifecycle flow

Typical flow implemented in app logic:

1. User toggles camera on.
2. App requests webcam stream via `getUserMedia`.
3. Stream assigned to video element via `videoRef`.
4. User toggles off (or component cleanup path).
5. App stops media tracks and releases stream.

When editing this logic, preserve both success and failure branches:
- permission denied
- no device available
- stream cleanup on state transitions

## Data flow (current)

- Closet and recommendation data are local constants in `App.jsx`.
- Selection/filter decisions happen client-side in component state.
- No network request pipeline is currently required for main UX.

---

## Domain-Specific Notes (project language + product intent)

- Product terminology used in code/docs includes:
  - **Smart Mirror**
  - **Fitment**
- UI and logic are oriented to virtual try-on workflow:
  - camera-driven preview
  - closet item selection
  - recommendation display
- Preserve domain wording unless product copy updates are intentional.

---

## Key Entry Points & Files to Know

## Main app entry points
- `try-on-react/src/main.jsx` — React mount/bootstrap.
- `try-on-react/src/App.jsx` — primary feature logic and UI.

## Build/tooling config
- `try-on-react/package.json` — scripts + dependency contract.
- `try-on-react/vite.config.js` — Vite config.
- `try-on-react/eslint.config.js` — lint rules.
- `try-on-react/index.html` — HTML shell.

## Documentation
- `README.md` (repo-level context)
- `try-on-react/README.md` (app-level setup/notes)

## Environment/config files
- No `.env*` files detected currently.
- If new env vars are introduced, document:
  - file location (`.env`, `.env.local`, etc.)
  - required keys
  - safe defaults/fallback behavior

---

## Change Planning Heuristics for AdaL (repo-specific)

Use these to minimize regressions in the current architecture:

1. **UI-only change likely == `App.jsx` + CSS**
   - Most feature requests route through these files.
2. **Script/CI/tooling change == `package.json` + config files**
   - Keep commands consistent with Vite defaults unless intentionally changing workflow.
3. **Camera bugs**
   - Inspect stream acquisition and cleanup paths first.
   - Reproduce with browser permission reset before deeper refactors.
4. **Performance concerns**
   - This app is currently simple; avoid introducing heavy state libraries unless justified by feature scope.

---

## Known Gaps (as of current repo state)

- No test harness configured.
- No backend/API integration in main flow.
- No monorepo workspace orchestration despite top-level wrapper directory.
- No explicit git hook enforcement files discovered in referenced analysis.

If any of the above changes, update this file in the same PR.

---

## Fast Navigation Map (where to look first)

- “Why app won’t start?” → `try-on-react/package.json`, then `vite.config.js`
- “Why camera not working?” → `try-on-react/src/App.jsx` camera toggle/request logic
- “Where does app mount?” → `try-on-react/src/main.jsx`
- “Why lint failing?” → `try-on-react/eslint.config.js` + changed JSX file
- “What is rendered first?” → `index.html` → `main.jsx` → `App.jsx`

---

## Source Files Used to Build This Guide

- `README.md`
- `try-on-react/README.md`
- `try-on-react/package.json`
- `try-on-react/src/App.jsx`
- `try-on-react/src/main.jsx`
- `try-on-react/vite.config.js`
- `try-on-react/index.html`
