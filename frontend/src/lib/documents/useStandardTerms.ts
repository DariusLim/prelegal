import { useEffect, useState } from "react";

import type { Block } from "./types";

// One request per document per page load, shared by the preview and the PDF export.
const cache = new Map<string, Promise<Block[]>>();

/** Fetches a document's Standard Terms (from app/standard-terms/[id]); cached, and retried after a failure. */
export function fetchStandardTerms(documentId: string): Promise<Block[]> {
  let terms = cache.get(documentId);
  if (!terms) {
    terms = fetch(`/standard-terms/${encodeURIComponent(documentId)}`).then((response) => {
      if (!response.ok) throw new Error(`Standard Terms for ${documentId}: HTTP ${response.status}`);
      return response.json() as Promise<Block[]>;
    });
    terms.catch(() => cache.delete(documentId));
    cache.set(documentId, terms);
  }
  return terms;
}

type State = { documentId: string; terms: Block[] | null; failed: boolean };

/** The Standard Terms of `documentId`: null while loading (or with no document); `failed` offers a retry. */
export function useStandardTerms(documentId: string | null) {
  const [state, setState] = useState<State | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!documentId) return;
    let current = true;
    fetchStandardTerms(documentId).then(
      (terms) => current && setState({ documentId, terms, failed: false }),
      (error: unknown) => {
        console.error(error);
        if (current) setState({ documentId, terms: null, failed: true });
      },
    );
    return () => {
      current = false;
    };
  }, [documentId, attempt]);

  // Ignore a result for a previously selected document.
  const mine = state && state.documentId === documentId ? state : null;
  return {
    terms: mine?.terms ?? null,
    failed: mine?.failed ?? false,
    retry: () => {
      setState(null);
      setAttempt((n) => n + 1);
    },
  };
}
