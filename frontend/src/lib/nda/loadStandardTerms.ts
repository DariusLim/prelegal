import { readFileSync } from "node:fs";
import path from "node:path";

import { parseStandardTerms } from "./parseStandardTerms";
import type { Block } from "./types";

/**
 * Server-only: reads the Standard Terms from the repository's templates
 * dataset (../templates relative to the frontend app), so the app always
 * renders the same text that is catalogued in catalog.json.
 */
const STANDARD_TERMS_PATH = path.join(process.cwd(), "..", "templates", "Mutual-NDA.md");

export function loadStandardTerms(): Block[] {
  return parseStandardTerms(readFileSync(STANDARD_TERMS_PATH, "utf-8"));
}
