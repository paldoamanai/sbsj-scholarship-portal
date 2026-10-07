"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createClient } from "@/lib/supabase/client";

type Props = {
  userId: string;
  /** Called after a role changes, so the page can reload the audit log and the signed-in user's role. */
  onChanged: () => void;
};

type Person = { id: string; email: string | null; name: string; role: string };
type Pending = { person: Person; to: string };

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", student: "Student", finance_admin: "Finance Admin", reviewer: "Reviewer",
};
const STAFF_ROLES = ["admin", "super_admin"];

const nameOf = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unnamed account";

/** Super admin page: who has staff access, and changing an account between student, admin and super admin. */
export default function StaffPanel({ userId, onChanged }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<Person | null>(null);
  const [searching, setSearching] = useState(false);
  const [newRole, setNewRole] = useState("admin");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: roles, error } = await supabase.from("user_roles").select("user_id, role").neq("role", "student");
    if (error) { toast.error("Could not load staff", { description: error.message }); setLoading(false); return; }
    const ids = (roles ?? []).map((r) => r.user_id);
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("id, email, first_name, last_name").in("id", ids)
      : { data: [] };
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));
    const order = (r: string) => (r === "super_admin" ? 0 : r === "admin" ? 1 : 2);
    setStaff((roles ?? [])
      .map((r) => {
        const p = byId.get(r.user_id);
        return { id: r.user_id, email: p?.email ?? null, name: p ? nameOf(p) : "Unknown account", role: r.role as string };
      })
      .sort((a, b) => order(a.role) - order(b.role) || a.name.localeCompare(b.name)));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const hasSuperAdmin = staff.some((s) => s.role === "super_admin");
  const me = staff.find((s) => s.id === userId);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = email.trim();
    if (!q) return;
    setSearching(true);
    setFound(null);
    // Escape LIKE wildcards: "_" is common in email addresses.
    const { data: prof } = await supabase.from("profiles").select("id, email, first_name, last_name")
      .ilike("email", q.replace(/[\\%_]/g, "\\$&")).maybeSingle();
    if (!prof) { setSearching(false); toast.error("No account with that email", { description: "The person must register on the portal first." }); return; }
    const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", prof.id).maybeSingle();
    setFound({ id: prof.id, email: prof.email, name: nameOf(prof), role: (roleRow?.role as string) ?? "student" });
    setNewRole("admin");
    setSearching(false);
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_user_role", { _user_id: pending.person.id, _role: pending.to });
    setBusy(false);
    setPending(null);
    if (error) { toast.error("Role not changed", { description: error.message }); return; }
    toast.success(`${pending.person.name} is now ${pending.to === "student" ? "a student account" : `${ROLE_LABEL[pending.to]}`}`);
    setFound(null);
    setEmail("");
    await load();
    onChanged();
  };

  const describe = (p: Pending) => {
    if (p.to === "student") return `${p.person.name} loses access to the admin panel straight away and becomes a regular student account.`;
    if (p.to === "super_admin") {
      return p.person.id === userId
        ? "You become the first super admin. From then on, only super admins can change settings and manage staff."
        : `${p.person.name} will be able to change system settings and manage staff, including your own access.`;
    }
    return `${p.person.name} gets access to the admin panel: applications, students, payments and reports. They can view settings but not change them.`;
  };

  return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff accounts</CardTitle>
          <CardDescription>Everyone who can sign in to the admin panel. You can&apos;t change your own role.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Access</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {staff.map((s) => {
                    const self = s.id === userId;
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <p className="font-medium">{s.name}{self && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</p>
                          <p className="text-xs text-muted-foreground break-all">{s.email ?? "—"}</p>
                        </TableCell>
                        <TableCell>
                          {self ? <span className="text-sm">{ROLE_LABEL[s.role] ?? s.role}</span> : (
                            <Select value={s.role} onValueChange={(to) => setPending({ person: s, to })}>
                              <SelectTrigger className="w-40"><SelectValue>{ROLE_LABEL[s.role] ?? s.role}</SelectValue></SelectTrigger>
                              <SelectContent>{STAFF_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!self && (
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setPending({ person: s, to: "student" })}>
                              <UserMinus className="mr-1 h-4 w-4" />Remove
                            </Button>
                          )}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add staff</CardTitle>
          <CardDescription>The person registers on the portal first, then you give their account staff access here. An account that has applied for a scholarship can&apos;t be made staff.</CardDescription>
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
                  <div>
                    <Label>Give them</Label>
                    <Select value={newRole} onValueChange={setNewRole}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>{STAFF_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => setPending({ person: found, to: newRole })}><UserPlus className="mr-2 h-4 w-4" />Add as staff</Button>
                </div>
              ) : <p className="text-sm text-muted-foreground">This account is already staff. Change its role in the list above.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">What each role can do</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <p><strong>Super Admin</strong>: everything an admin can do, plus changing system settings and managing staff on this page.</p>
          <p><strong>Admin</strong>: reviews applications, manages students, scholarships, funds, payments and reports. Can view settings but not change them.</p>
          <p><strong>Student</strong>: applies for scholarships from the student dashboard. No access to the admin panel.</p>
          <p className="text-xs text-muted-foreground">Keep one or two super admins, so someone can still manage settings if one person loses access. Every role change is recorded in the audit log.</p>
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
    </div>
  );
}
