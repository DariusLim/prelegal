# prelegal — Legal Document Creator (frontend)

A Next.js app for creating Common Paper standard agreements (11 document types, see
`../document-types.json`). The user chats with an AI assistant (PL-5, PL-6). The assistant works out which
document they need, suggests the closest one when a request isn't supported, then asks about the parties and
key terms and fills in the document as they answer. The completed document updates live and can be
downloaded as a PDF. Users have accounts (PL-7): each one sees their own documents, which are saved after
every chat turn and can be resumed, renamed or deleted.

## Getting started

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```

| Script          | Purpose                                  |
| --------------- | ---------------------------------------- |
| `npm run dev`   | Start the development server             |
| `npm run build` | Production build (page and Standard Terms are static) |
| `npm test`      | Unit tests (Vitest), incl. PDF rendering |
| `npm run test:e2e` | End-to-end tests (Playwright) against the production build |
| `npm run lint`  | ESLint                                   |

Before the first e2e run, install the browser once with `npx playwright install chromium`.
The e2e suite (`e2e/`) builds and serves the app itself and mocks the backend's `/api/*` routes in the
browser (`e2e/mock-backend.ts`: accounts, documents and NDJSON chat streams), so it needs neither the backend
nor an API key. `document-creator.spec.ts` covers the greeting and document picker, selecting a document,
unsupported requests, switching documents, Enter/Shift+Enter, error recovery (including mid-stream errors),
autosaving, console errors and the PDF download; `accounts.spec.ts` covers signing up and in, resuming,
renaming and deleting documents, signing out, an expired session and the phone-width layout.

## How it works

```
document-types.json ──(build time)──▶ page: DocumentSpec[] (fields, parties)
templates/*.md ──(build time)──▶ /standard-terms/<id> (JSON Block[]) ──(fetched when a document is opened)──┐
                                                                                                          ▼
draft (Draft) ───────────────────────────────────────────────────────────────────────▶ buildDocument ──▶ Block[] ──┬─▶ DocumentPreview (HTML)
    ▲                                                                                                             └─▶ DocumentPdf (@react-pdf, on download)
    └── applyChanges ◀── useDocumentChat ◀──POST /api/chat (streamed)──▶ backend ──▶ LLM (OpenRouter)
                              │
                              └──▶ useAutosave ──POST/PATCH /api/documents──▶ backend (SQLite)
```

- **`src/lib/documents/`**: framework-agnostic core.
  - `loadLibrary` reads `document-types.json` (`loadDocumentSpecs`) and parses a document's Standard Terms
    from `templates/` (`loadStandardTerms`) at build time, so the app renders exactly the catalogued text.
  - `app/standard-terms/[id]/route.ts` prerenders each document's parsed Standard Terms as JSON, so the
    page only ships the document list; `useStandardTerms` fetches (and caches) the terms of the open
    document, and the PDF export waits for them.
  - `parseStandardTerms` handles the Common Paper markdown: nested numbered clauses (`1.`, `1.1`, `(a)`),
    section-title spans, term references (`coverpage_link`, `keyterms_link`, …), anchor spans and links.
  - `buildDocument` produces a generic Cover Page (intro, one entry per field, signature block labelled with
    the document's party roles), then appends the Standard Terms. The result is a renderer-agnostic
    `Block[]` model, and blank fields become highlighted `[placeholders]`.
  - `applyChanges` applies an assistant turn. Selecting a different document resets the fields to that
    document's defaults but keeps both parties. `documentTitle` names a document in the list.
- **`src/lib/useDocumentChat.ts`**: conversation state. It sends the whole conversation, the current draft
  and the user's local date with each turn, and shows the reply as it streams in.
- **`src/lib/useAutosave.ts`**: saves the draft and conversation after every turn. The first save creates
  the document, so blank documents are never stored; saves run one at a time and can be retried.
- **`src/lib/api.ts`**: typed client, including the NDJSON chat stream. A 401 outside the sign-in calls
  (an expired session) dispatches `prelegal:unauthorized`, which returns the app to the sign-in form.
- **`src/components/`**: `App` checks the session on load (the page itself is static) and shows `AuthForm`,
  `DocumentList` (the user's documents) or `DocumentBuilder` (one document). `DocumentBuilder` holds the
  draft and wires `DocumentChat`, `DocumentPicker` (shown until a document is chosen, where each entry
  sends "I'd like to create a …" to the chat), `DocumentPreview` and the PDF download. `DocumentPdf` (and
  `@react-pdf/renderer`) are loaded only when the user clicks *Download PDF*.

The app reads `../document-types.json` and `../templates`, so it must be built from within this repository.

## Backend API

`next.config.ts` rewrites `/api/*` to the FastAPI backend (`BACKEND_URL`, default `http://127.0.0.1:8000`).
`src/lib/api.ts` is the typed client for it. Signing in needs the backend; the chat also needs
`OPENROUTER_API_KEY`. Rewrites are resolved at build time, so set `BACKEND_URL` when running `next build`
for a production server. Use `scripts/start.sh` at the repo root to run both.
