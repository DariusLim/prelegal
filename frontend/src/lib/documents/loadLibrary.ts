import { readFileSync } from "node:fs";
import path from "node:path";

import { parseStandardTerms } from "./parseStandardTerms";
import type { DocumentSpec, DocumentType } from "./types";

/**
 * Server-only: reads the document types (repo-root document-types.json) and
 * parses each one's Standard Terms from the templates dataset. Runs at build
 * time, so the app renders exactly the catalogued text.
 */
const REPO_ROOT = path.join(process.cwd(), "..");

export function loadLibrary(): DocumentType[] {
  const { documents } = JSON.parse(readFileSync(path.join(REPO_ROOT, "document-types.json"), "utf-8")) as {
    documents: DocumentSpec[];
  };
  return documents.map((spec) => ({
    ...spec,
    terms: parseStandardTerms(readFileSync(path.join(REPO_ROOT, spec.standardTerms), "utf-8")),
  }));
}
