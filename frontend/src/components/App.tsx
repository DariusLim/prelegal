"use client";

import { useEffect, useRef, useState } from "react";

import { AuthForm } from "@/components/AuthForm";
import { DocumentBuilder } from "@/components/DocumentBuilder";
import { DocumentList } from "@/components/DocumentList";
import { api, ApiError, UNAUTHORIZED_EVENT, type SavedDocument, type User } from "@/lib/api";
import type { DocumentSpec } from "@/lib/documents/types";

/** The documents list, or the editor on one document (`saved: null` is a new document). */
type View = { kind: "list" } | { kind: "editor"; saved: SavedDocument | null; key: number };

/**
 * Client-side app shell. The page is prerendered without a user; on load it
 * asks the backend who is signed in and shows either the sign-in form or the
 * user's documents. Any request rejected with 401 (e.g. an expired session)
 * returns to the sign-in form.
 */
export function App({ library }: { library: DocumentSpec[] }) {
  // undefined: still checking the session.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  const [sessionCheck, setSessionCheck] = useState(0);
  const [view, setView] = useState<View>({ kind: "list" });
  const editorCount = useRef(0);
  const mainRef = useRef<HTMLElement>(null);
  // Set when the user moves to another view, so focus follows to its heading (not on first load).
  const focusViewRef = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    api.me({ signal: abort.signal }).then(setUser, (err: unknown) => {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) setUser(null);
      else setSessionCheckFailed(true);
    });
    return () => abort.abort();
  }, [sessionCheck]);

  useEffect(() => {
    const signedOut = () => {
      focusViewRef.current = true;
      setUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, signedOut);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signedOut);
  }, []);

  // After a view change, move keyboard focus from the (now unmounted) control to the new view's heading.
  useEffect(() => {
    if (!focusViewRef.current) return;
    focusViewRef.current = false;
    mainRef.current?.querySelector<HTMLElement>("[data-view-heading]")?.focus();
  });

  function show(next: View) {
    focusViewRef.current = true;
    setView(next);
  }

  function signIn(signedIn: User) {
    show({ kind: "list" });
    setUser(signedIn);
  }

  async function signOut() {
    try {
      await api.logOut();
    } catch (error) {
      console.error("Sign-out failed", error);
    }
    focusViewRef.current = true;
    setUser(null);
  }

  function retrySessionCheck() {
    setSessionCheckFailed(false);
    setSessionCheck((n) => n + 1);
  }

  let content;
  if (sessionCheckFailed) {
    content = (
      <div role="alert" className="mx-auto max-w-sm rounded-lg border border-red-100 bg-red-50 p-6 text-center text-sm text-red-700">
        Couldn’t reach prelegal.{" "}
        <button type="button" onClick={retrySessionCheck} className="font-semibold underline">
          Retry
        </button>
      </div>
    );
  } else if (user === undefined) {
    content = (
      <p role="status" className="py-24 text-center text-sm text-stone-500">
        Loading…
      </p>
    );
  } else if (user === null) {
    content = <AuthForm onSignedIn={signIn} />;
  } else if (view.kind === "editor") {
    content = (
      <DocumentBuilder
        key={view.key}
        library={library}
        saved={view.saved}
        onClose={() => show({ kind: "list" })}
      />
    );
  } else {
    content = (
      <DocumentList
        library={library}
        onOpen={(saved) => show({ kind: "editor", saved, key: ++editorCount.current })}
      />
    );
  }

  return (
    <>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <p className="text-lg font-bold tracking-tight text-stone-900">prelegal</p>
          {user && (
            <div className="flex min-w-0 items-center gap-4 text-sm">
              <span className="hidden truncate text-stone-600 sm:inline">{user.email}</span>
              <button type="button" onClick={() => void signOut()} className="font-medium text-stone-700 hover:text-stone-900">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main ref={mainRef} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* The editor has its own h1 (the document's name). */}
        {(!user || view.kind === "list") && (
          <div className="mb-6 sm:mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-stone-900">Legal Document Creator</h1>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Chat with the assistant about the agreement you need. It picks the right Common Paper standard document,
              asks about the parties and key terms, and fills in the document as you answer, ready to download as a PDF.
            </p>
          </div>
        )}
        {content}
      </main>
    </>
  );
}
