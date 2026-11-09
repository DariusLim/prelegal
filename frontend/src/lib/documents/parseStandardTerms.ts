import type { Block, Inline } from "./types";

/**
 * Matches the inline markup used in the Common Paper templates:
 * `**bold**`; term references such as `<span class="coverpage_link">Term</span>`
 * (also keyterms_, orderform_, businessterms_ and sow_link); section titles
 * `<span class="header_2" id="1">Title</span>`; `[text](url)` and `<https://url>`.
 */
const INLINE_TOKEN =
  /\*\*(.+?)\*\*|<span class="[a-z]+_link"[^>]*>(.+?)<\/span>|<span class="header_\d+"[^>]*>(.+?)<\/span>|\[(.+?)\]\((.+?)\)|<(https?:\/\/[^\s>]+)>/g;

/**
 * Removes spans without a class (e.g. `<span id="13.19">` anchors around a
 * definition) but keeps their content, which may contain other markup.
 */
function stripAnchorSpans(source: string): string {
  const keepStack: boolean[] = [];
  return source.replace(/<span\b([^>]*)>|<\/span>/g, (tag, attrs?: string) => {
    if (tag === "</span>") return keepStack.pop() ? tag : "";
    const keep = /\bclass=/.test(attrs ?? "");
    keepStack.push(keep);
    return keep ? tag : "";
  });
}

/** A list item: four spaces of indent per nesting level, then `1.`, `a.` or `iv.`. */
const LIST_ITEM = /^( *)(\d+|[a-z]+)\.\s+(.*)$/;

export function parseInlines(markup: string): Inline[] {
  const source = stripAnchorSpans(markup);
  const inlines: Inline[] = [];
  let cursor = 0;

  for (const match of source.matchAll(INLINE_TOKEN)) {
    if (match.index > cursor) {
      inlines.push({ kind: "text", text: source.slice(cursor, match.index) });
    }
    const [, bold, term, header, linkText, href, url] = match;
    if (bold !== undefined) {
      // Bold runs may contain term references: keep those, embolden the rest.
      for (const inner of parseInlines(bold)) {
        inlines.push(inner.kind === "text" ? { kind: "bold", text: inner.text } : inner);
      }
    }
    else if (term !== undefined) inlines.push({ kind: "term", text: term });
    else if (header !== undefined) inlines.push({ kind: "bold", text: header });
    else if (url !== undefined) inlines.push({ kind: "link", text: url, href: url });
    else inlines.push({ kind: "link", text: linkText, href });
    cursor = match.index + match[0].length;
  }

  if (cursor < source.length) {
    inlines.push({ kind: "text", text: source.slice(cursor) });
  }
  return inlines;
}

/** "1." for sections, "1.2" for numbered sub-clauses, "(a)" / "(iv)" below that. */
function clauseLabel(markers: string[], level: number): string {
  const marker = markers[level];
  if (level === 0) return `${marker}.`;
  if (level === 1 && /^\d+$/.test(marker) && markers[0]) return `${markers[0]}.${marker}`;
  return `(${marker})`;
}

/**
 * Parses a Standard Terms template (templates/*.md) into document blocks:
 * `#` titles, `##`+ headings, nested numbered clauses and any other lines
 * (e.g. a licence attribution) as notes.
 */
export function parseStandardTerms(markdown: string): Block[] {
  const blocks: Block[] = [];
  // The marker of the most recent item at each nesting level.
  const markers: string[] = [];

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const heading = /^(#+)\s+(.*)$/.exec(line);
    if (heading) {
      const text = heading[2].trim();
      blocks.push(heading[1].length === 1 ? { kind: "title", text } : { kind: "heading", text });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const level = Math.floor(item[1].length / 4);
      markers.length = level;
      markers[level] = item[2];
      blocks.push({ kind: "clause", label: clauseLabel(markers, level), level, inlines: parseInlines(item[3]) });
      continue;
    }

    blocks.push({ kind: "paragraph", inlines: parseInlines(line.trim()), tone: "note" });
  }
  return blocks;
}
