# prelegal — Mutual NDA Creator (frontend)

A Next.js app for creating a [Common Paper Mutual NDA](https://commonpaper.com/standards/mutual-nda/1.0).
The user chats with an AI assistant (PL-5), which asks about the parties and key terms and fills in the
agreement as they answer. The completed agreement updates live and can be downloaded as a PDF.

## Getting started

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```

| Script          | Purpose                                  |
| --------------- | ---------------------------------------- |
| `npm run dev`   | Start the development server             |
| `npm run build` | Production build (page is fully static)  |
| `npm test`      | Unit tests (Vitest), incl. PDF rendering |
| `npm run test:e2e` | End-to-end tests (Playwright) against the production build |
| `npm run lint`  | ESLint                                   |

Before the first e2e run, install the browser once with `npx playwright install chromium`.
The e2e suite (`e2e/`) builds and serves the app itself and mocks `/api/chat` in the browser, so it needs
neither the backend nor an API key. It covers the greeting, chat updates filling the preview, the request
payload, Enter/Shift+Enter, error recovery, console errors and the PDF download.

## How it works

```
templates/Mutual-NDA.md ──(build time)──▶ parseStandardTerms ─┐
                                                              ▼
form state (NdaFormData) ─────────────────▶ buildNdaDocument ──▶ Block[] ──┬─▶ DocumentPreview (HTML)
    ▲                                                                      └─▶ NdaPdf (@react-pdf, on download)
    └── applyUpdates ◀── NdaChat ◀──POST /api/chat──▶ backend ──▶ LLM (OpenRouter)
```

- **`src/lib/nda/`**: framework-agnostic core.
  - `loadStandardTerms` reads the Standard Terms from the repo's `templates/` dataset at build time, so the
    app renders exactly the catalogued text.
  - `applyUpdates` merges the assistant's field updates into the form state.
  - `buildNdaDocument` fills in the Cover Page (following `templates/Mutual-NDA-coverpage.md`) and appends
    the Standard Terms, producing a renderer-agnostic `Block[]` model. Blank fields become highlighted
    `[placeholders]`.
- **`src/components/`**: `NdaBuilder` holds the form state and wires `NdaChat`, `DocumentPreview` and the
  PDF download. `NdaChat` keeps the conversation in page state (a refresh starts over) and sends the whole
  conversation, the current fields and the user's local date with each turn. `NdaPdf` (and `@react-pdf/renderer`) are loaded only when the user clicks *Download PDF*.

The app reads `../templates`, so it must be built from within this repository.

## Backend API

`next.config.ts` rewrites `/api/*` to the FastAPI backend (`BACKEND_URL`, default `http://127.0.0.1:8000`).
`src/lib/api.ts` is the typed client for it. The chat needs the backend running with `OPENROUTER_API_KEY`
set. Without them, the preview and PDF download still work but sending a message shows an error. Use
`scripts/start.sh` at the repo root to run both.
