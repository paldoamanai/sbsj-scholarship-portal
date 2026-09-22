"use client";

import { useEffect, useRef } from "react";

/**
 * Makes an in-page value (a dashboard section, a wizard step) part of the browser history, so the
 * browser back/forward buttons, the site's swipe gestures and trackpad swipes move between values
 * instead of leaving the page.
 *
 * Each change pushes a history entry that remembers the value; going back/forward restores it.
 * `canRestore` can veto a restore (e.g. a wizard step the user hasn't reached yet).
 */
export function useHistorySync<T extends string | number>(
  key: string,
  value: T,
  setValue: (v: T) => void,
  canRestore?: (v: T) => boolean
) {
  const restoring = useRef(false);
  const ready = useRef(false);
  const latest = useRef({ value, setValue, canRestore });
  latest.current = { value, setValue, canRestore };

  useEffect(() => {
    const saved = window.history.state?.[key] as T | undefined;
    if (saved !== undefined && saved !== latest.current.value && (!canRestore || canRestore(saved))) {
      // Returning to a page whose entry remembers a value.
      restoring.current = true;
      latest.current.setValue(saved);
    } else if (saved !== latest.current.value) {
      window.history.replaceState({ ...window.history.state, [key]: latest.current.value }, "");
    }
    ready.current = true;

    const onPop = (e: PopStateEvent) => {
      const v = e.state?.[key] as T | undefined;
      const cur = latest.current;
      if (v === undefined || v === cur.value) return;
      if (cur.canRestore && !cur.canRestore(v)) {
        // Not allowed there: put the current value back on this entry.
        window.history.replaceState({ ...window.history.state, [key]: cur.value }, "");
        return;
      }
      restoring.current = true;
      cur.setValue(v);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    if (restoring.current) {
      restoring.current = false;
      return;
    }
    if (window.history.state?.[key] === value) return;
    window.history.pushState({ ...window.history.state, [key]: value }, "");
  }, [key, value]);
}
