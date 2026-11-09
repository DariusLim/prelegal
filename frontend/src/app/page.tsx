import { DocumentBuilder } from "@/components/DocumentBuilder";
import { loadLibrary } from "@/lib/documents/loadLibrary";

// Read once at module scope: the document types and templates are static, so
// they are baked into the prerendered page at build time.
const library = loadLibrary();

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Legal Document Creator</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          Chat with the assistant about the agreement you need. It picks the right Common Paper standard document, asks
          about the parties and key terms, and fills in the document as you answer, ready to download as a PDF.
        </p>
      </header>
      <DocumentBuilder library={library} />
    </main>
  );
}
