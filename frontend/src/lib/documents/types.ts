/**
 * Shared types for the document creator.
 *
 * `DocumentType`s come from the repo-root document-types.json. The chat edits
 * a `Draft`; `buildDocument` turns the draft into a `Block[]`, a
 * renderer-agnostic document model consumed by both the HTML preview and the
 * PDF renderer, so the two can never drift apart.
 */

export interface FieldSpec {
  key: string;
  label: string;
  hint: string;
  type?: "text" | "longText" | "date";
  default?: string;
}

/** A document type as declared in document-types.json. */
export interface DocumentSpec {
  id: string;
  name: string;
  shortName: string;
  description: string;
  /** Repo-relative path of the Standard Terms template. */
  standardTerms: string;
  version?: string;
  standardTermsUrl?: string;
  /** The two signing roles, e.g. ["Provider", "Customer"]. */
  parties: [string, string];
  fields: FieldSpec[];
}

/** A document type with its Standard Terms parsed (built at build time). */
export interface DocumentType extends DocumentSpec {
  terms: Block[];
}

export interface Party {
  name: string;
  title: string;
  company: string;
  noticeAddress: string;
}

/** What the user is drafting: the chosen document type, its Cover Page values and the parties. */
export interface Draft {
  documentId: string | null;
  /** Cover Page values by field key. Dates are YYYY-MM-DD. */
  fields: Record<string, string>;
  party1: Party;
  party2: Party;
}

/** Changes from one assistant turn (already validated by the backend). */
export interface DraftChanges {
  /** Set when the assistant selects or switches the document type. */
  documentId?: string;
  fields?: Record<string, string>;
  party1?: Partial<Party>;
  party2?: Partial<Party>;
}

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
  /** A numbered clause; `level` 0 is a section, deeper levels are nested sub-clauses. */
  | { kind: "clause"; label: string; level: number; inlines: Inline[] }
  | { kind: "signatures"; parties: [string, string]; rows: SignatureRow[] }
  | { kind: "pageBreak" };

export interface SignatureRow {
  label: string;
  note?: string;
  values: [Inline, Inline];
}
