import { NdaBuilder } from "@/components/NdaBuilder";
import { loadStandardTerms } from "@/lib/nda/loadStandardTerms";

// Read once at module scope: the template is static, so it is baked into
// the prerendered page at build time.
const standardTerms = loadStandardTerms();

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Mutual NDA Creator</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          Chat with the assistant about your agreement. It asks about the parties and key terms and fills in the NDA
          as you answer, ready to download as a PDF. Based on the Common Paper Mutual NDA (Version 1.0).
        </p>
      </header>
      <NdaBuilder standardTerms={standardTerms} />
    </main>
  );
}
