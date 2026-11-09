import { readFileSync } from "node:fs";
import path from "node:path";

import { parseStandardTerms } from "./parseStandardTerms";
import type { Block, DocumentSpec } from "./types";

/**
 * Server-only: reads the document types (repo-root document-types.json) and
 * their Standard Terms from the templates dataset. Runs at build time, so the
 * app renders exactly the catalogued text.
 */
const REPO_ROOT = path.join(process.cwd(), "..");

export function loadDocumentSpecs(): DocumentSpec[] {
  const { documents } = JSON.parse(readFileSync(path.join(REPO_ROOT, "document-types.json"), "utf-8")) as {
    documents: DocumentSpec[];
  };
  return documents;
}

/** A document's parsed Standard Terms; served per document by app/standard-terms/[id]. */
export function loadStandardTerms(spec: DocumentSpec): Block[] {
  return parseStandardTerms(readFileSync(path.join(REPO_ROOT, spec.standardTerms), "utf-8"));
}
