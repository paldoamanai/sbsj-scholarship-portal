// Desktop alerts: a browser notification when something arrives while this tab is in the background.
// A per-device choice (stored in this browser), separate from the account's notification preferences.
// It works only while the site is open in a tab; it is not push.

const KEY = "sbsj-desktop-alerts";

export const desktopAlertsSupported = () => typeof window !== "undefined" && "Notification" in window;

export function desktopAlertsEnabled(): boolean {
  if (!desktopAlertsSupported() || Notification.permission !== "granted") return false;
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Asks the browser for permission and turns alerts on. Resolves to the permission the browser ended up with. */
export async function enableDesktopAlerts(): Promise<NotificationPermission> {
  if (!desktopAlertsSupported()) return "denied";
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  try { localStorage.setItem(KEY, permission === "granted" ? "1" : "0"); } catch { /* private mode */ }
  return permission;
}

export function disableDesktopAlerts() {
  try { localStorage.setItem(KEY, "0"); } catch { /* private mode */ }
}

/** Shows an alert only when the tab is hidden (the in-page toast covers the visible case). */
export function showDesktopAlert(n: { id: string; title: string; message: string }, onClick?: () => void) {
  if (!desktopAlertsEnabled() || !document.hidden) return;
  const alert = new Notification(n.title, { body: n.message, tag: n.id });
  alert.onclick = () => { window.focus(); onClick?.(); alert.close(); };
}
