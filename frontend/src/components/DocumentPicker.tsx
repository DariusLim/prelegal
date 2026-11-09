import type { DocumentSpec } from "@/lib/documents/types";

interface DocumentPickerProps {
  library: DocumentSpec[];
  disabled: boolean;
  onPick: (doc: DocumentSpec) => void;
}

/** Shown before a document is chosen: the supported documents, each a shortcut into the chat. */
export function DocumentPicker({ library, disabled, onPick }: DocumentPickerProps) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-stone-900">What would you like to create?</h2>
      <p className="mt-1 text-sm text-stone-600">
        Tell the assistant what you need, or pick one of the documents we can prepare. Your document will appear here
        and fill in as you chat.
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {library.map((doc) => (
          <li key={doc.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(doc)}
              className="h-full w-full rounded-md border border-stone-200 p-3 text-left hover:border-stone-400 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block text-sm font-semibold text-stone-900">{doc.name}</span>
              <span className="mt-1 block text-xs text-stone-600">{doc.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
