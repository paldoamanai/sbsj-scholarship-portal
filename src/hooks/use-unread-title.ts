"use client";

import { useEffect } from "react";

/** Puts the unread count in the browser tab title, e.g. "(3) Student Dashboard". */
export function useUnreadTitle(unread: number) {
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
    return () => { document.title = base; };
  }, [unread]);
}
