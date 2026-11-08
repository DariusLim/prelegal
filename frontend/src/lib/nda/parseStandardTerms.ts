import type { Block, Inline } from "./types";

/**
 * Matches the inline markup used in the Common Paper templates:
 * `**bold**`, `<span class="coverpage_link">Term</span>` and `[text](url)`.
 */
const INLINE_TOKEN =
  /\*\*(.+?)\*\*|<span class="coverpage_link">(.+?)<\/span>|\[(.+?)\]\((.+?)\)/g;

const CLAUSE = /^(\d+)\.\s+([\s\S]*)$/;

export function parseInlines(source: string): Inline[] {
  const inlines: Inline[] = [];
  let cursor = 0;

  for (const match of source.matchAll(INLINE_TOKEN)) {
    if (match.index > cursor) {
      inlines.push({ kind: "text", text: source.slice(cursor, match.index) });
    }
    const [, bold, term, linkText, href] = match;
    if (bold !== undefined) inlines.push({ kind: "bold", text: bold });
    else if (term !== undefined) inlines.push({ kind: "term", text: term });
    else inlines.push({ kind: "link", text: linkText, href });
    cursor = match.index + match[0].length;
  }

  if (cursor < source.length) {
    inlines.push({ kind: "text", text: source.slice(cursor) });
  }
  return inlines;
}

/**
 * Parses the Mutual NDA Standard Terms markdown (templates/Mutual-NDA.md)
 * into document blocks: a title, one clause per numbered paragraph, and any
 * trailing paragraphs (e.g. the licence attribution) as notes.
 */
export function parseStandardTerms(markdown: string): Block[] {
  return markdown
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): Block => {
      if (chunk.startsWith("# ")) {
        return { kind: "title", text: chunk.slice(2).trim() };
      }
      const clause = CLAUSE.exec(chunk);
      if (clause) {
        return { kind: "clause", number: clause[1], inlines: parseInlines(clause[2]) };
      }
      return { kind: "paragraph", inlines: parseInlines(chunk), tone: "note" };
    });
}
