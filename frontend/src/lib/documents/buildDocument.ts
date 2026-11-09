import type { Block, DocumentType, Draft, DraftChanges, Inline, Party, SignatureRow } from "./types";

const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

const emptyParty = (): Party => ({ name: "", title: "", company: "", noticeAddress: "" });

/** A fresh draft for `doc` (or no document yet), keeping the given parties. */
export function createDraft(doc: DocumentType | null, parties?: Pick<Draft, "party1" | "party2">): Draft {
  return {
    documentId: doc?.id ?? null,
    fields: Object.fromEntries((doc?.fields ?? []).filter((f) => f.default).map((f) => [f.key, f.default!])),
    party1: parties?.party1 ?? emptyParty(),
    party2: parties?.party2 ?? emptyParty(),
  };
}

/**
 * Applies one assistant turn. Selecting a different document resets the
 * fields to that document's defaults but keeps both parties; field and party
 * changes are then merged in.
 */
export function applyChanges(draft: Draft, changes: DraftChanges, library: DocumentType[]): Draft {
  let next = draft;
  if (changes.documentId && changes.documentId !== draft.documentId) {
    const doc = library.find((d) => d.id === changes.documentId);
    if (doc) next = createDraft(doc, draft);
  }
  return {
    ...next,
    fields: { ...next.fields, ...changes.fields },
    party1: { ...next.party1, ...changes.party1 },
    party2: { ...next.party2, ...changes.party2 },
  };
}

/**
 * A user-supplied value, or a bracketed placeholder when it is blank.
 */
function value(text: string, placeholder: string): Inline {
  const trimmed = text.trim();
  return trimmed
    ? { kind: "value", text: trimmed, filled: true }
    : { kind: "value", text: `[${placeholder}]`, filled: false };
}

const text = (t: string): Inline => ({ kind: "text", text: t });
/** An empty signature-table cell, left blank to be completed by hand. */
const emptyCell: Inline = text("");

/** Formats an ISO date (YYYY-MM-DD) as e.g. "November 8, 2026"; "" if invalid. */
export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function signatureRows(doc: DocumentType, p1: Party, p2: Party): SignatureRow[] {
  const row = (label: string, field: keyof Party, note?: string): SignatureRow => ({
    label,
    note,
    values: [value(p1[field], `${doc.parties[0]} ${label}`), value(p2[field], `${doc.parties[1]} ${label}`)],
  });
  return [
    { label: "Signature", values: [emptyCell, emptyCell] },
    row("Print Name", "name"),
    row("Title", "title"),
    row("Company", "company"),
    row("Notice Address", "noticeAddress", "Use either email or postal address"),
    { label: "Date", values: [emptyCell, emptyCell] },
  ];
}

/**
 * Builds the complete document: a Cover Page with the draft's values (blank
 * ones as highlighted placeholders) and signature block, followed by the
 * document's Standard Terms.
 */
export function buildDocument(doc: DocumentType, draft: Draft): Block[] {
  const standardTerms = `the Common Paper ${doc.name} Standard Terms${doc.version ? ` Version ${doc.version}` : ""}`;
  const fieldBlocks = doc.fields.flatMap((field): Block[] => {
    const raw = draft.fields[field.key] ?? "";
    const shown = field.type === "date" ? formatDate(raw) : raw;
    return [
      { kind: "heading", text: field.label },
      { kind: "paragraph", inlines: [value(shown, field.label)] },
    ];
  });
  const hasEffectiveDate = doc.fields.some((f) => f.key === "effectiveDate");

  return [
    { kind: "title", text: doc.name },
    { kind: "heading", text: `Using this ${doc.name}` },
    {
      kind: "paragraph",
      inlines: [
        text(`This ${doc.name} consists of: (1) this Cover Page (“`),
        { kind: "bold", text: "Cover Page" },
        text(`”) and (2) ${standardTerms} (“`),
        { kind: "bold", text: "Standard Terms" },
        ...(doc.standardTermsUrl
          ? [
              text("”) identical to those posted at "),
              { kind: "link", text: doc.standardTermsUrl.replace(/^https:\/\//, ""), href: doc.standardTermsUrl } as Inline,
              text(". "),
            ]
          : [text("”), which follow this Cover Page. ")]),
        text(
          "Any modifications of the Standard Terms should be made on the Cover Page, which will control over conflicts with the Standard Terms.",
        ),
      ],
    },
    ...fieldBlocks,
    {
      kind: "paragraph",
      inlines: [
        text(
          `By signing this Cover Page, each party agrees to enter into this ${doc.name}${hasEffectiveDate ? " as of the Effective Date" : ""}.`,
        ),
      ],
    },
    { kind: "signatures", parties: doc.parties, rows: signatureRows(doc, draft.party1, draft.party2) },
    {
      kind: "paragraph",
      tone: "note",
      inlines: [
        text(`Common Paper ${doc.name}${doc.version ? ` (Version ${doc.version})` : ""} free to use under `),
        { kind: "link", text: "CC BY 4.0", href: LICENSE_URL },
        text("."),
      ],
    },
    { kind: "pageBreak" },
    ...doc.terms,
  ];
}

/** A filesystem-safe download name, e.g. "CSA-Acme-Inc-Globex.pdf". */
export function pdfFileName(doc: DocumentType, draft: Draft): string {
  const slug = (s: string) => s.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const parts = [slug(doc.shortName), slug(draft.party1.company), slug(draft.party2.company)].filter(Boolean);
  return `${parts.join("-")}.pdf`;
}
