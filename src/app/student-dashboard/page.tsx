"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  LayoutDashboard, FileText, Upload, GraduationCap, Banknote, Receipt,
  Bell, User, Settings as SettingsIcon, LogOut, Menu, Lock, Download,
  AlertTriangle, CheckCircle, Clock, XCircle, Pencil, Eye, Trash2, Shield, Loader2,
  Camera,
} from "lucide-react";
import ApplicationProgressBar from "@/components/student/ApplicationProgressBar";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

const sidebarItems = [
  { icon: LayoutDashboard, label: "Dashboard", key: "overview" },
  { icon: FileText, label: "Application", key: "application" },
  { icon: Upload, label: "Documents", key: "documents" },
  { icon: GraduationCap, label: "Scholarship", key: "scholarship" },
  { icon: Banknote, label: "Disbursement", key: "disbursement" },
  { icon: Receipt, label: "Payment History", key: "payments" },
  { icon: Bell, label: "Notifications", key: "notifications" },
  { icon: User, label: "Profile", key: "profile" },
  { icon: SettingsIcon, label: "Settings", key: "settings" },
];

const requiredDocTypes = ["Valid ID", "Grades", "Certificate of Registration", "Barangay Indigency", "Birth Certificate"];

export default function StudentDashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [active, setActive] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState<Tables<"profiles"> | null>(null);
  const [applications, setApplications] = useState<(Tables<"applications"> & { scholarships: { name: string } | null })[]>([]);
  const [documents, setDocuments] = useState<Tables<"documents">[]>([]);
  const [payments, setPayments] = useState<Tables<"payments">[]>([]);
  const [notifications, setNotifications] = useState<Tables<"notifications">[]>([]);
  const [scholarships, setScholarships] = useState<Tables<"scholarships">[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [applyScholarshipId, setApplyScholarshipId] = useState("");
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);

  // Profile edit state — kept in parent to survive re-renders
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editBarangay, setEditBarangay] = useState("");
  const [editMunicipality, setEditMunicipality] = useState("");
  const [editSchool, setEditSchool] = useState("");
  const [editCourse, setEditCourse] = useState("");
  const [editYearLevel, setEditYearLevel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserEmail(user.email || "");

    const [profileRes, appsRes, docsRes, paymentsRes, notifsRes, scholsRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("applications").select("*, scholarships(name)").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("documents").select("*").eq("user_id", user.id),
      supabase.from("payments").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("scholarships").select("*").eq("is_active", true),
    ]);

    if (profileRes.data) {
      setProfile(profileRes.data);
      setEditFirst(profileRes.data.first_name || "");
      setEditLast(profileRes.data.last_name || "");
      setEditPhone(profileRes.data.phone || "");
      setEditBarangay(profileRes.data.barangay || "");
      setEditMunicipality(profileRes.data.municipality || "");
      setEditSchool(profileRes.data.school_name || "");
      setEditCourse(profileRes.data.course || "");
      setEditYearLevel(profileRes.data.year_level || "");
    }
    if (appsRes.data) setApplications(appsRes.data);
    if (docsRes.data) setDocuments(docsRes.data);
    if (paymentsRes.data) setPayments(paymentsRes.data);
    if (notifsRes.data) setNotifications(notifsRes.data);
    if (scholsRes.data) setScholarships(scholsRes.data);
    setLoading(false);
  };

  const currentApp = applications[0];
  const isDisbursed = currentApp?.disbursement_status === "Disbursed";
  const locked = isDisbursed;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const lockedToast = () => toast.error("Locked: scholarship has been disbursed.");
  const guard = (fn: () => void) => () => (locked ? lockedToast() : fn());

  const statusBadge = (status: string | null | undefined) => {
    if (!status || status === "—") return <span className="text-sm text-muted-foreground">—</span>;
    const map: Record<string, { icon: any; cls: string }> = {
      Approved: { icon: CheckCircle, cls: "border-success text-success" },
      Pending: { icon: Clock, cls: "border-warning text-warning" },
      Rejected: { icon: XCircle, cls: "border-destructive text-destructive" },
      Disbursed: { icon: CheckCircle, cls: "border-success text-success" },
      Processing: { icon: Clock, cls: "border-primary text-primary" },
      Waitlisted: { icon: Clock, cls: "border-muted-foreground text-muted-foreground" },
    };
    const m = map[status];
    if (!m) return <Badge variant="outline">{status}</Badge>;
    const Icon = m.icon;
    return <Badge variant="outline" className={m.cls}><Icon className="mr-1 h-3 w-3" />{status}</Badge>;
  };

  const displayName = profile ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() : userEmail.split("@")[0];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const Overview = () => (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-6 flex flex-col sm:flex-row items-center sm:items-start gap-4">
          {profile?.profile_picture_url ? (
            <img src={profile.profile_picture_url} alt="Profile" className="h-20 w-20 rounded-full object-cover" />
          ) : (
            <div className="h-20 w-20 rounded-full bg-accent flex items-center justify-center">
              <User className="h-10 w-10 text-primary" />
            </div>
          )}
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-xl font-display font-bold">{displayName}</h2>
            <p className="text-sm text-muted-foreground">{profile?.course || "—"} {profile?.year_level ? `• ${profile.year_level}` : ""}</p>
            <p className="text-sm text-muted-foreground">{profile?.school_name || "—"}</p>
          </div>
          {locked && <Badge variant="outline" className="border-destructive text-destructive"><Lock className="mr-1 h-3 w-3" /> Locked (Disbursed)</Badge>}
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">Application Status</p><div className="mt-2">{currentApp ? statusBadge(currentApp.status) : <span className="text-sm text-muted-foreground">No application</span>}</div></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">Scholarship</p><p className="font-semibold mt-1">{currentApp?.scholarships?.name || "—"}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">Disbursement</p><div className="mt-2">{statusBadge(currentApp?.disbursement_status)}</div></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="font-display">Progress</CardTitle></CardHeader>
        <CardContent><ApplicationProgressBar currentStep={isDisbursed ? 2 : currentApp?.status === "Approved" ? 1 : 0} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="font-display">Latest Notifications</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {notifications.length === 0 && <p className="text-sm text-muted-foreground">No notifications yet.</p>}
          {notifications.slice(0, 3).map((n) => (
            <div key={n.id} className="flex items-start gap-3 p-3 rounded-md bg-muted/40">
              <Bell className="h-4 w-4 text-primary mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-muted-foreground">{n.message}</p>
              </div>
              <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );

  const Application = () => (
    <div className="space-y-6">
      {locked && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 flex items-center gap-3">
            <Lock className="h-5 w-5 text-destructive" />
            <p className="text-sm">Your scholarship has been disbursed. The application is now read-only.</p>
          </CardContent>
        </Card>
      )}
      {currentApp ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="font-display">My Application</CardTitle>
              <CardDescription>{currentApp.scholarships?.name}</CardDescription>
            </div>
            {statusBadge(currentApp.status)}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-muted-foreground">Submitted</p><p className="font-medium">{new Date(currentApp.created_at).toLocaleDateString()}</p></div>
              <div><p className="text-muted-foreground">Year Level</p><p className="font-medium">{profile?.year_level || "—"}</p></div>
              <div><p className="text-muted-foreground">School</p><p className="font-medium">{profile?.school_name || "—"}</p></div>
              <div><p className="text-muted-foreground">Course</p><p className="font-medium">{profile?.course || "—"}</p></div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="outline" disabled={locked || currentApp.status !== "Pending"} onClick={guard(() => toast.success("Edit mode enabled"))}><Pencil className="mr-1 h-3 w-3" /> Edit</Button>
              <Button size="sm" variant="outline" disabled={locked || currentApp.status === "Approved"} onClick={guard(async () => {
                await supabase.from("applications").delete().eq("id", currentApp.id);
                toast.success("Application cancelled");
                loadData();
              })}><Trash2 className="mr-1 h-3 w-3" /> Cancel</Button>
              <Button size="sm" variant="outline"><Eye className="mr-1 h-3 w-3" /> View</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground mb-4">You haven&apos;t submitted an application yet.</p>
            <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
              <DialogTrigger asChild><Button className="bg-gradient-primary"><FileText className="mr-1 h-4 w-4" /> Apply for Scholarship</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Apply for Scholarship</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Scholarship Program *</Label>
                    <Select value={applyScholarshipId} onValueChange={setApplyScholarshipId}>
                      <SelectTrigger><SelectValue placeholder="Select program" /></SelectTrigger>
                      <SelectContent>
                        {scholarships.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    disabled={!applyScholarshipId || applyLoading}
                    className="bg-gradient-primary"
                    onClick={async () => {
                      if (!applyScholarshipId) return;
                      setApplyLoading(true);
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) { setApplyLoading(false); return; }
                      const { error } = await supabase.from("applications").insert({
                        user_id: user.id,
                        scholarship_id: applyScholarshipId,
                      });
                      if (error) { toast.error(error.message); }
                      else { toast.success("Application submitted!"); setApplyDialogOpen(false); setApplyScholarshipId(""); loadData(); }
                      setApplyLoading(false);
                    }}
                  >
                    {applyLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Submit
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const Documents = () => (
    <div className="space-y-4">
      {locked && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 flex items-center gap-2 text-sm"><Lock className="h-4 w-4 text-destructive" /> Documents are locked after disbursement.</CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {requiredDocTypes.map((docType) => {
          const uploaded = documents.find((d) => d.document_type === docType);
          return (
            <Card key={docType} className={uploaded ? "border-success/30" : ""}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-3">
                  <FileText className={`h-5 w-5 ${uploaded ? "text-success" : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-medium">{docType}</p>
                    <p className="text-xs text-muted-foreground">{uploaded ? uploaded.file_name : "Not uploaded"}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {uploaded && <Button size="sm" variant="outline"><Eye className="h-3 w-3" /></Button>}
                  <Label className="cursor-pointer">
                    <Input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" disabled={locked} onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) return;
                      const filePath = `${user.id}/${docType}/${Date.now()}-${file.name}`;
                      const { error } = await supabase.storage.from("documents").upload(filePath, file);
                      if (error) { toast.error(error.message); return; }
                      const { data: urlData } = supabase.storage.from("documents").getPublicUrl(filePath);
                      await supabase.from("documents").insert({ user_id: user.id, document_type: docType, file_url: urlData.publicUrl, file_name: file.name });
                      toast.success(`${docType} uploaded`);
                      loadData();
                    }} />
                    <span className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium cursor-pointer ${locked ? "opacity-50 pointer-events-none" : "hover:bg-muted"}`}>
                      <Upload className="h-3 w-3" />{uploaded ? "Replace" : "Upload"}
                    </span>
                  </Label>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );

  const Scholarship = () => (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">{currentApp?.scholarships?.name || "No Active Scholarship"}</CardTitle>
        <CardDescription>Program details and conditions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Approved Amount</p><p className="font-medium">{currentApp?.amount_approved ? `₱${currentApp.amount_approved.toLocaleString()}` : "—"}</p></div>
          <div><p className="text-muted-foreground">Required Grade</p><p className="font-medium">85% and above</p></div>
        </div>
        <div>
          <p className="text-sm font-semibold mb-2">Conditions</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
            <li>Maintain a minimum grade of 85.</li>
            <li>Submit a Certificate of Registration each semester.</li>
            <li>Attend mandatory orientation and progress meetings.</li>
            <li>No failing grades or dropped subjects.</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );

  const Disbursement = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">Total Disbursed</p><p className="text-2xl font-bold mt-1">₱{payments.filter(p => p.status === "Disbursed").reduce((s, p) => s + p.amount, 0).toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">Status</p><div className="mt-2">{statusBadge(currentApp?.disbursement_status || "—")}</div></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="font-display">Disbursement Timeline</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {payments.length === 0 && <p className="text-sm text-muted-foreground">No payments yet.</p>}
          {payments.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${p.status === "Disbursed" ? "bg-success" : "bg-warning"}`} />
              <div className="flex-1">
                <p className="text-sm font-medium">Tranche {i + 1} — ₱{p.amount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{p.scheduled_date || "—"} {p.method}</p>
              </div>
              {statusBadge(p.status)}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );

  const Payments = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-display">Payment History</CardTitle>
        <Button size="sm" variant="outline"><Download className="mr-1 h-3 w-3" /> Download Receipts</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Reference</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {payments.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No payments yet</TableCell></TableRow>}
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.reference || "—"}</TableCell>
                <TableCell>{p.scheduled_date || "—"}</TableCell>
                <TableCell>₱{p.amount.toLocaleString()}</TableCell>
                <TableCell>{p.method}</TableCell>
                <TableCell>{statusBadge(p.status)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  const Notifications = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-display">All Notifications</CardTitle>
        {notifications.some(n => !n.read) && (
          <Button variant="ghost" size="sm" onClick={async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
            loadData();
          }}>Mark all read</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {notifications.length === 0 && <p className="text-sm text-muted-foreground">No notifications yet.</p>}
        {notifications.map((n) => (
          <div key={n.id} className={`flex items-start gap-3 p-3 rounded-md border ${n.read ? "opacity-70" : "border-primary/30"}`}>
            <Bell className={`h-4 w-4 mt-0.5 ${n.type === "success" ? "text-success" : n.type === "warning" ? "text-warning" : "text-primary"}`} />
            <div className="flex-1">
              <p className="text-sm font-medium">{n.title}</p>
              <p className="text-xs text-muted-foreground">{n.message}</p>
            </div>
            <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleDateString()}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  const Profile = () => {

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setUploading(false); return; }
      const filePath = `${user.id}/avatar-${Date.now()}.${file.name.split(".").pop()}`;
      const { error } = await supabase.storage.from("profile-pictures").upload(filePath, file, { upsert: true });
      if (error) { toast.error(error.message); setUploading(false); return; }
      const { data: urlData } = supabase.storage.from("profile-pictures").getPublicUrl(filePath);
      await supabase.from("profiles").update({ profile_picture_url: urlData.publicUrl }).eq("id", user.id);
      toast.success("Profile photo updated");
      setUploading(false);
      loadData();
    };

    const handleSaveProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("profiles").update({
        first_name: editFirst, last_name: editLast, phone: editPhone,
        barangay: editBarangay, municipality: editMunicipality,
        school_name: editSchool, course: editCourse, year_level: editYearLevel,
      }).eq("id", user.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Profile saved");
      loadData();
    };

    const handleChangePassword = async () => {
      if (!newPw || newPw.length < 6) { toast.error("Password must be at least 6 characters"); return; }
      if (newPw !== confirmPw) { toast.error("Passwords do not match"); return; }
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) { toast.error(error.message); return; }
      toast.success("Password updated");
      setNewPw(""); setConfirmPw("");
    };

    return (
      <div className="space-y-6">
        {locked && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-3 flex items-center gap-2 text-sm"><Lock className="h-4 w-4 text-destructive" /> Profile editing is disabled after disbursement.</CardContent>
          </Card>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardContent className="py-6 text-center">
              <div className="relative mx-auto h-24 w-24 mb-4">
                {profile?.profile_picture_url ? (
                  <img src={profile.profile_picture_url} alt="Profile" className="h-24 w-24 rounded-full object-cover" />
                ) : (
                  <div className="h-24 w-24 rounded-full bg-accent flex items-center justify-center"><User className="h-10 w-10 text-primary" /></div>
                )}
                <Label className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center cursor-pointer shadow-md hover:bg-primary/90">
                  <Input type="file" className="hidden" accept="image/*" disabled={locked || uploading} onChange={handlePhotoUpload} />
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </Label>
              </div>
              <h3 className="font-display font-bold">{displayName}</h3>
              <p className="text-sm text-muted-foreground">{userEmail}</p>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="font-display">Personal Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>First Name</Label><Input value={editFirst} onChange={e => setEditFirst(e.target.value)} disabled={locked} /></div>
              <div><Label>Last Name</Label><Input value={editLast} onChange={e => setEditLast(e.target.value)} disabled={locked} /></div>
              <div><Label>Email</Label><Input defaultValue={userEmail} disabled /></div>
              <div><Label>Phone</Label><Input value={editPhone} onChange={e => setEditPhone(e.target.value)} disabled={locked} /></div>
              <div><Label>Barangay</Label><Input value={editBarangay} onChange={e => setEditBarangay(e.target.value)} disabled={locked} /></div>
              <div><Label>Municipality</Label><Input value={editMunicipality} onChange={e => setEditMunicipality(e.target.value)} disabled={locked} /></div>
              <div>
                <Label>School</Label>
                <Select value={editSchool} onValueChange={setEditSchool} disabled={locked}>
                  <SelectTrigger><SelectValue placeholder="Select school" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="San Jose National High School">San Jose National High School</SelectItem>
                    <SelectItem value="Ambulong National High School">Ambulong National High School</SelectItem>
                    <SelectItem value="Bangkuro National High School">Bangkuro National High School</SelectItem>
                    <SelectItem value="Batong Buhay National High School">Batong Buhay National High School</SelectItem>
                    <SelectItem value="Bubog National High School">Bubog National High School</SelectItem>
                    <SelectItem value="Caminawit National High School">Caminawit National High School</SelectItem>
                    <SelectItem value="Inarawan National High School">Inarawan National High School</SelectItem>
                    <SelectItem value="Ipil National High School">Ipil National High School</SelectItem>
                    <SelectItem value="Labangan National High School">Labangan National High School</SelectItem>
                    <SelectItem value="Mangarin National High School">Mangarin National High School</SelectItem>
                    <SelectItem value="Poypoy National High School">Poypoy National High School</SelectItem>
                    <SelectItem value="San Agustin National High School">San Agustin National High School</SelectItem>
                    <SelectItem value="Tayamaan National High School">Tayamaan National High School</SelectItem>
                    <SelectItem value="Occidental Mindoro State College (OMSC)">Occidental Mindoro State College (OMSC)</SelectItem>
                    <SelectItem value="Saint Joseph College of Occidental Mindoro (SJCOM)">Saint Joseph College of Occidental Mindoro (SJCOM)</SelectItem>
                    <SelectItem value="AMA Computer College - San Jose">AMA Computer College - San Jose</SelectItem>
                    <SelectItem value="STI College - San Jose">STI College - San Jose</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Course</Label>
                <Select value={editCourse} onValueChange={setEditCourse} disabled={locked}>
                  <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STEM">Science, Technology, Engineering and Mathematics (STEM)</SelectItem>
                    <SelectItem value="ABM">Accountancy, Business and Management (ABM)</SelectItem>
                    <SelectItem value="HUMSS">Humanities and Social Sciences (HUMSS)</SelectItem>
                    <SelectItem value="GAS">General Academic Strand (GAS)</SelectItem>
                    <SelectItem value="TVL">Technical-Vocational-Livelihood (TVL)</SelectItem>
                    <SelectItem value="BSEd">Bachelor of Secondary Education (BSEd)</SelectItem>
                    <SelectItem value="BEEd">Bachelor of Elementary Education (BEEd)</SelectItem>
                    <SelectItem value="BSBA">Bachelor of Science in Business Administration (BSBA)</SelectItem>
                    <SelectItem value="BSA">Bachelor of Science in Accountancy (BSA)</SelectItem>
                    <SelectItem value="BSIT">Bachelor of Science in Information Technology (BSIT)</SelectItem>
                    <SelectItem value="BSCS">Bachelor of Science in Computer Science (BSCS)</SelectItem>
                    <SelectItem value="BSN">Bachelor of Science in Nursing (BSN)</SelectItem>
                    <SelectItem value="BSM">Bachelor of Science in Midwifery (BSM)</SelectItem>
                    <SelectItem value="BSAg">Bachelor of Science in Agriculture (BSAg)</SelectItem>
                    <SelectItem value="BSF">Bachelor of Science in Fisheries (BSF)</SelectItem>
                    <SelectItem value="BSCrim">Bachelor of Science in Criminology (BSCrim)</SelectItem>
                    <SelectItem value="BSTM">Bachelor of Science in Tourism Management (BSTM)</SelectItem>
                    <SelectItem value="BSHM">Bachelor of Science in Hospitality Management (BSHM)</SelectItem>
                    <SelectItem value="BSSW">Bachelor of Science in Social Work (BSSW)</SelectItem>
                    <SelectItem value="AB Communication">Bachelor of Arts in Communication</SelectItem>
                    <SelectItem value="BSCE">Bachelor of Science in Civil Engineering (BSCE)</SelectItem>
                    <SelectItem value="BSEEct">Bachelor of Science in Electrical Engineering (BSEE)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Year Level</Label><Input value={editYearLevel} onChange={e => setEditYearLevel(e.target.value)} disabled={locked} /></div>
              <div className="sm:col-span-2">
                <Button disabled={locked} className="bg-gradient-primary" onClick={guard(handleSaveProfile)}>Save Changes</Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><CardTitle className="font-display">Change Password</CardTitle></CardHeader>
          <CardContent className="space-y-3 max-w-md">
            <div><Label>New Password</Label><Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} /></div>
            <div><Label>Confirm Password</Label><Input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} /></div>
            <Button className="bg-gradient-primary" onClick={handleChangePassword}>Update Password</Button>
          </CardContent>
        </Card>
      </div>
    );
  };

  const SettingsView = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="font-display">Notification Preferences</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {["Application updates", "Payment notifications", "General announcements"].map((p) => (
            <div key={p} className="flex items-center justify-between"><p className="text-sm">{p}</p><Switch defaultChecked /></div>
          ))}
        </CardContent>
      </Card>
    </div>
  );

  const renderActive = () => {
    switch (active) {
      case "overview": return <Overview />;
      case "application": return <Application />;
      case "documents": return <Documents />;
      case "scholarship": return <Scholarship />;
      case "disbursement": return <Disbursement />;
      case "payments": return <Payments />;
      case "notifications": return <Notifications />;
      case "profile": return <Profile />;
      case "settings": return <SettingsView />;
      default: return <Overview />;
    }
  };

  const activeLabel = sidebarItems.find((i) => i.key === active)?.label ?? "Dashboard";

  return (
    <div className="min-h-screen flex w-full bg-muted/30">
      <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 fixed lg:sticky top-0 left-0 z-40 h-screen w-64 bg-card border-r transition-transform`}>
        <div className="flex items-center gap-3 p-4 border-b">
          <Image src="/municipal-logo.png" alt="Logo" width={36} height={36} className="h-9 w-9" />
          <div><p className="text-sm font-semibold">SB San Jose Scholarship</p><p className="text-xs text-muted-foreground">Student Panel</p></div>
        </div>
        <nav className="p-2 space-y-1 overflow-y-auto" style={{ height: "calc(100vh - 130px)" }}>
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <button key={item.key} onClick={() => { setActive(item.key); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                <Icon className="h-4 w-4" />{item.label}
              </button>
            );
          })}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t bg-card">
          <Button variant="outline" size="sm" className="w-full" onClick={handleLogout}><LogOut className="mr-1 h-4 w-4" /> Logout</Button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-card border-b h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2" onClick={() => setSidebarOpen(true)}><Menu className="h-5 w-5" /></button>
            <h1 className="font-display font-semibold">{activeLabel}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <span className="hidden sm:block text-sm text-muted-foreground">Hi, {displayName.split(" ")[0]}</span>
            <button onClick={() => setActive("profile")} className="h-8 w-8 rounded-full overflow-hidden border">
              {profile?.profile_picture_url ? (
                <img src={profile.profile_picture_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-accent flex items-center justify-center"><User className="h-4 w-4 text-primary" /></div>
              )}
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-auto">{renderActive()}</main>
      </div>
    </div>
  );
}
