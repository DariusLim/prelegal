"use client";

import { useId, useState, type FormEvent } from "react";

import { api, ApiError, type User } from "@/lib/api";

const MIN_PASSWORD_LENGTH = 8;

/** Sign in, or create an account (toggled), then hand the user to `onSignedIn`. */
export function AuthForm({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hintId = useId();
  const signingUp = mode === "signUp";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const credentials = { email: email.trim(), password };
      onSignedIn(await (signingUp ? api.signUp(credentials) : api.logIn(credentials)));
    } catch (err) {
      setError(err instanceof ApiError && err.detail ? err.detail : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(signingUp ? "signIn" : "signUp");
    setError(null);
  }

  const inputClass =
    "mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200";

  return (
    <div className="mx-auto w-full max-w-sm rounded-lg border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 tabIndex={-1} data-view-heading className="text-xl font-semibold text-stone-900 focus:outline-none">
        {signingUp ? "Create your account" : "Sign in"}
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        {signingUp
          ? "Your documents are saved to your account as you draft them."
          : "Sign in to draft agreements and pick up where you left off."}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block text-sm font-medium text-stone-700">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            maxLength={320}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium text-stone-700">
          Password
          <input
            type="password"
            required
            minLength={signingUp ? MIN_PASSWORD_LENGTH : undefined}
            maxLength={128}
            autoComplete={signingUp ? "new-password" : "current-password"}
            aria-describedby={signingUp ? hintId : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        {signingUp && (
          <p id={hintId} className="-mt-2 text-xs text-stone-500">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          aria-disabled={busy}
          className="w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-stone-700 aria-disabled:cursor-wait aria-disabled:opacity-60"
        >
          {busy ? (signingUp ? "Creating account…" : "Signing in…") : signingUp ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-stone-600">
        {signingUp ? "Already have an account?" : "New to prelegal?"}{" "}
        <button type="button" onClick={switchMode} className="font-semibold text-stone-900 underline">
          {signingUp ? "Sign in" : "Create an account"}
        </button>
      </p>
    </div>
  );
}
