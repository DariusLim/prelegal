"use client";

import { useMemo, useState } from "react";

import { DocumentPreview } from "@/components/DocumentPreview";
import { NdaForm } from "@/components/NdaForm";
import { buildNdaDocument, createDefaultFormData, pdfFileName } from "@/lib/nda/buildDocument";
import type { Block, NdaFormData } from "@/lib/nda/types";
import { useToday } from "@/lib/useToday";

async function downloadPdf(blocks: Block[], fileName: string) {
  // Loaded on demand: @react-pdf/renderer is large and only needed on download.
  const [{ pdf }, { NdaPdf }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/components/NdaPdf"),
  ]);
  const blob = await pdf(<NdaPdf blocks={blocks} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoke after the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Form + live preview + PDF download for the Mutual NDA. */
export function NdaBuilder({ standardTerms }: { standardTerms: Block[] }) {
  const [data, setData] = useState<NdaFormData>(createDefaultFormData);
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const today = useToday();

  const blocks = useMemo(() => buildNdaDocument(data, standardTerms, today), [data, standardTerms, today]);
  const generating = status === "generating";

  async function handleDownload() {
    if (generating) return;
    setStatus("generating");
    try {
      await downloadPdf(blocks, pdfFileName(data));
      setStatus("idle");
    } catch (error) {
      console.error("Failed to generate PDF", error);
      setStatus("error");
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section aria-label="NDA details">
        <NdaForm data={data} today={today} onChange={(patch) => setData((d) => ({ ...d, ...patch }))} />
      </section>

      <section aria-label="NDA preview" className="min-w-0">
        <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 bg-stone-100/90 py-3 backdrop-blur">
          <p className="text-sm text-stone-600">
            <span className="rounded-sm bg-amber-100 px-1 text-amber-800">[Highlighted]</span> fields still need input.
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
      </section>
    </div>
  );
}
