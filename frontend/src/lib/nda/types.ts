/**
 * Shared types for the Mutual NDA creator.
 *
 * The form produces `NdaFormData`; `buildNdaDocument` turns it into a
 * `Block[]` — a renderer-agnostic document model consumed by both the HTML
 * preview and the PDF renderer, so the two can never drift apart.
 */

export interface Party {
  name: string;
  title: string;
  company: string;
  noticeAddress: string;
}

export interface NdaFormData {
  purpose: string;
  /** ISO date (YYYY-MM-DD). Empty means "today". */
  effectiveDate: string;
  mndaTermType: "expires" | "untilTerminated";
  mndaTermYears: number;
  confidentialityType: "years" | "perpetual";
  confidentialityYears: number;
  governingLaw: string;
  jurisdiction: string;
  modifications: string;
  party1: Party;
  party2: Party;
}

/**
 * Field changes proposed by the AI assistant: any subset of the fields, with
 * party details merged individually.
 */
export type NdaUpdates = Partial<Omit<NdaFormData, "party1" | "party2">> & {
  party1?: Partial<Party>;
  party2?: Partial<Party>;
};

/** A run of text within a paragraph. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  /** A reference in the Standard Terms to a term defined on the Cover Page. */
  | { kind: "term"; text: string }
  | { kind: "link"; text: string; href: string }
  /** A value supplied by the user; `filled: false` means a placeholder is shown. */
  | { kind: "value"; text: string; filled: boolean };

export type Block =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string; note?: string }
  | { kind: "paragraph"; inlines: Inline[]; tone?: "note" }
  | { kind: "clause"; number: string; inlines: Inline[] }
  | { kind: "signatures"; rows: SignatureRow[] }
  | { kind: "pageBreak" };

export interface SignatureRow {
  label: string;
  note?: string;
  values: [Inline, Inline];
}
