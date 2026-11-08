# prelegal — Mutual NDA Creator (frontend)

A Next.js app for creating a [Common Paper Mutual NDA](https://commonpaper.com/standards/mutual-nda/1.0) (PL-3).
The user fills in the key terms and both parties' details, sees the completed agreement update live, and
downloads it as a PDF.

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
The e2e suite (`e2e/`) builds and serves the app itself. It covers the live preview, term options,
the years input, keyboard navigation of the radio groups, console errors and the PDF download.

## How it works

```
templates/Mutual-NDA.md ──(build time)──▶ parseStandardTerms ─┐
                                                              ▼
form state (NdaFormData) ─────────────────▶ buildNdaDocument ──▶ Block[] ──┬─▶ DocumentPreview (HTML)
                                                                           └─▶ NdaPdf (@react-pdf, on download)
```

- **`src/lib/nda/`**: framework-agnostic core.
  - `loadStandardTerms` reads the Standard Terms from the repo's `templates/` dataset at build time, so the
    app renders exactly the catalogued text.
  - `buildNdaDocument` fills in the Cover Page (following `templates/Mutual-NDA-coverpage.md`) and appends
    the Standard Terms, producing a renderer-agnostic `Block[]` model. Blank fields become highlighted
    `[placeholders]`.
- **`src/components/`**: `NdaBuilder` holds the form state and wires `NdaForm`, `DocumentPreview` and the
  PDF download. `NdaPdf` (and `@react-pdf/renderer`) are loaded only when the user clicks *Download PDF*.

The app reads `../templates`, so it must be built from within this repository.
