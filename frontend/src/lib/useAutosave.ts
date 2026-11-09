import { useRef, useState } from "react";

import { api, type ChatMessage } from "@/lib/api";
import type { Draft } from "@/lib/documents/types";

export type SaveStatus = "unsaved" | "saving" | "saved" | "error";

interface Snapshot {
  draft: Draft;
  messages: ChatMessage[];
}

/**
 * Saves a document's draft and conversation. The first save creates the
 * document (so abandoned blank documents are never stored); later saves
 * update it. Saves run one at a time, and a save requested while another is
 * running is coalesced into one request with the latest state.
 */
export function useAutosave(documentId: number | null) {
  const idRef = useRef(documentId);
  const pendingRef = useRef<Snapshot | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const [status, setStatus] = useState<SaveStatus>(documentId === null ? "unsaved" : "saved");

  async function flush() {
    const snapshot = pendingRef.current;
    if (!snapshot) return;
    pendingRef.current = null;
    setStatus("saving");
    try {
      if (idRef.current === null) idRef.current = (await api.createDocument(snapshot)).id;
      else await api.updateDocument(idRef.current, snapshot);
      setStatus(pendingRef.current ? "saving" : "saved");
    } catch (error) {
      console.error("Couldn't save the document", error);
      pendingRef.current ??= snapshot;
      setStatus("error");
    }
  }

  function enqueue() {
    chainRef.current = chainRef.current.then(flush);
    return chainRef.current;
  }

  return {
    status,
    save: (snapshot: Snapshot) => {
      pendingRef.current = snapshot;
      void enqueue();
    },
    /** Tries a failed save again. */
    retry: () => void enqueue(),
    /** Resolves once every requested save has finished (or failed). */
    settled: () => chainRef.current,
  };
}
