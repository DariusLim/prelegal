"use client";

import { useMemo, useState } from "react";

import { DocumentChat } from "@/components/DocumentChat";
import { DocumentPicker } from "@/components/DocumentPicker";
import { DocumentPreview } from "@/components/DocumentPreview";
import { applyChanges, buildDocument, createDraft, pdfFileName } from "@/lib/documents/buildDocument";
import type { Block, DocumentType, Draft } from "@/lib/documents/types";
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

/** AI chat + document picker/live preview + PDF download. */
export function DocumentBuilder({ library }: { library: DocumentType[] }) {
  const [draft, setDraft] = useState<Draft>(() => createDraft(null));
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const today = useToday();
  const chat = useDocumentChat({
    draft,
    today,
    onChanges: (changes) => setDraft((d) => applyChanges(d, changes, library)),
  });

  const doc = library.find((d) => d.id === draft.documentId) ?? null;
  const blocks = useMemo(() => (doc ? buildDocument(doc, draft) : null), [doc, draft]);
  const generating = status === "generating";

  async function handleDownload() {
    if (!doc || !blocks || generating) return;
    setStatus("generating");
    try {
      await downloadPdf(blocks, doc.name, pdfFileName(doc, draft));
      setStatus("idle");
    } catch (error) {
      console.error("Failed to generate PDF", error);
      setStatus("error");
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section aria-label="Assistant">
        <DocumentChat
          messages={chat.messages}
          sending={chat.sending}
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
  );
}
