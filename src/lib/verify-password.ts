// Checks a signed-in person's current password (before changing it) through the counted sign-in
// route, so it can't be guessed here without the 3-try pause (migration 077).
export async function verifyCurrentPassword(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, verifyOnly: true }),
    });
    const json = await res.json().catch(() => ({})) as { verified?: boolean; error?: string; code?: string };
    if (res.ok && json.verified) return { ok: true };
    return { ok: false, message: json.code === "invalid_credentials" ? (json.error ?? "Current password is incorrect").replace(/^Wrong email or password\./, "Current password is incorrect.") : json.error ?? "Could not check your password" };
  } catch {
    return { ok: false, message: "Network error. Please try again." };
  }
}
