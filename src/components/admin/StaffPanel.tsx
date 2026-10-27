"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy, History, KeyRound, Loader2, LogOut, MailPlus, MoreHorizontal, Pencil, Search, ShieldCheck, Trash2, UserMinus, UserPlus,
} from "@/components/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OFFICE_FULL_NAME, OFFICE_LABEL, ROLE_DESCRIPTION, ROLE_LABEL, STAFF_OFFICES, STAFF_ROLES, isOffice, roleCanHaveOffice, staffLabel, type StaffRole,
} from "@/lib/permissions";

type Props = {
  userId: string;
  /** Called after a role changes, so the page can reload the audit log and the signed-in user's role. */
  onChanged: () => void;
  /** Opens the audit log filtered to everything this staff member did. */
  onShowActivity?: (userId: string) => void;
  /** Set for an office Admin: they manage only this office's Reviewer and Finance accounts (migration 065). */
  managerOffice?: string | null;
};

/** The roles an office Admin can give. */
const OFFICE_ADMIN_ROLES: StaffRole[] = ["reviewer", "finance_admin"];

type Person = {
  id: string; email: string | null; name: string; firstName: string; lastName: string; role: string; office: string | null;
};
type Profile = { id: string; email: string | null; first_name: string | null; last_name: string | null };
type Security = { lastSignInAt: string | null; invited: boolean };
/** `to` is the new role ("student" removes staff access); `office` the office it comes with. */
type Pending = { person: Person; to: string; office: string | null };
type SecAction = { person: Person; action: "sign_out" | "reset_password" | "resend_invite" | "cancel_invite" | "delete_account" };
type Editing = { person: Person; firstName: string; lastName: string; email: string };

const nameOf = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unnamed account";
const toPerson = (id: string, p: Profile | undefined, roleRow: { role?: unknown; office?: string | null } | null | undefined): Person => ({
  id, email: p?.email ?? null, name: p ? nameOf(p) : "Unknown account", firstName: p?.first_name ?? "", lastName: p?.last_name ?? "",
  role: (roleRow?.role as string) ?? "student", office: roleRow?.office ?? null,
});
/** Each word of a search, made safe for a PostgREST or() filter and a LIKE pattern. */
const searchTerms = (q: string) =>
  q.split(/\s+/).map((w) => w.replace(/[,()"]/g, "").replace(/[\\%_]/g, "\\$&")).filter(Boolean);
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "Never");
const ORDER = (p: Person) => (STAFF_ROLES as readonly string[]).indexOf(p.role) * 10 + (p.office ? STAFF_OFFICES.indexOf(p.office as never) + 1 : 0);
/** Select value for "no office", since a Select item can't be empty. */
const ALL = "all";

const SEC_COPY: Record<SecAction["action"], { title: (n: string) => string; body: (n: string) => string; done: string }> = {
  sign_out: {
    title: (n) => `Sign ${n} out everywhere?`,
    body: (n) => `Ends every session ${n} has. Each device is signed out within the hour (when its current sign-in token expires). Use this if a device was lost or shared.`,
    done: "Signed out everywhere",
  },
  reset_password: {
    title: (n) => `Send ${n} a password reset link?`,
    body: () => "They get an email with a one-time link to choose a new password. Their current password keeps working until they do.",
    done: "Password reset link created",
  },
  resend_invite: {
    title: (n) => `Send ${n} a new invite link?`,
    body: () => "They get a fresh link to set their password, at the role they already have. Any earlier link stops working.",
    done: "New invite link sent",
  },
  cancel_invite: {
    title: (n) => `Cancel ${n}'s invite?`,
    body: (n) => `Deletes the account created for ${n}, so their invite link stops working. You can invite them again later.`,
    done: "Invite cancelled",
  },
  delete_account: {
    title: (n) => `Delete ${n}'s account?`,
    body: (n) => `Permanently deletes ${n}'s login. They are signed out and can't sign in again, and the email can be used for a new account. Programs, reviews and payments they worked on stay; the audit log keeps a record of what they did. This can't be undone. To keep the account but take away admin access, use Remove staff access instead.`,
    done: "Account deleted",
  },
};

/** Super admin page: who has staff access, their roles and account security, and adding new staff. */
export default function StaffPanel({ userId, onChanged, onShowActivity, managerOffice = null }: Props) {
  const scoped = isOffice(managerOffice);
  const givableRoles = scoped ? OFFICE_ADMIN_ROLES : STAFF_ROLES;
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<Person[]>([]);
  const [security, setSecurity] = useState<Record<string, Security>>({});
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [found, setFound] = useState<Person | null>(null);
  const [searching, setSearching] = useState(false);
  const [newRole, setNewRole] = useState("reviewer");
  const [newOffice, setNewOffice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [secAction, setSecAction] = useState<SecAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({ email: "", firstName: "", lastName: "", role: "reviewer", office: managerOffice });
  const [inviting, setInviting] = useState(false);
  const [confirmInvite, setConfirmInvite] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  // A link to hand over in person when the portal can't send email.
  const [shareLink, setShareLink] = useState<{ title: string; link: string; reason?: string } | null>(null);

  const loadSecurity = useCallback(async () => {
    const res = await fetch("/api/admin/staff").catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) { setSecurityError(body?.error ?? "Could not load sign-in details"); return; }
    setSecurityError(null);
    setSecurity(Object.fromEntries((body.staff as (Security & { id: string })[]).map((s) => [s.id, s])));
  }, []);

  const load = useCallback(async () => {
    const { data: roles, error } = await supabase.from("user_roles").select("*").neq("role", "student"); // "*": works before migration 060 too
    if (error) { toast.error("Could not load staff", { description: error.message }); setLoading(false); return; }
    const ids = (roles ?? []).map((r) => r.user_id);
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("id, email, first_name, last_name").in("id", ids)
      : { data: [] };
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));
    setStaff((roles ?? [])
      .map((r) => toPerson(r.user_id, byId.get(r.user_id), r))
      // An office Admin sees themselves and the team they manage.
      .filter((p) => !scoped || p.id === userId || (OFFICE_ADMIN_ROLES.includes(p.role as StaffRole) && p.office === managerOffice))
      .sort((a, b) => ORDER(a) - ORDER(b) || a.name.localeCompare(b.name)));
    setLoading(false);
    loadSecurity();
  }, [supabase, loadSecurity, scoped, managerOffice, userId]);
  useEffect(() => { load(); }, [load]);

  const hasSuperAdmin = staff.some((s) => s.role === "super_admin");
  const me = staff.find((s) => s.id === userId);

  const pick = (p: Person) => {
    setFound(p);
    setNewRole("reviewer");
    setNewOffice(null);
  };

  /** Finds accounts by part of their email or name; every word must match one of them. */
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const terms = searchTerms(email.trim());
    if (!terms.length) return;
    setSearching(true);
    setFound(null);
    setResults(null);
    let query = supabase.from("profiles").select("id, email, first_name, last_name");
    for (const t of terms) query = query.or(`email.ilike.%${t}%,first_name.ilike.%${t}%,last_name.ilike.%${t}%`);
    const { data: profs, error } = await query.order("last_name").limit(10);
    if (error) { setSearching(false); toast.error("Search failed", { description: error.message }); return; }
    if (!profs?.length) { setSearching(false); toast.error("No matching account", { description: "Use Invite new staff to create one." }); return; }
    const { data: roles } = await supabase.from("user_roles").select("*").in("user_id", profs.map((p) => p.id));
    const roleOf = new Map((roles ?? []).map((r) => [r.user_id, r]));
    const people = profs.map((p) => toPerson(p.id, p, roleOf.get(p.id)));
    setResults(people);
    if (people.length === 1) pick(people[0]);
    setSearching(false);
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    // End their sessions first: once they are a student, the staff API no longer acts on the account.
    if (pending.to === "student") {
      const r = await post({ action: "sign_out", userId: pending.person.id });
      if (!r.ok) { setBusy(false); setPending(null); toast.error("Staff access not removed", { description: r.error }); return; }
    }
    const { person, to, office } = pending;
    const nextOffice = roleCanHaveOffice(to) ? office ?? null : null;
    const currentOffice = roleCanHaveOffice(person.role) ? person.office ?? null : null;
    let error: { message: string } | null = null;
    // Role and office change together or not at all, so a failed office change can't leave an
    // account with access to every office.
    if (to !== person.role || nextOffice !== currentOffice) {
      ({ error } = await supabase.rpc("set_staff_access", { _user_id: person.id, _role: to, _office: nextOffice }));
    }
    setBusy(false);
    setPending(null);
    if (error) {
      toast.error("Role not changed", { description: pending.to === "student" ? `${error.message} They were signed out, but still have staff access.` : error.message });
      return;
    }
    toast.success(`${pending.person.name} is now ${pending.to === "student" ? "a student account" : staffLabel(pending.to, pending.office)}`);
    setFound(null);
    setResults(null);
    setEmail("");
    await load();
    onChanged();
  };

  const post = async (payload: Record<string, string>) => {
    const res = await fetch("/api/admin/staff", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    return res?.ok ? { ok: true as const, body } : { ok: false as const, error: (body?.error as string) ?? "Request failed" };
  };

  const runSecAction = async () => {
    if (!secAction) return;
    setBusy(true);
    const r = await post({ action: secAction.action, userId: secAction.person.id });
    setBusy(false);
    const { person, action } = secAction;
    setSecAction(null);
    if (!r.ok) { toast.error("Not done", { description: r.error }); return; }
    const emailed = action === "reset_password" || action === "resend_invite";
    if (r.body?.link) {
      setShareLink({ title: `${action === "resend_invite" ? "New invite" : "Password reset"} link for ${person.name}`, link: r.body.link, reason: r.body.reason });
    } else toast.success(SEC_COPY[action].done, { description: emailed ? `Emailed to ${person.email}` : undefined });
    if (action === "cancel_invite" || action === "delete_account") await load();
    else loadSecurity();
    onChanged();
  };

  const sendInvite = async () => {
    setInviting(true);
    const r = await post({ action: "invite", ...invite, office: invite.office ?? "" });
    setInviting(false);
    setConfirmInvite(false);
    if (!r.ok) { toast.error("Invite not sent", { description: r.error }); return; }
    const label = staffLabel(invite.role, invite.office);
    if (r.body?.updated) toast.info(`Their earlier invite was still pending, so it now gives ${label} access.`);
    if (r.body?.link) setShareLink({ title: `${r.body.resent ? "New invite" : "Invite"} link for ${invite.firstName}`, link: r.body.link, reason: r.body.reason });
    else toast.success(r.body?.resent ? `They hadn't finished their invite. A new link was emailed to ${invite.email}` : `Invite emailed to ${invite.email}`);
    setInvite({ email: "", firstName: "", lastName: "", role: "reviewer", office: managerOffice });
    await load();
    onChanged();
  };

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    const { person, firstName, lastName, email: newEmail } = editing;
    const r = await post({ action: "update_details", userId: person.id, firstName, lastName, email: newEmail });
    setBusy(false);
    if (!r.ok) { toast.error("Details not saved", { description: r.error }); return; }
    setEditing(null);
    toast.success("Details saved", { description: r.body?.emailChanged ? `They now sign in with ${newEmail.trim().toLowerCase()}.` : undefined });
    await load();
    onChanged();
  };

  /** What a role and office let someone do. */
  const access = (role: string, office: string | null) => {
    const scope = isOffice(office) && roleCanHaveOffice(role)
      ? ` Only sees ${OFFICE_FULL_NAME[office]} programs, and their applicants and payments.`
      : roleCanHaveOffice(role) ? " Works across all offices." : "";
    return `${staffLabel(role, office)}: ${ROLE_DESCRIPTION[role as StaffRole] ?? ""}${scope}`;
  };

  const describe = (p: Pending) => {
    if (p.to === "student") return `${p.person.name} loses access to the admin panel straight away, is signed out everywhere and becomes a regular student account.`;
    if (p.to === "super_admin" && p.person.id === userId) {
      return "You become the first Mayor Office account. From then on, only Mayor Office accounts can change settings and manage staff.";
    }
    return access(p.to, p.office);
  };

  const roleSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-36"><SelectValue>{ROLE_LABEL[value] ?? value}</SelectValue></SelectTrigger>
      <SelectContent>{givableRoles.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
    </Select>
  );

  const officeSelect = (value: string | null, onChange: (v: string | null) => void, disabled = false) => scoped ? (
    // An office Admin's staff stay in their office.
    <span className="flex h-10 items-center text-sm">{OFFICE_LABEL[managerOffice as keyof typeof OFFICE_LABEL]}</span>
  ) : (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)} disabled={disabled}>
      <SelectTrigger className="w-52"><SelectValue>{disabled ? "—" : isOffice(value) ? OFFICE_LABEL[value] : "All offices"}</SelectValue></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All offices</SelectItem>
        {STAFF_OFFICES.map((o) => <SelectItem key={o} value={o}>{OFFICE_LABEL[o]}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4 animate-fade-in max-w-5xl">
      <h2 className="text-xl font-display font-bold">Staff</h2>

      {!loading && !hasSuperAdmin && !scoped && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="pt-6 space-y-3 text-sm">
            <p><strong>There is no Mayor Office account yet.</strong> Until there is one, every admin can change settings and manage staff.</p>
            {me && (
              <Button size="sm" onClick={() => setPending({ person: me, to: "super_admin", office: null })}>
                <ShieldCheck className="mr-2 h-4 w-4" />Make me the Mayor Office
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff accounts</CardTitle>
          <CardDescription>{scoped
            ? <>The Reviewer and Finance staff of {OFFICE_FULL_NAME[managerOffice as keyof typeof OFFICE_FULL_NAME]}, which you manage. Other staff are managed by the Mayor Office. You can&apos;t change your own role or security here.</>
            : <>Everyone who can sign in to the admin panel. You can&apos;t change your own role or security here.</>}</CardDescription>
        </CardHeader>
        <CardContent>
          {securityError && <p className="mb-3 text-xs text-muted-foreground">Sign-in details unavailable: {securityError}</p>}
          {loading ? (
            <div className="space-y-3 py-1" aria-busy>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="hidden h-4 w-24 sm:block" />
                  <Skeleton className="h-8 w-8 rounded-md" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Office</TableHead><TableHead>Status</TableHead>
                    <TableHead>Last sign-in</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.map((s) => {
                    const self = s.id === userId;
                    const sec = security[s.id];
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <p className="font-medium">{s.name}{self && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</p>
                          <p className="text-xs text-muted-foreground break-all">{s.email ?? "—"}</p>
                        </TableCell>
                        <TableCell>
                          {self ? <span className="text-sm">{ROLE_LABEL[s.role] ?? s.role}</span>
                            : roleSelect(s.role, (to) => setPending({ person: s, to, office: roleCanHaveOffice(to) ? s.office : null }))}
                        </TableCell>
                        <TableCell>
                          {self ? <span className="text-sm">{roleCanHaveOffice(s.role) && isOffice(s.office) ? OFFICE_LABEL[s.office] : "All offices"}</span>
                            : officeSelect(roleCanHaveOffice(s.role) ? s.office : null, (office) => setPending({ person: s, to: s.role, office }), !roleCanHaveOffice(s.role))}
                        </TableCell>
                        <TableCell>
                          {!sec ? <span className="text-muted-foreground">—</span>
                            : sec.invited ? <Badge variant="outline">Invite pending</Badge>
                            : <Badge variant="secondary">Active</Badge>}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{sec ? fmt(sec.lastSignInAt) : "—"}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Actions for ${s.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {onShowActivity && (
                                <DropdownMenuItem onClick={() => onShowActivity(s.id)}><History className="mr-2 h-4 w-4" />View activity</DropdownMenuItem>
                              )}
                              {!self && (
                                <DropdownMenuItem onClick={() => setEditing({ person: s, firstName: s.firstName, lastName: s.lastName, email: s.email ?? "" })}>
                                  <Pencil className="mr-2 h-4 w-4" />Edit name and email
                                </DropdownMenuItem>
                              )}
                              {!self && sec?.invited && <>
                                <DropdownMenuItem onClick={() => setSecAction({ person: s, action: "resend_invite" })}><MailPlus className="mr-2 h-4 w-4" />Resend invite</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setSecAction({ person: s, action: "cancel_invite" })}>
                                  <UserMinus className="mr-2 h-4 w-4" />Cancel invite
                                </DropdownMenuItem>
                              </>}
                              {!self && !sec?.invited && <>
                                <DropdownMenuItem onClick={() => setSecAction({ person: s, action: "reset_password" })}><KeyRound className="mr-2 h-4 w-4" />Send password reset</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSecAction({ person: s, action: "sign_out" })}><LogOut className="mr-2 h-4 w-4" />Sign out everywhere</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setPending({ person: s, to: "student", office: null })}>
                                  <UserMinus className="mr-2 h-4 w-4" />Remove staff access
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setSecAction({ person: s, action: "delete_account" })}>
                                  <Trash2 className="mr-2 h-4 w-4" />Delete account
                                </DropdownMenuItem>
                              </>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className={cn("grid gap-4", !scoped && "lg:grid-cols-2")}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite new staff</CardTitle>
            <CardDescription>Creates the account and emails them a link to set a password. Use this for people who don&apos;t have a portal account yet. If an earlier invite expired before they set a password, invite them again for a new link.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setConfirmInvite(true); }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label htmlFor="inv-first">First name</Label>
                  <Input id="inv-first" value={invite.firstName} onChange={(e) => setInvite({ ...invite, firstName: e.target.value })} required /></div>
                <div className="space-y-1"><Label htmlFor="inv-last">Last name</Label>
                  <Input id="inv-last" value={invite.lastName} onChange={(e) => setInvite({ ...invite, lastName: e.target.value })} required /></div>
              </div>
              <div className="space-y-1"><Label htmlFor="inv-email">Email</Label>
                <Input id="inv-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required /></div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1"><Label>Role</Label>{roleSelect(invite.role, (role) => setInvite({ ...invite, role, office: roleCanHaveOffice(role) ? invite.office : null }))}</div>
                <div className="space-y-1"><Label>Office</Label>{officeSelect(invite.office, (office) => setInvite({ ...invite, office }), !roleCanHaveOffice(invite.role))}</div>
                <Button type="submit" disabled={inviting}>
                  {inviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}Send invite
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Office Admins invite new accounts only: promoting an existing one is for the Mayor Office. */}
        {!scoped && <Card>
          <CardHeader>
            <CardTitle className="text-base">Add existing account</CardTitle>
            <CardDescription>Give staff access to someone who already registered. Search by name or email. An account that has applied for a scholarship can&apos;t be made staff.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form className="flex gap-2" onSubmit={search}>
              <Input value={email} placeholder="Name or email" aria-label="Name or email" onChange={(e) => { setEmail(e.target.value); setFound(null); setResults(null); }} />
              <Button type="submit" variant="outline" disabled={searching || !email.trim()}>
                {searching ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}Find
              </Button>
            </form>
            {results && results.length > 1 && (
              <ul className="rounded-lg border divide-y text-sm">
                {results.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => pick(p)}
                      className={`w-full px-3 py-2 text-left hover:bg-muted/60 ${found?.id === p.id ? "bg-muted" : ""}`}>
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground break-all">{p.email ?? "—"} · {staffLabel(p.role, p.office)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {results?.length === 10 && <p className="text-xs text-muted-foreground">Showing the first 10 matches. Type more of the name or email to narrow it down.</p>}
            {found && (
              <div className="rounded-lg border p-3 space-y-3">
                <div>
                  <p className="font-medium">{found.name}</p>
                  <p className="text-xs text-muted-foreground">{found.email} · currently {staffLabel(found.role, found.office)}</p>
                </div>
                {found.role === "student" ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1"><Label>Give them</Label>{roleSelect(newRole, (r) => { setNewRole(r); if (!roleCanHaveOffice(r)) setNewOffice(null); })}</div>
                    <div className="space-y-1"><Label>Office</Label>{officeSelect(newOffice, setNewOffice, !roleCanHaveOffice(newRole))}</div>
                    <Button onClick={() => setPending({ person: found, to: newRole, office: roleCanHaveOffice(newRole) ? newOffice : null })}><UserPlus className="mr-2 h-4 w-4" />Add as staff</Button>
                  </div>
                ) : <p className="text-sm text-muted-foreground">This account is already staff. Change its role in the list above.</p>}
              </div>
            )}
          </CardContent>
        </Card>}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">What each role can do</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          {givableRoles.map((r) => <p key={r}><strong>{ROLE_LABEL[r]}</strong>: {ROLE_DESCRIPTION[r]}</p>)}
          {scoped ? <p>Staff you add belong to {OFFICE_FULL_NAME[managerOffice as keyof typeof OFFICE_FULL_NAME]} and only see its programs, and their applicants, documents and payments. For an Admin account or a move to another office, ask the Mayor Office.</p> : <>
          <p><strong>Office</strong>: an Admin, Reviewer or Finance account can belong to {STAFF_OFFICES.map((o) => OFFICE_FULL_NAME[o]).join(" or ")}. It keeps its role&apos;s permissions, but only sees that office&apos;s programs and their applicants, documents and payments. &ldquo;All offices&rdquo; works across the whole municipality.</p>
          <p className="text-xs text-muted-foreground">Every staff role can view programs, applicants, students and payments. Keep one or two Mayor Office accounts, so someone can still manage staff if one person loses access. Every change on this page is recorded in the audit log.</p>
          </>}
        </CardContent>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              {pending?.to === "student" ? `Remove ${pending.person.name}'s staff access?` : `Make ${pending?.person.id === userId ? "yourself" : pending?.person.name} ${staffLabel(pending?.to ?? "", pending?.office)}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>{pending && describe(pending)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); apply(); }}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmInvite} onOpenChange={(o) => !o && !inviting && setConfirmInvite(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Invite {invite.firstName} {invite.lastName} as {staffLabel(invite.role, invite.office)}?</AlertDialogTitle>
            <AlertDialogDescription>
              {access(invite.role, invite.office)} A link to set their password goes to {invite.email.trim()}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={inviting}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={inviting} onClick={(e) => { e.preventDefault(); sendInvite(); }}>
              {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send invite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!editing} onOpenChange={(o) => !o && !busy && setEditing(null)}>
        <AlertDialogContent>
          <form className="space-y-4" onSubmit={saveDetails}>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display">Edit {editing?.person.name}</AlertDialogTitle>
              <AlertDialogDescription>A new email takes effect straight away: they sign in with it from now on, and links go there.</AlertDialogDescription>
            </AlertDialogHeader>
            {editing && <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label htmlFor="edit-first">First name</Label>
                  <Input id="edit-first" value={editing.firstName} onChange={(e) => setEditing({ ...editing, firstName: e.target.value })} required /></div>
                <div className="space-y-1"><Label htmlFor="edit-last">Last name</Label>
                  <Input id="edit-last" value={editing.lastName} onChange={(e) => setEditing({ ...editing, lastName: e.target.value })} required /></div>
              </div>
              <div className="space-y-1"><Label htmlFor="edit-email">Email</Label>
                <Input id="edit-email" type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} required /></div>
            </>}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={busy}>Cancel</AlertDialogCancel>
              <Button type="submit" disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!secAction} onOpenChange={(o) => !o && !busy && setSecAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{secAction && SEC_COPY[secAction.action].title(secAction.person.name)}</AlertDialogTitle>
            <AlertDialogDescription>{secAction && SEC_COPY[secAction.action].body(secAction.person.name)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); runSecAction(); }}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!shareLink} onOpenChange={(o) => !o && setShareLink(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{shareLink?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {shareLink?.reason ?? "The email could not be sent."} Give them this one-time link yourself, in person or through a private message. Anyone with the link can sign in to this account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input readOnly value={shareLink?.link ?? ""} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(shareLink?.link ?? ""); toast.success("Link copied"); }}>
              <Copy className="mr-2 h-4 w-4" />Copy link
            </Button>
            <AlertDialogAction>Done</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
