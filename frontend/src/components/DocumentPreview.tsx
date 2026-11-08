import type { Block, Inline } from "@/lib/nda/types";

function InlineRun({ inline }: { inline: Inline }) {
  switch (inline.kind) {
    case "text":
      return inline.text;
    case "bold":
      return <strong>{inline.text}</strong>;
    case "term":
      return <span className="font-semibold underline decoration-dotted underline-offset-2">{inline.text}</span>;
    case "link":
      return (
        <a href={inline.href} target="_blank" rel="noreferrer" className="text-blue-700 underline">
          {inline.text}
        </a>
      );
    case "value":
      return inline.filled ? (
        <span className="whitespace-pre-wrap rounded-sm bg-emerald-50 px-0.5 text-emerald-900">{inline.text}</span>
      ) : (
        <span className="rounded-sm bg-amber-100 px-0.5 text-amber-800">{inline.text}</span>
      );
  }
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return inlines.map((inline, i) => <InlineRun key={i} inline={inline} />);
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "title":
      return <h2 className="mb-6 mt-2 text-center text-2xl font-bold">{block.text}</h2>;
    case "heading":
      return (
        <h3 className="mt-5 font-bold">
          {block.text}
          {block.note && <span className="ml-2 text-xs font-normal italic text-stone-500">{block.note}</span>}
        </h3>
      );
    case "paragraph":
      return (
        <p className={block.tone === "note" ? "mt-6 text-xs text-stone-500" : "mt-2"}>
          <Inlines inlines={block.inlines} />
        </p>
      );
    case "clause":
      return (
        <p className="mt-3 text-justify">
          {block.number}. <Inlines inlines={block.inlines} />
        </p>
      );
    case "signatures":
      return (
        <table className="mt-4 w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-1/4 border border-stone-300 p-2" />
              <th className="border border-stone-300 p-2">PARTY 1</th>
              <th className="border border-stone-300 p-2">PARTY 2</th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="border border-stone-300 p-2 text-left align-top font-semibold">
                  {row.label}
                  {row.note && <div className="text-xs font-normal italic text-stone-500">{row.note}</div>}
                </th>
                {row.values.map((v, i) => (
                  <td key={i} className="h-10 break-words border border-stone-300 p-2 align-top">
                    <InlineRun inline={v} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "pageBreak":
      return <hr className="my-10 border-dashed border-stone-300" />;
  }
}

/** HTML rendering of the NDA document model, styled as a sheet of paper. */
export function DocumentPreview({ blocks }: { blocks: Block[] }) {
  return (
    <article className="mx-auto max-w-[8.5in] bg-white px-8 py-10 font-serif text-[15px] leading-relaxed text-stone-900 shadow-lg ring-1 ring-stone-200 sm:px-14">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </article>
  );
}
