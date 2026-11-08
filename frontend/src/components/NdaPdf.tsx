import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { Block, Inline } from "@/lib/nda/types";

/**
 * PDF rendering of the NDA document model. Loaded on demand (see
 * NdaBuilder) so @react-pdf/renderer stays out of the initial bundle.
 */

/**
 * Forbids line breaks inside words (10000 is "infinite" in react-pdf's
 * Knuth-Plass line breaker). Without it, legal text gets hyphenated, and a
 * stray hyphen is inserted where a styled run meets punctuation, e.g.
 * "Information-" / "”)".
 */
const noHyphenation = { hyphenationPenalty: 10000 };

const styles = StyleSheet.create({
  page: { paddingVertical: 48, paddingHorizontal: 64, fontFamily: "Times-Roman", fontSize: 11, lineHeight: 1.4 },
  title: { fontFamily: "Times-Bold", fontSize: 18, textAlign: "center", marginBottom: 14 },
  heading: { fontFamily: "Times-Bold", fontSize: 12, marginTop: 10 },
  headingNote: { fontFamily: "Times-Italic", fontSize: 9, color: "#666666" },
  paragraph: { marginTop: 4 },
  note: { marginTop: 14, fontSize: 8, color: "#666666" },
  clause: { marginTop: 7, textAlign: "justify" },
  bold: { fontFamily: "Times-Bold" },
  term: { fontFamily: "Times-Bold", textDecoration: "underline" },
  link: { color: "#1d4ed8", textDecoration: "underline" },
  placeholder: { color: "#92400e" },
  table: { marginTop: 10, fontSize: 10, lineHeight: 1.25, borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#999999" },
  row: { flexDirection: "row" },
  cell: { flex: 1, padding: 4, minHeight: 20, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#999999" },
  labelCell: { flex: 0.7 },
  headerCell: { fontFamily: "Times-Bold", textAlign: "center" },
});

/** Returns a bare string for unstyled runs; callers must place the result inside a <Text>. */
function renderInline(inline: Inline, key: number) {
  switch (inline.kind) {
    case "text":
      return inline.text;
    case "bold":
      return <Text key={key} style={styles.bold}>{inline.text}</Text>;
    case "term":
      return <Text key={key} style={styles.term}>{inline.text}</Text>;
    case "link":
      return <Link key={key} src={inline.href} style={styles.link}>{inline.text}</Link>;
    case "value":
      return inline.filled ? inline.text : <Text key={key} style={styles.placeholder}>{inline.text}</Text>;
  }
}

const renderInlines = (inlines: Inline[]) => inlines.map(renderInline);

function renderBlock(block: Block, key: number) {
  switch (block.kind) {
    case "title":
      return <Text key={key} style={styles.title} {...noHyphenation}>{block.text}</Text>;
    case "heading":
      return (
        <Text key={key} style={styles.heading} minPresenceAhead={30} {...noHyphenation}>
          {block.text}
          {block.note && <Text style={styles.headingNote}>{`   ${block.note}`}</Text>}
        </Text>
      );
    case "paragraph":
      return (
        <Text key={key} style={block.tone === "note" ? styles.note : styles.paragraph} {...noHyphenation}>
          {renderInlines(block.inlines)}
        </Text>
      );
    case "clause":
      return (
        <Text key={key} style={styles.clause} {...noHyphenation}>
          {`${block.number}. `}
          {renderInlines(block.inlines)}
        </Text>
      );
    case "signatures":
      return (
        <View key={key} style={styles.table} wrap={false}>
          <View style={styles.row}>
            <Text style={[styles.cell, styles.labelCell]} />
            <Text style={[styles.cell, styles.headerCell]}>PARTY 1</Text>
            <Text style={[styles.cell, styles.headerCell]}>PARTY 2</Text>
          </View>
          {block.rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <View style={[styles.cell, styles.labelCell]}>
                <Text style={styles.bold}>{row.label}</Text>
                {row.note && <Text style={styles.headingNote} {...noHyphenation}>{row.note}</Text>}
              </View>
              {row.values.map((v, i) => (
                <Text key={i} style={styles.cell} {...noHyphenation}>{renderInline(v, i)}</Text>
              ))}
            </View>
          ))}
        </View>
      );
    case "pageBreak":
      return <View key={key} break />;
  }
}

export function NdaPdf({ blocks }: { blocks: Block[] }) {
  return (
    <Document title="Mutual Non-Disclosure Agreement" creator="prelegal">
      <Page size="LETTER" style={styles.page} wrap>
        {blocks.map(renderBlock)}
      </Page>
    </Document>
  );
}
