# prelegal — Legal Document Creator (frontend)

A Next.js app for creating Common Paper standard agreements (11 document types, see
`../document-types.json`). The user chats with an AI assistant (PL-5, PL-6). The assistant works out which
document they need, suggests the closest one when a request isn't supported, then asks about the parties and
key terms and fills in the document as they answer. The completed document updates live and can be
downloaded as a PDF.

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
neither the backend nor an API key. It covers the greeting and document picker, selecting a document,
unsupported requests, switching documents, Enter/Shift+Enter, error recovery, console errors and the PDF
download.

## How it works

```
document-types.json + templates/*.md ──(build time)──▶ loadLibrary ──▶ DocumentType[] (fields, parties, parsed terms)
                                                                              │
draft (Draft) ──────────────────────────────────────────▶ buildDocument ◀─────┘──▶ Block[] ──┬─▶ DocumentPreview (HTML)
    ▲                                                                                        └─▶ DocumentPdf (@react-pdf, on download)
    └── applyChanges ◀── useDocumentChat ◀──POST /api/chat──▶ backend ──▶ LLM (OpenRouter)
```

- **`src/lib/documents/`**: framework-agnostic core.
  - `loadLibrary` reads `document-types.json` and parses each document's Standard Terms from `templates/`
    at build time, so the app renders exactly the catalogued text.
  - `parseStandardTerms` handles the Common Paper markdown: nested numbered clauses (`1.`, `1.1`, `(a)`),
    section-title spans, term references (`coverpage_link`, `keyterms_link`, …), anchor spans and links.
  - `buildDocument` produces a generic Cover Page (intro, one entry per field, signature block labelled with
    the document's party roles), then appends the Standard Terms. The result is a renderer-agnostic
    `Block[]` model, and blank fields become highlighted `[placeholders]`.
  - `applyChanges` applies an assistant turn. Selecting a different document resets the fields to that
    document's defaults but keeps both parties.
- **`src/lib/useDocumentChat.ts`**: conversation state. It sends the whole conversation, the current draft
  and the user's local date with each turn. It is kept in page state only, so a refresh starts over.
- **`src/components/`**: `DocumentBuilder` holds the draft and wires `DocumentChat`, `DocumentPicker`
  (shown until a document is chosen, where each entry sends "I'd like to create a …" to the chat),
  `DocumentPreview` and the PDF download. `DocumentPdf` (and `@react-pdf/renderer`) are loaded only when
  the user clicks *Download PDF*.

The app reads `../document-types.json` and `../templates`, so it must be built from within this repository.

## Backend API

`next.config.ts` rewrites `/api/*` to the FastAPI backend (`BACKEND_URL`, default `http://127.0.0.1:8000`).
`src/lib/api.ts` is the typed client for it. The chat needs the backend running with `OPENROUTER_API_KEY`
set. Use `scripts/start.sh` at the repo root to run both.
