"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, LogOut, MoreHorizontal, ShieldOff, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Action = "reset_password" | "reset_mfa" | "sign_out" | "delete_account";

const COPY: Record<Action, { title: (n: string) => string; body: (n: string) => string; done: string }> = {
  reset_password: {
    title: (n) => `Send ${n} a password reset link?`,
    body: () => "They get an email with a one-time link to choose a new password. Their current password keeps working until they do.",
    done: "Password reset link created",
  },
  reset_mfa: {
    title: (n) => `Turn off two-factor for ${n}?`,
    body: (n) => `Removes ${n}'s authenticator and signs them out everywhere. Use this when they lost their phone. They can set up two-factor again from their account settings.`,
    done: "Two-factor removed",
  },
  sign_out: {
    title: (n) => `Sign ${n} out everywhere?`,
    body: (n) => `Ends every session ${n} has. Each device is signed out within the hour (when its current sign-in token expires). Use this if a device was lost or shared.`,
    done: "Signed out everywhere",
  },
  delete_account: {
    title: (n) => `Delete ${n}'s account?`,
    body: (n) => `Permanently deletes ${n}'s login, profile, applications, documents, uploaded files and notifications. The audit log keeps their name and email. This can't be undone.`,
    done: "Account deleted",
  },
};

type Props = {
  student: { id: string; name: string; email: string | null };
  /** Delete is for the Mayor Office only. */
  canDelete: boolean;
  /** Disbursed payments would be deleted with the account, so deleting is refused while there are any. */
  disbursedPayments: number;
  /** The student's pending deletion request, recorded in the audit log when the account is deleted. */
  requestId?: string | null;
  onDeleted: () => void;
};

/** Account menu in the admin's Student Details dialog: password reset, two-factor reset, sign-out and deletion. */
export default function StudentAccountActions({ student, canDelete, disbursedPayments, requestId, onDeleted }: Props) {
  const [action, setAction] = useState<Action | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [shareLink, setShareLink] = useState<{ link: string; reason?: string } | null>(null);

  const deleteLocked = action === "delete_account" && (student.email ?? "").trim().toLowerCase() !== confirmText.trim().toLowerCase();

  const run = async () => {
    if (!action) return;
    setBusy(true);
    const res = await fetch("/api/admin/students", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, userId: student.id, requestId: requestId ?? undefined }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    const done = action;
    setAction(null);
    if (!res?.ok) { toast.error("Not done", { description: (body?.error as string) ?? "Request failed" }); return; }
    if (body?.link) setShareLink({ link: body.link, reason: body.reason });
    else toast.success(COPY[done].done, { description: done === "reset_password" ? `Emailed to ${student.email}` : undefined });
    if (done === "delete_account") onDeleted();
  };

  const open = (a: Action) => { setConfirmText(""); setAction(a); };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline"><MoreHorizontal className="mr-1 h-4 w-4" />Account</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => open("reset_password")}><KeyRound className="mr-2 h-4 w-4" />Send password reset</DropdownMenuItem>
          <DropdownMenuItem onClick={() => open("reset_mfa")}><ShieldOff className="mr-2 h-4 w-4" />Turn off two-factor</DropdownMenuItem>
          <DropdownMenuItem onClick={() => open("sign_out")}><LogOut className="mr-2 h-4 w-4" />Sign out everywhere</DropdownMenuItem>
          {canDelete && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={disbursedPayments > 0} onClick={() => open("delete_account")}>
              <Trash2 className="mr-2 h-4 w-4" />Delete account
            </DropdownMenuItem>
            {disbursedPayments > 0 && (
              <p className="max-w-56 px-2 pb-1.5 text-xs text-muted-foreground">
                Can&apos;t delete: they have disbursed payments. Deactivate the account to keep those records.
              </p>
            )}
          </>}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={!!action} onOpenChange={(o) => !o && !busy && setAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{action && COPY[action].title(student.name)}</AlertDialogTitle>
            <AlertDialogDescription>{action && COPY[action].body(student.name)}</AlertDialogDescription>
          </AlertDialogHeader>
          {action === "delete_account" && (
            <div className="space-y-1.5">
              <Label htmlFor="delete-student-email">Type <strong>{student.email}</strong> to confirm</Label>
              <Input id="delete-student-email" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy || deleteLocked} onClick={(e) => { e.preventDefault(); run(); }}
              className={action === "delete_account" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{action === "delete_account" ? "Delete account" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!shareLink} onOpenChange={(o) => !o && setShareLink(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Password reset link for {student.name}</AlertDialogTitle>
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
    </>
  );
}
