import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";

import { NdaPdf } from "@/components/NdaPdf";
import { buildNdaDocument, createDefaultFormData, formatDate, pdfFileName } from "../buildDocument";
import { loadStandardTerms } from "../loadStandardTerms";
import { parseInlines } from "../parseStandardTerms";
import type { Block, Inline, NdaFormData } from "../types";

const standardTerms = loadStandardTerms();

const plainText = (inlines: Inline[]) => inlines.map((i) => i.text).join("");
const allText = (doc: Block[]) =>
  doc
    .flatMap((b) =>
      b.kind === "paragraph" || b.kind === "clause"
        ? [plainText(b.inlines)]
        : b.kind === "signatures"
          ? b.rows.flatMap((r) => r.values.map((v) => v.text))
          : [],
    )
    .join("\n");

const filled: NdaFormData = {
  ...createDefaultFormData(),
  effectiveDate: "2026-11-08",
  mndaTermYears: 2,
  confidentialityType: "perpetual",
  governingLaw: "Delaware",
  jurisdiction: "courts located in New Castle, DE",
  party1: { name: "Ada Lovelace", title: "CEO", company: "Acme, Inc.", noticeAddress: "ada@acme.test" },
  party2: { name: "Alan Turing", title: "CTO", company: "Globex", noticeAddress: "alan@globex.test" },
};

describe("parseInlines", () => {
  it("parses bold, cover page terms and links", () => {
    expect(parseInlines('a **B** <span class="coverpage_link">Purpose</span> [x](https://y.z).')).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "B" },
      { kind: "text", text: " " },
      { kind: "term", text: "Purpose" },
      { kind: "text", text: " " },
      { kind: "link", text: "x", href: "https://y.z" },
      { kind: "text", text: "." },
    ]);
  });
});

describe("loadStandardTerms", () => {
  it("parses all 11 clauses from templates/Mutual-NDA.md", () => {
    expect(standardTerms[0]).toEqual({ kind: "title", text: "Standard Terms" });
    const clauses = standardTerms.filter((b) => b.kind === "clause");
    expect(clauses.map((c) => c.number)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(allText(standardTerms)).not.toMatch(/<span|\*\*/);
  });
});

describe("buildNdaDocument", () => {
  it("fills in the cover page from the form", () => {
    const text = allText(buildNdaDocument(filled, standardTerms, "2000-01-01"));
    expect(text).toContain("November 8, 2026");
    expect(text).toContain("Expires 2 years from Effective Date.");
    expect(text).toContain("In perpetuity.");
    expect(text).toContain("Governing Law: Delaware");
    expect(text).toContain("Acme, Inc.");
    expect(text).toContain("alan@globex.test");
    expect(text).not.toMatch(/\[Party|\[Governing/);
  });

  it("shows placeholders for blanks and defaults the effective date to today", () => {
    const doc = buildNdaDocument(createDefaultFormData(), standardTerms, "2026-01-02");
    const text = allText(doc);
    expect(text).toContain("January 2, 2026");
    expect(text).toContain("Expires 1 year from Effective Date.");
    expect(text).toContain("[Governing Law (state)]");
    expect(text).toContain("[Party 2 Company]");
    expect(text).toContain("None.");
  });

  it("appends the Standard Terms after a page break", () => {
    const doc = buildNdaDocument(filled, standardTerms, "");
    const breakAt = doc.findIndex((b) => b.kind === "pageBreak");
    expect(doc.slice(breakAt + 1)).toEqual(standardTerms);
  });
});

describe("helpers", () => {
  it("formats dates and file names", () => {
    expect(formatDate("2026-02-28")).toBe("February 28, 2026");
    expect(formatDate("")).toBe("");
    expect(pdfFileName(filled)).toBe("Mutual-NDA-Acme-Inc-Globex.pdf");
    expect(pdfFileName(createDefaultFormData())).toBe("Mutual-NDA.pdf");
  });
});

describe("NdaPdf", () => {
  it("renders a valid multi-page PDF", async () => {
    const buffer = await renderToBuffer(<NdaPdf blocks={buildNdaDocument(filled, standardTerms, "")} />);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(2);
  }, 30000);
});
