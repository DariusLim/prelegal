import { App } from "@/components/App";
import { loadDocumentSpecs } from "@/lib/documents/loadLibrary";

// Read once at module scope: the document types are static, so they are baked
// into the prerendered page at build time. Each document's Standard Terms are
// fetched when it is opened (app/standard-terms/[id]).
const library = loadDocumentSpecs();

export default function Home() {
  return <App library={library} />;
}
