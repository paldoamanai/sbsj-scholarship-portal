"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy, History, KeyRound, Loader2, LogOut, MailPlus, MoreHorizontal, Search, ShieldCheck, ShieldOff, UserMinus, UserPlus,
} from "lucide-react";
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
import { ROLE_DESCRIPTION, ROLE_LABEL, STAFF_ROLES } from "@/lib/permissions";

type Props = {
  userId: string;
  /** Called after a role changes, so the page can reload the audit log and the signed-in user's role. */
  onChanged: () => void;
  /** Opens the audit log filtered to everything this staff member did. */
  onShowActivity?: (userId: string) => void;
};

type Person = { id: string; email: string | null; name: string; role: string };
type Security = { lastSignInAt: string | null; mfa: boolean; invited: boolean };
type Pending = { person: Person; to: string };
type SecAction = { person: Person; action: "reset_mfa" | "sign_out" | "reset_password" };

const nameOf = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unnamed account";
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "Never");
const ORDER = (r: string) => (STAFF_ROLES as readonly string[]).indexOf(r);

const SEC_COPY: Record<SecAction["action"], { title: (n: string) => string; body: (n: string) => string; done: string }> = {
  reset_mfa: {
    title: (n) => `Turn off two-factor for ${n}?`,
    body: (n) => `Removes ${n}'s authenticator and signs them out everywhere. Use this when they lost their phone. They should set up two-factor again from their Profile page.`,
    done: "Two-factor removed",
  },
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
};

/** Super admin page: who has staff access, their roles and account security, and adding new staff. */
export default function StaffPanel({ userId, onChanged, onShowActivity }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<Person[]>([]);
  const [security, setSecurity] = useState<Record<string, Security>>({});
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<Person | null>(null);
  const [searching, setSearching] = useState(false);
  const [newRole, setNewRole] = useState("reviewer");
  const [pending, setPending] = useState<Pending | null>(null);
  const [secAction, setSecAction] = useState<SecAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({ email: "", firstName: "", lastName: "", role: "reviewer" });
  const [inviting, setInviting] = useState(false);
  // A link to hand over in person when the portal can't send email.
  const [shareLink, setShareLink] = useState<{ title: string; link: string } | null>(null);

  const loadSecurity = useCallback(async () => {
    const res = await fetch("/api/admin/staff").catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) { setSecurityError(body?.error ?? "Could not load sign-in details"); return; }
    setSecurityError(null);
    setSecurity(Object.fromEntries((body.staff as (Security & { id: string })[]).map((s) => [s.id, s])));
  }, []);

  const load = useCallback(async () => {
    const { data: roles, error } = await supabase.from("user_roles").select("user_id, role").neq("role", "student");
    if (error) { toast.error("Could not load staff", { description: error.message }); setLoading(false); return; }
    const ids = (roles ?? []).map((r) => r.user_id);
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("id, email, first_name, last_name").in("id", ids)
      : { data: [] };
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));
    setStaff((roles ?? [])
      .map((r) => {
        const p = byId.get(r.user_id);
        return { id: r.user_id, email: p?.email ?? null, name: p ? nameOf(p) : "Unknown account", role: r.role as string };
      })
      .sort((a, b) => ORDER(a.role) - ORDER(b.role) || a.name.localeCompare(b.name)));
    setLoading(false);
    loadSecurity();
  }, [supabase, loadSecurity]);
  useEffect(() => { load(); }, [load]);

  const hasSuperAdmin = staff.some((s) => s.role === "super_admin");
  const me = staff.find((s) => s.id === userId);
  const withoutTwoFactor = staff.filter((s) => security[s.id] && !security[s.id].mfa && !security[s.id].invited).length;

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = email.trim();
    if (!q) return;
    setSearching(true);
    setFound(null);
    // Escape LIKE wildcards: "_" is common in email addresses.
    const { data: prof } = await supabase.from("profiles").select("id, email, first_name, last_name")
      .ilike("email", q.replace(/[\\%_]/g, "\\$&")).maybeSingle();
    if (!prof) { setSearching(false); toast.error("No account with that email", { description: "Use Invite new staff below to create one." }); return; }
    const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", prof.id).maybeSingle();
    setFound({ id: prof.id, email: prof.email, name: nameOf(prof), role: (roleRow?.role as string) ?? "student" });
    setNewRole("reviewer");
    setSearching(false);
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_user_role", { _user_id: pending.person.id, _role: pending.to });
    setBusy(false);
    setPending(null);
    if (error) { toast.error("Role not changed", { description: error.message }); return; }
    toast.success(`${pending.person.name} is now ${pending.to === "student" ? "a student account" : ROLE_LABEL[pending.to]}`);
    setFound(null);
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
    if (r.body?.link) setShareLink({ title: `Password reset link for ${person.name}`, link: r.body.link });
    else toast.success(SEC_COPY[action].done, { description: action === "reset_password" ? `Emailed to ${person.email}` : undefined });
    loadSecurity();
    onChanged();
  };

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    const r = await post({ action: "invite", ...invite });
    setInviting(false);
    if (!r.ok) { toast.error("Invite not sent", { description: r.error }); return; }
    if (r.body?.link) setShareLink({ title: `Invite link for ${invite.firstName}`, link: r.body.link });
    else toast.success(`Invite emailed to ${invite.email}`);
    setInvite({ email: "", firstName: "", lastName: "", role: "reviewer" });
    await load();
    onChanged();
  };

  const describe = (p: Pending) => {
    if (p.to === "student") return `${p.person.name} loses access to the admin panel straight away and becomes a regular student account.`;
    if (p.to === "super_admin" && p.person.id === userId) {
      return "You become the first super admin. From then on, only super admins can change settings and manage staff.";
    }
    return `${ROLE_LABEL[p.to]}: ${ROLE_DESCRIPTION[p.to as keyof typeof ROLE_DESCRIPTION]}`;
  };

  const roleSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-36"><SelectValue>{ROLE_LABEL[value] ?? value}</SelectValue></SelectTrigger>
      <SelectContent>{STAFF_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4 animate-fade-in max-w-5xl">
      <h2 className="text-xl font-display font-bold">Staff</h2>

      {!loading && !hasSuperAdmin && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="pt-6 space-y-3 text-sm">
            <p><strong>There is no super admin yet.</strong> Until there is one, every admin can change settings and manage staff.</p>
            {me && (
              <Button size="sm" onClick={() => setPending({ person: me, to: "super_admin" })}>
                <ShieldCheck className="mr-2 h-4 w-4" />Make me the super admin
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {withoutTwoFactor > 0 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="pt-6 text-sm">
            <strong>{withoutTwoFactor} staff {withoutTwoFactor === 1 ? "account doesn't" : "accounts don't"} use two-factor sign-in.</strong>{" "}
            Staff can see every student&apos;s personal data, so ask them to turn it on from their Profile page.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff accounts</CardTitle>
          <CardDescription>Everyone who can sign in to the admin panel. You can&apos;t change your own role or security here.</CardDescription>
        </CardHeader>
        <CardContent>
          {securityError && <p className="mb-3 text-xs text-muted-foreground">Sign-in details unavailable: {securityError}</p>}
          {loading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Two-factor</TableHead>
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
                          {self ? <span className="text-sm">{ROLE_LABEL[s.role] ?? s.role}</span> : roleSelect(s.role, (to) => setPending({ person: s, to }))}
                        </TableCell>
                        <TableCell>
                          {!sec ? <span className="text-muted-foreground">—</span>
                            : sec.invited ? <Badge variant="outline">Invite pending</Badge>
                            : sec.mfa ? <Badge className="bg-emerald-600 hover:bg-emerald-600">On</Badge>
                            : <Badge variant="outline" className="border-amber-300 text-amber-800 dark:text-amber-300">Off</Badge>}
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
                              {!self && <>
                                <DropdownMenuItem onClick={() => setSecAction({ person: s, action: "reset_password" })}><KeyRound className="mr-2 h-4 w-4" />Send password reset</DropdownMenuItem>
                                <DropdownMenuItem disabled={!sec?.mfa} onClick={() => setSecAction({ person: s, action: "reset_mfa" })}><ShieldOff className="mr-2 h-4 w-4" />Turn off two-factor</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSecAction({ person: s, action: "sign_out" })}><LogOut className="mr-2 h-4 w-4" />Sign out everywhere</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setPending({ person: s, to: "student" })}>
                                  <UserMinus className="mr-2 h-4 w-4" />Remove staff access
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite new staff</CardTitle>
            <CardDescription>Creates the account and emails them a link to set a password. Use this for people who don&apos;t have a portal account yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={sendInvite}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label htmlFor="inv-first">First name</Label>
                  <Input id="inv-first" value={invite.firstName} onChange={(e) => setInvite({ ...invite, firstName: e.target.value })} required /></div>
                <div className="space-y-1"><Label htmlFor="inv-last">Last name</Label>
                  <Input id="inv-last" value={invite.lastName} onChange={(e) => setInvite({ ...invite, lastName: e.target.value })} required /></div>
              </div>
              <div className="space-y-1"><Label htmlFor="inv-email">Email</Label>
                <Input id="inv-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required /></div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1"><Label>Role</Label>{roleSelect(invite.role, (role) => setInvite({ ...invite, role }))}</div>
                <Button type="submit" disabled={inviting}>
                  {inviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}Send invite
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add existing account</CardTitle>
            <CardDescription>Give staff access to someone who already registered. An account that has applied for a scholarship can&apos;t be made staff.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form className="flex gap-2" onSubmit={search}>
              <Input type="email" value={email} placeholder="Their account email" onChange={(e) => { setEmail(e.target.value); setFound(null); }} />
              <Button type="submit" variant="outline" disabled={searching || !email.trim()}>
                {searching ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}Find
              </Button>
            </form>
            {found && (
              <div className="rounded-lg border p-3 space-y-3">
                <div>
                  <p className="font-medium">{found.name}</p>
                  <p className="text-xs text-muted-foreground">{found.email} · currently {ROLE_LABEL[found.role] ?? found.role}</p>
                </div>
                {found.role === "student" ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1"><Label>Give them</Label>{roleSelect(newRole, setNewRole)}</div>
                    <Button onClick={() => setPending({ person: found, to: newRole })}><UserPlus className="mr-2 h-4 w-4" />Add as staff</Button>
                  </div>
                ) : <p className="text-sm text-muted-foreground">This account is already staff. Change its role in the list above.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">What each role can do</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          {STAFF_ROLES.map((r) => <p key={r}><strong>{ROLE_LABEL[r]}</strong>: {ROLE_DESCRIPTION[r]}</p>)}
          <p className="text-xs text-muted-foreground">Every staff role can view programs, applicants, students and payments. Keep one or two super admins, so someone can still manage staff if one person loses access. Every change on this page is recorded in the audit log.</p>
        </CardContent>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.to === "student" ? `Remove ${pending.person.name}'s staff access?` : `Make ${pending?.person.id === userId ? "yourself" : pending?.person.name} ${ROLE_LABEL[pending?.to ?? ""]}?`}
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

      <AlertDialog open={!!secAction} onOpenChange={(o) => !o && !busy && setSecAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{secAction && SEC_COPY[secAction.action].title(secAction.person.name)}</AlertDialogTitle>
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
            <AlertDialogTitle>{shareLink?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              Email isn&apos;t set up on this portal, so give them this one-time link yourself, in person or through a private message. Anyone with the link can sign in to this account.
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
