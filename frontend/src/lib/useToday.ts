import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

function localIsoDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Today's date in the viewer's timezone (YYYY-MM-DD), or "" while
 * prerendering. Reading it through useSyncExternalStore keeps the build-time
 * HTML and the first client render in agreement, avoiding hydration errors.
 */
export function useToday(): string {
  return useSyncExternalStore(subscribe, localIsoDate, () => "");
}
