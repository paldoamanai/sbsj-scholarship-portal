"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AVATAR_BUCKET, avatarPath } from "@/lib/avatar";

// Signed URLs are short-lived; reuse them within a session.
const cache = new Map<string, { url: string; expires: number }>();

/** A profile photo from the private bucket. Renders `fallback` while loading or when there is no photo. */
export default function ProfileImage({ value, alt = "", className, fallback = null }: {
  value: string | null | undefined;
  alt?: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const path = avatarPath(value);
  const [url, setUrl] = useState<string | null>(() => (path ? cache.get(path)?.url ?? null : null));

  useEffect(() => {
    if (!path) { setUrl(null); return; }
    const hit = cache.get(path);
    if (hit && hit.expires > Date.now()) { setUrl(hit.url); return; }
    let cancelled = false;
    createClient().storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600).then(({ data }) => {
      if (cancelled || !data?.signedUrl) return;
      cache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
      setUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [path]);

  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={alt} className={className} /> : <>{fallback}</>;
}
