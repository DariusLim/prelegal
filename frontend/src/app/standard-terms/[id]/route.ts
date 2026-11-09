import { loadDocumentSpecs, loadStandardTerms } from "@/lib/documents/loadLibrary";
import type { Block } from "@/lib/documents/types";

/**
 * GET /standard-terms/<document id>: the document's parsed Standard Terms as
 * JSON Block[]. Prerendered for every document at build time, so the page
 * itself only ships the document list and each document's terms are fetched
 * when it is opened. (Not under /api, which is proxied to the backend.)
 */
export function generateStaticParams() {
  return loadDocumentSpecs().map(({ id }) => ({ id }));
}

async function standardTerms(id: string): Promise<Block[] | null> {
  "use cache";
  const spec = loadDocumentSpecs().find((d) => d.id === id);
  return spec ? loadStandardTerms(spec) : null;
}

export async function GET(_request: Request, { params }: RouteContext<"/standard-terms/[id]">) {
  const terms = await standardTerms((await params).id);
  return terms ? Response.json(terms) : Response.json({ detail: "Unknown document." }, { status: 404 });
}
