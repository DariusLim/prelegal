"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { api, type DocumentSummary, type SavedDocument } from "@/lib/api";
import { documentTitle } from "@/lib/documents/buildDocument";
import type { DocumentSpec } from "@/lib/documents/types";

function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

interface RowProps {
  doc: DocumentSummary;
  library: DocumentSpec[];
  busy: boolean;
  onOpen: () => void;
  /** Resolves false if the rename failed (the input then stays open with the typed name). */
  onRename: (title: string | null) => Promise<boolean>;
  onDelete: () => Promise<void>;
}

type RowMode = "view" | "rename" | "confirmDelete";

function DocumentRow({ doc, library, busy, onOpen, onRename, onDelete }: RowProps) {
  const [mode, setMode] = useState<RowMode>("view");
  const [title, setTitle] = useState("");
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  // Which button gets keyboard focus back when the row returns to view mode (it is unmounted until then).
  const returnFocusRef = useRef<"rename" | "delete" | null>(null);
  const name = documentTitle(doc.title, doc.draft, library);
  const type = library.find((d) => d.id === doc.draft.documentId)?.name ?? "No document chosen yet";

  useEffect(() => {
    if (mode !== "view" || !returnFocusRef.current) return;
    (returnFocusRef.current === "rename" ? renameRef : deleteRef).current?.focus();
    returnFocusRef.current = null;
  }, [mode]);

  function backToView(focusTarget: "rename" | "delete") {
    returnFocusRef.current = focusTarget;
    setMode("view");
  }

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    if (await onRename(title.trim() || null)) backToView("rename");
  }

  const linkButton = "text-sm font-medium text-stone-600 hover:text-stone-900 disabled:opacity-50";

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
      {mode === "rename" ? (
        <form onSubmit={handleRename} className="flex flex-1 flex-wrap items-center gap-2">
          <input
            aria-label="Document name"
            autoFocus
            maxLength={200}
            value={title}
            placeholder={documentTitle(null, doc.draft, library)}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200"
          />
          <button type="submit" className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-semibold text-white">
            Save
          </button>
          <button type="button" onClick={() => backToView("rename")} className={linkButton}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <button type="button" onClick={onOpen} disabled={busy} className="min-w-0 flex-1 text-left disabled:opacity-60">
            <span className="block truncate font-semibold text-stone-900 hover:underline">{name}</span>
            <span className="mt-0.5 block text-xs text-stone-500">
              {type} · Updated {formatUpdated(doc.updatedAt)}
            </span>
          </button>
          {mode === "confirmDelete" ? (
            <div role="group" aria-label={`Delete ${name}?`} className="flex shrink-0 items-center gap-4">
              <span className="text-sm text-stone-700">Delete this document?</span>
              <button
                type="button"
                autoFocus
                aria-label={`Confirm delete ${name}`}
                onClick={() => void onDelete()}
                className="text-sm font-semibold text-red-700"
              >
                Delete
              </button>
              <button type="button" onClick={() => backToView("delete")} className={linkButton}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-4">
              <button
                ref={renameRef}
                type="button"
                aria-label={`Rename ${name}`}
                onClick={() => {
                  setTitle(doc.title ?? "");
                  setMode("rename");
                }}
                className={linkButton}
              >
                Rename
              </button>
              <button
                ref={deleteRef}
                type="button"
                aria-label={`Delete ${name}`}
                onClick={() => setMode("confirmDelete")}
                className="text-sm font-medium text-stone-600 hover:text-red-700"
              >
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

interface DocumentListProps {
  library: DocumentSpec[];
  onOpen: (doc: SavedDocument | null) => void;
}

/** The signed-in user's documents, most recently updated first. */
export function DocumentList({ library, onOpen }: DocumentListProps) {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    api.listDocuments({ signal: abort.signal }).then(
      (docs) => {
        setDocuments(docs);
        setLoadFailed(false);
      },
      (err: unknown) => {
        if (abort.signal.aborted) return;
        console.error("Couldn't load documents", err);
        setLoadFailed(true);
      },
    );
    return () => abort.abort();
  }, [attempt]);

  /** Runs a list action, showing `failure` if it fails. */
  async function run<T>(action: () => Promise<T>, failure: string): Promise<T | undefined> {
    setError(null);
    try {
      return await action();
    } catch (err) {
      console.error(failure, err);
      setError(failure);
    }
  }

  async function open(id: number) {
    setOpening(id);
    const doc = await run(() => api.getDocument(id), "Couldn’t open the document. Please try again.");
    setOpening(null);
    if (doc) onOpen(doc);
  }

  async function rename(id: number, title: string | null): Promise<boolean> {
    const doc = await run(() => api.updateDocument(id, { title }), "Couldn’t rename the document.");
    if (!doc) return false;
    setDocuments((docs) => docs && docs.map((d) => (d.id === id ? { ...d, title: doc.title } : d)));
    return true;
  }

  async function remove(id: number) {
    const deleted = await run(() => api.deleteDocument(id).then(() => true), "Couldn’t delete the document.");
    if (!deleted) return;
    setDocuments((docs) => docs && docs.filter((d) => d.id !== id));
    // The row (and the focused button) is gone: continue from the list heading.
    headingRef.current?.focus();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 ref={headingRef} tabIndex={-1} data-view-heading className="text-lg font-semibold text-stone-900 focus:outline-none">
          My documents
        </h2>
        <button
          type="button"
          onClick={() => onOpen(null)}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-stone-700"
        >
          New document
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {loadFailed ? (
        <div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-6 text-center text-sm text-red-700">
          Couldn’t load your documents.{" "}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-semibold underline">
            Retry
          </button>
        </div>
      ) : documents === null ? (
        <p role="status" className="py-12 text-center text-sm text-stone-500">
          Loading your documents…
        </p>
      ) : documents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-10 text-center">
          <p className="font-medium text-stone-900">No documents yet</p>
          <p className="mt-1 text-sm text-stone-600">
            Start a new document and the assistant will help you choose and fill in the right agreement. It’s saved here
            as you go.
          </p>
        </div>
      ) : (
        <ul aria-label="Documents" className="space-y-3">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              library={library}
              busy={opening !== null}
              onOpen={() => void open(doc.id)}
              onRename={(title) => rename(doc.id, title)}
              onDelete={() => remove(doc.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
