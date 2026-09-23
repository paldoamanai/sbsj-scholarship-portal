"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, UserPlus, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { STAFF_ROLES, STAFF_ROLE_LABELS, type StaffRole } from "@/lib/settings";

type StaffRow = { user_id: string; email: string; role: string; name: string | null; created_at: string };

const ROLE_HELP: Record<StaffRole, string> = {
  super_admin: "Everything, including settings and staff accounts",
  admin: "Everything except settings and staff once a super admin exists",
  reviewer: "Applications, documents, verification and grades",
  finance_admin: "Payments, receipts, payment problems and fund reports",
};

type Props = {
  userId: string;
  role: string;
  onChanged?: () => void;
};

export default function StaffPanel({ userId, role, onChanged }: Props) {
  const supabase = createClient();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<StaffRole>("reviewer");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<StaffRow | null>(null);

  const load = async () => {
    const { data, error } = await supabase.rpc("list_staff");
    if (error) toast.error("Could not load staff", { description: error.message });
    setStaff(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Same rule as the database: super admins manage staff; admins may until a super admin exists.
  const hasSuper = staff.some((s) => s.role === "super_admin");
  const canManage = role === "super_admin" || (role === "admin" && !hasSuper);
  const assignable = STAFF_ROLES.filter((r) => r !== "super_admin" || role === "super_admin" || !hasSuper);

  const setRole = async (targetEmail: string, target: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("set_staff_role", { _email: targetEmail, _role: target });
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success(target === "student" ? `Removed staff access for ${targetEmail}` : `${targetEmail} is now ${STAFF_ROLE_LABELS[target as StaffRole] ?? target}`);
    await load();
    onChanged?.();
    return true;
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <h2 className="text-xl font-display font-bold">Staff Accounts</h2>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><UserPlus className="h-4 w-4 text-primary" />Add staff</CardTitle>
            <CardDescription>The person registers an account first, then you give it a staff role here.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => {
              e.preventDefault();
              if (!email.trim()) return;
              if (await setRole(email.trim(), newRole)) setEmail("");
            }}>
              <div className="flex-1 min-w-56">
                <Label className="text-xs">Email</Label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              </div>
              <div>
                <Label className="text-xs">Role</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as StaffRole)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assignable.map((r) => <SelectItem key={r} value={r}>{STAFF_ROLE_LABELS[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={busy || !email.trim()}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Give access</Button>
            </form>
            <ul className="mt-4 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {STAFF_ROLES.map((r) => <li key={r}><span className="font-medium text-foreground">{STAFF_ROLE_LABELS[r]}:</span> {ROLE_HELP[r]}</li>)}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="py-3 flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-warning mt-0.5" />
            <p className="text-sm text-muted-foreground">Only a super admin can add staff or change roles.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
            <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Since</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && staff.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No staff accounts</TableCell></TableRow>}
            {staff.map((s) => {
              const self = s.user_id === userId;
              const locked = self || !canManage || (s.role === "super_admin" && role !== "super_admin");
              return (
                <TableRow key={s.user_id}>
                  <TableCell className="font-medium">{s.name || "—"}{self && <Badge variant="secondary" className="ml-2">You</Badge>}</TableCell>
                  <TableCell className="text-sm">{s.email}</TableCell>
                  <TableCell>
                    {locked ? <Badge variant="outline">{STAFF_ROLE_LABELS[s.role as StaffRole] ?? s.role}</Badge> : (
                      <Select value={s.role} disabled={busy} onValueChange={(v) => setRole(s.email, v)}>
                        <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {assignable.map((r) => <SelectItem key={r} value={r}>{STAFF_ROLE_LABELS[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    {!locked && <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => setRemoving(s)}>Remove access</Button>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!removing} onOpenChange={(o) => { if (!o) setRemoving(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remove staff access?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{removing?.email} becomes an ordinary student account and can no longer open the admin area. Their past actions stay in the audit log.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => { if (removing && await setRole(removing.email, "student")) setRemoving(null); }}>Remove access</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
