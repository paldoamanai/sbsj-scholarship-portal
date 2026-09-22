// Explicitly asks the browser to remember a username/password pair via the
// Credential Management API, instead of relying only on the browser's own
// heuristic "save password?" prompt after a form submit.
//
// Supported in Chrome/Edge/Chromium browsers; Safari and Firefox don't implement
// `PasswordCredential`/`credentials.store()`, so this silently does nothing there —
// the native save-password prompt (triggered by the real <form> submit) still
// applies on every browser regardless of this call.
export async function rememberCredential(email: string, password: string) {
  try {
    if (typeof window === "undefined" || !email || !password) return;
    type PasswordCredentialCtor = new (data: { id: string; password: string; name?: string }) => Credential;
    const w = window as unknown as { PasswordCredential?: PasswordCredentialCtor };
    if (!w.PasswordCredential || !navigator.credentials?.store) return;
    const credential = new w.PasswordCredential({ id: email, password, name: email });
    await navigator.credentials.store(credential);
  } catch {
    // Not supported, not a secure context, or the user dismissed it — ignore.
  }
}
