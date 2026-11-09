import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";

import { DocumentPdf } from "@/components/DocumentPdf";
import { applyChanges, buildDocument, createDraft, documentTitle, formatDate, pdfFileName } from "../buildDocument";
import { loadDocumentSpecs, loadStandardTerms } from "../loadLibrary";
import { parseInlines, parseStandardTerms } from "../parseStandardTerms";
import type { Block, DocumentSpec, Draft, Inline } from "../types";

const library = loadDocumentSpecs();
const byId = (id: string) => library.find((d) => d.id === id) as DocumentSpec;
const termsOf = (id: string) => loadStandardTerms(byId(id));

const plainText = (inlines: Inline[]) => inlines.map((i) => i.text).join("");
const allText = (doc: Block[]) =>
  doc
    .flatMap((b) =>
      b.kind === "paragraph" || b.kind === "clause"
        ? [plainText(b.inlines)]
        : b.kind === "signatures"
          ? [...b.parties, ...b.rows.flatMap((r) => r.values.map((v) => v.text))]
          : b.kind === "title" || b.kind === "heading"
            ? [b.text]
            : [],
    )
    .join("\n");

const party = (company: string, name = "", title = "", noticeAddress = "") => ({ name, title, company, noticeAddress });

describe("parseInlines", () => {
  it("handles term spans with ids and terms inside bold text", () => {
    expect(parseInlines('**Cap is the <span class="keyterms_link" id="8.1">General Cap</span>**')).toEqual([
      { kind: "bold", text: "Cap is the " },
      { kind: "term", text: "General Cap" },
    ]);
  });

  it("drops anchor spans but keeps their content", () => {
    expect(parseInlines('<span id="13.1">**"Affiliate"** has a <span class="keyterms_link">Cap</span>.</span>')).toEqual([
      { kind: "bold", text: '"Affiliate"' },
      { kind: "text", text: " has a " },
      { kind: "term", text: "Cap" },
      { kind: "text", text: "." },
    ]);
  });

  it("parses bold, term references of every kind, section titles and links", () => {
    expect(
      parseInlines(
        '<span class="header_3" id="1.1">Use.</span> a **B** <span class="coverpage_link">Customer</span>, ' +
          '<span class="keyterms_link">Governing Law</span> [x](https://y.z) <https://a.b/c>',
      ),
    ).toEqual([
      { kind: "bold", text: "Use." },
      { kind: "text", text: " a " },
      { kind: "bold", text: "B" },
      { kind: "text", text: " " },
      { kind: "term", text: "Customer" },
      { kind: "text", text: ", " },
      { kind: "term", text: "Governing Law" },
      { kind: "text", text: " " },
      { kind: "link", text: "x", href: "https://y.z" },
      { kind: "text", text: " " },
      { kind: "link", text: "https://a.b/c", href: "https://a.b/c" },
    ]);
  });
});

describe("parseStandardTerms", () => {
  it("numbers nested clauses by level", () => {
    const blocks = parseStandardTerms(
      [
        "# Terms",
        "",
        '1. <span class="header_2" id="1">Service</span>',
        "    1. Access.",
        "        a. First.",
        "            i. Deeper.",
        "    2. Support.",
        "2. Fees.",
        "Attribution line.",
      ].join("\n"),
    );
    expect(blocks.map((b) => (b.kind === "clause" ? [b.label, b.level] : b.kind))).toEqual([
      "title",
      ["1.", 0],
      ["1.1", 1],
      ["(a)", 2],
      ["(i)", 3],
      ["1.2", 1],
      ["2.", 0],
      "paragraph",
    ]);
  });
});

describe("document library", () => {
  it("loads every document type with its Standard Terms parsed cleanly", () => {
    expect(library).toHaveLength(11);
    for (const doc of library) {
      const terms = loadStandardTerms(doc);
      expect(terms.filter((b) => b.kind === "clause").length, doc.id).toBeGreaterThan(3);
      const leftovers = allText(terms).match(/.{0,40}(<\/?span|\*\*|\]\().{0,40}/g) ?? [];
      expect(leftovers, `unparsed markup in ${doc.id}`).toEqual([]);
      expect(new Set(doc.fields.map((f) => f.key)).size, doc.id).toBe(doc.fields.length);
    }
  });

  it("keeps the Mutual NDA's 11 top-level clauses", () => {
    const nda = { terms: termsOf("mutual-nda") };
    expect(nda.terms[0]).toEqual({ kind: "title", text: "Standard Terms" });
    const sections = nda.terms.filter((b) => b.kind === "clause" && b.level === 0);
    expect(sections.map((c) => (c.kind === "clause" ? c.label : ""))).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"].map((n) => `${n}.`),
    );
  });
});

describe("drafts", () => {
  it("creates a draft with the document's defaults", () => {
    const draft = createDraft(byId("mutual-nda"));
    expect(draft.documentId).toBe("mutual-nda");
    expect(draft.fields.mndaTerm).toBe("Expires 1 year from Effective Date.");
    expect(draft.fields.governingLaw).toBeUndefined();
    expect(createDraft(null).documentId).toBeNull();
  });

  it("switching documents keeps the parties and resets the fields", () => {
    const draft: Draft = {
      ...createDraft(byId("mutual-nda")),
      fields: { purpose: "Deal", governingLaw: "Delaware" },
      party1: party("Acme", "Ada"),
    };

    const next = applyChanges(
      draft,
      { documentId: "pilot-agreement", fields: { pilotPeriod: "90 days" }, party2: { company: "Globex" } },
      library,
    );

    expect(next.documentId).toBe("pilot-agreement");
    expect(next.fields).toEqual({ pilotPeriod: "90 days" });
    expect(next.party1).toEqual(party("Acme", "Ada"));
    expect(next.party2.company).toBe("Globex");
  });

  it("merges changes without resetting when the document stays the same or is unknown", () => {
    const draft: Draft = { ...createDraft(byId("pilot-agreement")), fields: { pilotPeriod: "90 days" } };

    expect(applyChanges(draft, { documentId: "pilot-agreement", fields: { governingLaw: "Delaware" } }, library).fields).toEqual({
      pilotPeriod: "90 days",
      governingLaw: "Delaware",
    });
    expect(applyChanges(draft, { documentId: "lease" }, library)).toEqual(draft);
  });
});

describe("buildDocument", () => {
  const csa = byId("cloud-service-agreement");
  const filled: Draft = {
    ...createDraft(csa),
    fields: { effectiveDate: "2026-12-01", subscriptionPeriod: "12 months", governingLaw: "Delaware" },
    party1: party("Acme, Inc.", "Ada Lovelace", "CEO", "ada@acme.test"),
    party2: party("Globex"),
  };

  it("fills in the cover page with the document's fields and party roles", () => {
    const doc = buildDocument(csa, filled, termsOf(csa.id));
    const text = allText(doc);
    expect(doc[0]).toEqual({ kind: "title", text: "Cloud Service Agreement" });
    expect(text).toContain("the Common Paper Cloud Service Agreement Standard Terms Version 3.0");
    expect(text).toContain("commonpaper.com/standards/cloud-service-agreement/3.0");
    expect(text).toContain("December 1, 2026");
    expect(text).toContain("12 months");
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("[Order Date]");
    expect(text).toContain("[Customer Print Name]");
    expect(doc.find((b) => b.kind === "signatures")).toMatchObject({ parties: ["Provider", "Customer"] });
    expect(text).toContain("as of the Effective Date.");
  });

  it("appends the Standard Terms after a page break", () => {
    const doc = buildDocument(csa, filled, termsOf(csa.id));
    const breakAt = doc.findIndex((b) => b.kind === "pageBreak");
    expect(doc.slice(breakAt + 1)).toEqual(termsOf(csa.id));
  });

  it("handles documents without a published URL or effective date", () => {
    const addendum = byId("ai-addendum");
    const text = allText(buildDocument(addendum, createDraft(addendum), []));
    expect(text).toContain("the Common Paper AI Addendum Standard Terms (“Standard Terms”), which follow this Cover Page.");
    expect(text).toContain("each party agrees to enter into this AI Addendum.");
    expect(text).toContain("[Training Data]");
  });

  it("formats dates and file names", () => {
    expect(formatDate("2026-02-28")).toBe("February 28, 2026");
    expect(formatDate("")).toBe("");
    expect(pdfFileName(csa, filled)).toBe("CSA-Acme-Inc-Globex.pdf");
    expect(pdfFileName(byId("mutual-nda"), createDraft(null))).toBe("Mutual-NDA.pdf");
  });

  it("ends with the Cover Page while the Standard Terms load", () => {
    expect(buildDocument(csa, filled, []).at(-1)).toEqual({ kind: "pageBreak" });
  });
});

describe("documentTitle", () => {
  const csa = byId("cloud-service-agreement");

  it("prefers the user's title, then the document and companies", () => {
    const draft: Draft = { ...createDraft(csa), party1: party("Acme, Inc."), party2: party(" Globex ") };
    expect(documentTitle("Q3 deal", draft, library)).toBe("Q3 deal");
    expect(documentTitle(null, draft, library)).toBe("CSA: Acme, Inc. & Globex");
    expect(documentTitle(null, { ...draft, party2: party("") }, library)).toBe("CSA: Acme, Inc.");
    expect(documentTitle(null, createDraft(csa), library)).toBe("Cloud Service Agreement");
    expect(documentTitle(null, createDraft(null), library)).toBe("Untitled document");
  });
});

describe("DocumentPdf", () => {
  it("renders a valid multi-page PDF of the longest document", async () => {
    const doc = byId("software-license-agreement");
    const blocks = buildDocument(doc, createDraft(doc), loadStandardTerms(doc));
    const buffer = await renderToBuffer(<DocumentPdf blocks={blocks} title={doc.name} />);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(5);
  }, 60000);
});
