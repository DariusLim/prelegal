import type { NdaFormData, NdaUpdates } from "./types";

/** Merges the assistant's field updates into the form data, party details field by field. */
export function applyUpdates(data: NdaFormData, updates: NdaUpdates): NdaFormData {
  const { party1, party2, ...fields } = updates;
  return {
    ...data,
    ...fields,
    party1: { ...data.party1, ...party1 },
    party2: { ...data.party2, ...party2 },
  };
}
