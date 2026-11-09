"use client";

import { useMemo, useState } from "react";

import { DocumentChat } from "@/components/DocumentChat";
import { DocumentPicker } from "@/components/DocumentPicker";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { SavedDocument } from "@/lib/api";
import { applyChanges, buildDocument, createDraft, documentTitle, pdfFileName } from "@/lib/documents/buildDocument";
import type { Block, DocumentSpec, Draft } from "@/lib/documents/types";
import { fetchStandardTerms, useStandardTerms } from "@/lib/documents/useStandardTerms";
import { useAutosave, type SaveStatus } from "@/lib/useAutosave";
import { useDocumentChat } from "@/lib/useDocumentChat";
import { useToday } from "@/lib/useToday";

async function downloadPdf(blocks: Block[], title: string, fileName: string) {
  // Loaded on demand: @react-pdf/renderer is large and only needed on download.
  const [{ pdf }, { DocumentPdf }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/components/DocumentPdf"),
  ]);
  const blob = await pdf(<DocumentPdf blocks={blocks} title={title} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoke after the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SAVE_LABELS: Record<SaveStatus, string> = {
  unsaved: "Not saved yet",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn’t save.",
};

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  return (
    <span role="status" className={`text-xs ${status === "error" ? "text-red-700" : "text-stone-500"}`}>
      {SAVE_LABELS[status]}
      {status === "error" && (
        <button type="button" onClick={onRetry} className="ml-1 font-semibold underline">
          Retry
        </button>
      )}
    </span>
  );
}

interface DocumentBuilderProps {
  library: DocumentSpec[];
  /** The saved document to continue, or null for a new one. */
  saved: SavedDocument | null;
  /** Back to the documents list (after pending saves finish). */
  onClose: () => void;
}

/** AI chat + document picker/live preview + PDF download, autosaved after every turn. */
export function DocumentBuilder({ library, saved, onClose }: DocumentBuilderProps) {
  const [draft, setDraft] = useState<Draft>(() => saved?.draft ?? createDraft(null));
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const today = useToday();
  const autosave = useAutosave(saved?.id ?? null);
  const chat = useDocumentChat({
    initialMessages: saved?.messages,
    draft,
    today,
    onTurn: (changes, messages) => {
      // `draft` is what this turn was sent with; nothing else edits it while a turn runs.
      const next = applyChanges(draft, changes, library);
      setDraft(next);
      autosave.save({ draft: next, messages });
    },
  });

  const doc = library.find((d) => d.id === draft.documentId) ?? null;
  const standardTerms = useStandardTerms(doc?.id ?? null);
  const blocks = useMemo(
    () => (doc ? buildDocument(doc, draft, standardTerms.terms ?? []) : null),
    [doc, draft, standardTerms.terms],
  );
  const generating = status === "generating";

  async function handleDownload() {
    if (!doc || generating) return;
    setStatus("generating");
    try {
      const terms = await fetchStandardTerms(doc.id);
      await downloadPdf(buildDocument(doc, draft, terms), doc.name, pdfFileName(doc, draft));
      setStatus("idle");
    } catch (error) {
      console.error("Failed to generate PDF", error);
      setStatus("error");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => void autosave.settled().then(onClose)}
          className="text-sm font-medium text-stone-600 hover:text-stone-900"
        >
          ← All documents
        </button>
        <h1
          tabIndex={-1}
          data-view-heading
          className="min-w-0 flex-1 truncate text-lg font-semibold text-stone-900 focus:outline-none"
        >
          {documentTitle(saved?.title ?? null, draft, library)}
        </h1>
        <SaveIndicator status={autosave.status} onRetry={autosave.retry} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-8">
        <section aria-label="Assistant">
          <DocumentChat
            messages={chat.messages}
            sending={chat.sending}
            streaming={chat.streaming}
            error={chat.error}
            ready={chat.ready}
            onSend={chat.send}
          />
        </section>

        <section aria-label="Document preview" className="min-w-0">
          {doc && blocks ? (
            <>
              <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 bg-stone-100/90 py-3 backdrop-blur">
                <p className="text-sm text-stone-600">
                  <span className="rounded-sm bg-amber-100 px-1 text-amber-800">[Highlighted]</span> fields still need
                  input.
                </p>
                <div className="flex items-center gap-3">
                  <span role="status" className="sr-only">
                    {generating ? "Generating PDF…" : ""}
                  </span>
                  {status === "error" && (
                    <span role="alert" className="text-sm text-red-700">
                      Couldn’t generate the PDF. Please try again.
                    </span>
                  )}
                  {/* aria-disabled (not disabled) keeps keyboard focus on the button while generating. */}
                  <button
                    type="button"
                    onClick={handleDownload}
                    aria-disabled={generating}
                    className="rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-stone-700 aria-disabled:cursor-wait aria-disabled:opacity-60"
                  >
                    {generating ? "Generating…" : "Download PDF"}
                  </button>
                </div>
              </div>
              <DocumentPreview blocks={blocks} />
              {!standardTerms.terms && (
                <p className="mx-auto mt-4 max-w-[8.5in] text-center text-sm text-stone-500">
                  {standardTerms.failed ? (
                    <>
                      Couldn’t load the Standard Terms.{" "}
                      <button type="button" onClick={standardTerms.retry} className="font-semibold underline">
                        Retry
                      </button>
                    </>
                  ) : (
                    "Loading the Standard Terms…"
                  )}
                </p>
              )}
            </>
          ) : (
            <DocumentPicker
              library={library}
              disabled={!chat.ready || chat.sending}
              onPick={(picked) => void chat.send(`I'd like to create a ${picked.name}.`)}
            />
          )}
        </section>
      </div>
    </div>
  );
}
