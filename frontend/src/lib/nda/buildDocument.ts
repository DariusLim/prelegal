import type { Block, Inline, NdaFormData, Party, SignatureRow } from "./types";

export const STANDARD_TERMS_URL = "https://commonpaper.com/standards/mutual-nda/1.0";
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

export const DEFAULT_PURPOSE =
  "Evaluating whether to enter into a business relationship with the other party.";

const emptyParty = (): Party => ({ name: "", title: "", company: "", noticeAddress: "" });

export function createDefaultFormData(): NdaFormData {
  return {
    purpose: DEFAULT_PURPOSE,
    effectiveDate: "",
    mndaTermType: "expires",
    mndaTermYears: 1,
    confidentialityType: "years",
    confidentialityYears: 1,
    governingLaw: "",
    jurisdiction: "",
    modifications: "",
    party1: emptyParty(),
    party2: emptyParty(),
  };
}

/**
 * A form-derived value (typed by the user, or a sentence generated from their
 * choices), or a bracketed placeholder when it is blank.
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

function years(n: number): string {
  return `${n} year${n === 1 ? "" : "s"}`;
}

/** Formats an ISO date (YYYY-MM-DD) as e.g. "November 8, 2026". */
export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function signatureRows(p1: Party, p2: Party): SignatureRow[] {
  const row = (label: string, field: keyof Party, note?: string): SignatureRow => ({
    label,
    note,
    values: [value(p1[field], `Party 1 ${label}`), value(p2[field], `Party 2 ${label}`)],
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
 * Builds the complete Mutual NDA — the Cover Page filled in from the form,
 * followed by the Standard Terms — following templates/Mutual-NDA-coverpage.md.
 *
 * @param today ISO date used when the form leaves the Effective Date blank.
 */
export function buildNdaDocument(
  data: NdaFormData,
  standardTerms: Block[],
  today: string,
): Block[] {
  const effectiveDate = formatDate(data.effectiveDate || today);

  const mndaTerm =
    data.mndaTermType === "expires"
      ? `Expires ${years(data.mndaTermYears)} from Effective Date.`
      : "Continues until terminated in accordance with the terms of the MNDA.";

  const confidentialityTerm =
    data.confidentialityType === "years"
      ? `${years(data.confidentialityYears)} from Effective Date, but in the case of trade secrets until Confidential Information is no longer considered a trade secret under applicable laws.`
      : "In perpetuity.";

  return [
    { kind: "title", text: "Mutual Non-Disclosure Agreement" },
    { kind: "heading", text: "Using this Mutual Non-Disclosure Agreement" },
    {
      kind: "paragraph",
      inlines: [
        text("This Mutual Non-Disclosure Agreement (the “MNDA”) consists of: (1) this Cover Page (“"),
        { kind: "bold", text: "Cover Page" },
        text("”) and (2) the Common Paper Mutual NDA Standard Terms Version 1.0 (“"),
        { kind: "bold", text: "Standard Terms" },
        text("”) identical to those posted at "),
        { kind: "link", text: "commonpaper.com/standards/mutual-nda/1.0", href: STANDARD_TERMS_URL },
        text(
          ". Any modifications of the Standard Terms should be made on the Cover Page, which will control over conflicts with the Standard Terms.",
        ),
      ],
    },
    { kind: "heading", text: "Purpose", note: "How Confidential Information may be used" },
    { kind: "paragraph", inlines: [value(data.purpose, "Purpose")] },
    { kind: "heading", text: "Effective Date" },
    { kind: "paragraph", inlines: [value(effectiveDate, "Effective Date")] },
    { kind: "heading", text: "MNDA Term", note: "The length of this MNDA" },
    { kind: "paragraph", inlines: [value(mndaTerm, "MNDA Term")] },
    {
      kind: "heading",
      text: "Term of Confidentiality",
      note: "How long Confidential Information is protected",
    },
    { kind: "paragraph", inlines: [value(confidentialityTerm, "Term of Confidentiality")] },
    { kind: "heading", text: "Governing Law & Jurisdiction" },
    { kind: "paragraph", inlines: [text("Governing Law: "), value(data.governingLaw, "Governing Law (state)")] },
    {
      kind: "paragraph",
      inlines: [text("Jurisdiction: "), value(data.jurisdiction, "Jurisdiction (city or county and state)")],
    },
    { kind: "heading", text: "MNDA Modifications" },
    {
      kind: "paragraph",
      inlines: [data.modifications.trim() ? value(data.modifications, "MNDA Modifications") : text("None.")],
    },
    {
      kind: "paragraph",
      inlines: [text("By signing this Cover Page, each party agrees to enter into this MNDA as of the Effective Date.")],
    },
    { kind: "signatures", rows: signatureRows(data.party1, data.party2) },
    {
      kind: "paragraph",
      tone: "note",
      inlines: [
        text("Common Paper Mutual Non-Disclosure Agreement (Version 1.0) free to use under "),
        { kind: "link", text: "CC BY 4.0", href: LICENSE_URL },
        text("."),
      ],
    },
    { kind: "pageBreak" },
    ...standardTerms,
  ];
}

/** A filesystem-safe download name, e.g. "Mutual-NDA-Acme-Globex.pdf". */
export function pdfFileName(data: NdaFormData): string {
  const slug = (s: string) =>
    s.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const parts = ["Mutual-NDA", slug(data.party1.company), slug(data.party2.company)].filter(Boolean);
  return `${parts.join("-")}.pdf`;
}
