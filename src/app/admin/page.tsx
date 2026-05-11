"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  LayoutDashboard, GraduationCap, FileText, Users, ShieldCheck,
  Plus, Pencil, Trash2, CheckCircle, XCircle, Clock, Eye,
  Menu, X, Search, BookOpen, LogOut, Wallet, Banknote, BarChart3,
  Bell, ScrollText, Settings as SettingsIcon, Lock, Download,
  FileDown, Receipt, Loader2, User, Upload, Camera,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

const sidebarItems = [
  { icon: LayoutDashboard, label: "Dashboard", key: "overview" },
  { icon: FileText, label: "Applicants", key: "applications" },
  { icon: ShieldCheck, label: "Verification", key: "verification" },
  { icon: GraduationCap, label: "Scholarships", key: "scholarships" },
  { icon: Users, label: "Students", key: "students" },
  { icon: Users, label: "User Mgmt", key: "user-management" },
  { icon: Wallet, label: "Funds", key: "funds" },
  { icon: Banknote, label: "Disbursement", key: "disbursement" },
  { icon: BarChart3, label: "Reports", key: "reports" },
  { icon: ScrollText, label: "Audit Logs", key: "audit-logs" },
  { icon: Bell, label: "Notifications", key: "notifications" },
  { icon: SettingsIcon, label: "Settings", key: "settings" },
  { icon: User, label: "Profile", key: "profile" },
];

const COLORS = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--destructive))", "hsl(var(--muted-foreground))"];
const formatPHP = (n: number) => `₱${n.toLocaleString()}`;

export default function AdminDashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [activeSection, setActiveSection] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [appSearch, setAppSearch] = useState("");
  const [studentSearch, setStudentSearch] = useState("");

  const [applications, setApplications] = useState<(Tables<"applications"> & { scholarships: { name: string } | null, profiles?: Tables<"profiles"> | null })[]>([]);
  const [scholarships, setScholarships] = useState<Tables<"scholarships">[]>([]);
  const [profiles, setProfiles] = useState<Tables<"profiles">[]>([]);
  const [payments, setPayments] = useState<Tables<"payments">[]>([]);
  const [viewApp, setViewApp] = useState<typeof applications[0] | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [verifications, setVerifications] = useState<any[]>([]);
  const [allUserRoles, setAllUserRoles] = useState<any[]>([]);
  const [systemSettings, setSystemSettings] = useState<any[]>([]);
  const [adminProfile, setAdminProfile] = useState<any>(null);
  const [adminEmail, setAdminEmail] = useState("");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    setAdminEmail(user.email || "");
    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
    const role = (roleData as any)?.role;
    if (!["admin", "super_admin", "finance_admin", "reviewer"].includes(role)) { router.push("/student-dashboard"); return; }

    const [appsRes, scholsRes, profilesRes, paymentsRes, logsRes, verifRes, rolesRes, settingsRes, adminProfRes] = await Promise.all([
      supabase.from("applications").select("*, scholarships(name)").order("created_at", { ascending: false }),
      supabase.from("scholarships").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("*"),
      supabase.from("payments").select("*").order("created_at", { ascending: false }),
      supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("scholar_verifications").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("*, profiles:user_id(first_name, last_name, email)"),
      supabase.from("system_settings").select("*"),
      supabase.from("profiles").select("*").eq("id", user.id).single(),
    ]);

    if (appsRes.data) {
      const appsWithProfiles = await Promise.all(appsRes.data.map(async (app: any) => {
        const { data: prof } = await supabase.from("profiles").select("*").eq("id", app.user_id).single();
        return { ...app, profiles: prof };
      }));
      setApplications(appsWithProfiles);
    }
    if (scholsRes.data) setScholarships(scholsRes.data);
    if (profilesRes.data) setProfiles(profilesRes.data);
    if (paymentsRes.data) setPayments(paymentsRes.data);
    if (logsRes.data) setAuditLogs(logsRes.data);
    if (verifRes.data) setVerifications(verifRes.data);
    if (rolesRes.data) setAllUserRoles(rolesRes.data);
    if (settingsRes.data) setSystemSettings(settingsRes.data);
    if (adminProfRes.data) setAdminProfile(adminProfRes.data);
    setLoading(false);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); router.push("/"); router.refresh(); };

  const logAudit = async (action: string, entityType: string, entityId?: string, prev?: any, next?: any) => {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("audit_logs").insert({
      user_id: user?.id, user_email: user?.email || adminEmail,
      action, entity_type: entityType, entity_id: entityId,
      previous_value: prev ? JSON.stringify(prev) : null,
      new_value: next ? JSON.stringify(next) : null,
    });
  };

  const exportPDF = async (key: string) => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("SB San Jose Scholarship Portal", 14, 15);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 22);

    if (key === "scholars") {
      const approved = applications.filter(a => a.status === "Approved");
      autoTable(doc, {
        startY: 28,
        head: [["Name", "School", "Course", "Year Level", "Scholarship", "Status"]],
        body: approved.map(a => [
          a.profiles ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}` : "—",
          a.profiles?.school_name || "—", a.profiles?.course || "—", a.profiles?.year_level || "—",
          a.scholarships?.name || "—", a.status,
        ]),
      });
    } else if (key === "funds") {
      autoTable(doc, {
        startY: 28,
        head: [["Scholarship", "Budget", "Slots", "Amount/Slot", "Active"]],
        body: scholarships.map(s => [s.name, formatPHP(s.total_budget), s.slots, formatPHP(s.amount), s.is_active ? "Yes" : "No"]),
      });
    } else if (key === "disbursements") {
      autoTable(doc, {
        startY: 28,
        head: [["Reference", "Amount", "Method", "Status", "Date"]],
        body: payments.map(p => [p.reference || "—", formatPHP(p.amount), p.method, p.status, p.scheduled_date || "—"]),
      });
    } else if (key === "statistics") {
      const t = { total: applications.length, approved: applications.filter(a => a.status === "Approved").length, rejected: applications.filter(a => a.status === "Rejected").length, pending: applications.filter(a => a.status === "Pending").length };
      autoTable(doc, {
        startY: 28,
        head: [["Metric", "Value"]],
        body: [["Total Applications", t.total], ["Approved", t.approved], ["Rejected", t.rejected], ["Pending", t.pending], ["Approval Rate", `${t.total ? ((t.approved / t.total) * 100).toFixed(1) : 0}%`]],
      });
    }
    doc.save(`${key}-report.pdf`);
    toast.success("PDF downloaded");
  };

  const exportExcel = async (key: string) => {
    const XLSX = await import("xlsx");
    let data: Record<string, string | number>[] = [];

    if (key === "scholars") {
      data = applications.filter(a => a.status === "Approved").map(a => ({
        Name: a.profiles ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}` : "—",
        School: a.profiles?.school_name || "—", Course: a.profiles?.course || "—",
        "Year Level": a.profiles?.year_level || "—", Scholarship: a.scholarships?.name || "—", Status: a.status,
      }));
    } else if (key === "funds") {
      data = scholarships.map(s => ({ Name: s.name, Budget: s.total_budget, Slots: s.slots, "Amount/Slot": s.amount, Active: s.is_active ? "Yes" : "No" }));
    } else if (key === "disbursements") {
      data = payments.map(p => ({ Reference: p.reference || "—", Amount: p.amount, Method: p.method, Status: p.status, Date: p.scheduled_date || "—" }));
    } else if (key === "statistics") {
      const t = { total: applications.length, approved: applications.filter(a => a.status === "Approved").length, rejected: applications.filter(a => a.status === "Rejected").length, pending: applications.filter(a => a.status === "Pending").length };
      data = [{ Metric: "Total Applications", Value: t.total }, { Metric: "Approved", Value: t.approved }, { Metric: "Rejected", Value: t.rejected }, { Metric: "Pending", Value: t.pending }, { Metric: "Approval Rate", Value: `${t.total ? ((t.approved / t.total) * 100).toFixed(1) : 0}%` }];
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `${key}-report.xlsx`);
    toast.success("Excel downloaded");
  };

  const totals = useMemo(() => {
    const approved = applications.filter(a => a.status === "Approved").length;
    const rejected = applications.filter(a => a.status === "Rejected").length;
    const pending = applications.filter(a => a.status === "Pending").length;
    const totalDisbursed = payments.filter(p => p.status === "Disbursed").reduce((s, p) => s + p.amount, 0);
    const totalBudget = scholarships.reduce((s, sc) => s + sc.total_budget, 0);
    return { total: applications.length, approved, rejected, pending, totalDisbursed, totalBudget, remaining: totalBudget - totalDisbursed };
  }, [applications, payments, scholarships]);

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
      Pending: { variant: "outline", icon: <Clock className="mr-1 h-3 w-3" /> },
      Approved: { variant: "default", icon: <CheckCircle className="mr-1 h-3 w-3" /> },
      Rejected: { variant: "destructive", icon: <XCircle className="mr-1 h-3 w-3" /> },
      Waitlisted: { variant: "secondary", icon: <Clock className="mr-1 h-3 w-3" /> },
    };
    const s = map[status] || map.Pending;
    return <Badge variant={s.variant}>{s.icon}{status}</Badge>;
  };

  const disbStatusBadge = (status: string) => {
    if (status === "Disbursed") return <Badge className="bg-success text-success-foreground hover:bg-success/90"><CheckCircle className="mr-1 h-3 w-3" />Disbursed</Badge>;
    if (status === "Processing") return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Processing</Badge>;
    return <Badge variant="outline"><Clock className="mr-1 h-3 w-3" />Pending</Badge>;
  };

  const filteredApps = applications.filter((a) => {
    const matchesStatus = statusFilter === "all" || a.status.toLowerCase() === statusFilter;
    const q = appSearch.toLowerCase();
    const name = a.profiles ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}`.toLowerCase() : "";
    const matchesSearch = !q || name.includes(q) || (a.scholarships?.name || "").toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const statusPieData = [
    { name: "Approved", value: totals.approved },
    { name: "Rejected", value: totals.rejected },
    { name: "Pending", value: totals.pending },
  ].filter(d => d.value > 0);

  const applicationsPerMonth = useMemo(() => {
    const months: Record<string, number> = {};
    applications.forEach(a => {
      const d = new Date(a.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months[key] = (months[key] || 0) + 1;
    });
    return Object.entries(months).sort().slice(-6).map(([month, count]) => ({
      month: new Date(month + "-01").toLocaleString("default", { month: "short", year: "2-digit" }),
      count,
    }));
  }, [applications]);

  const approvalRate = totals.total > 0 ? Math.round((totals.approved / totals.total) * 100) : 0;
  const rejectionRate = totals.total > 0 ? Math.round((totals.rejected / totals.total) * 100) : 0;
  const budgetUtilization = totals.totalBudget > 0 ? Math.round((totals.totalDisbursed / totals.totalBudget) * 100) : 0;

  const scholarshipDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    applications.forEach(a => {
      const name = a.scholarships?.name || "Unassigned";
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [applications]);

  const activeInactiveScholars = useMemo(() => [
    { name: "Active", value: profiles.filter(p => p.is_active).length },
    { name: "Inactive", value: profiles.filter(p => !p.is_active).length },
  ], [profiles]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-card border-r flex flex-col transform transition-transform lg:relative lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-3 p-4 border-b">
          <Image src="/municipal-logo.png" alt="Logo" width={32} height={32} className="h-8 w-8" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">SB San Jose Admin</p>
            <p className="text-xs text-muted-foreground truncate">Scholarship System</p>
          </div>
          <button className="lg:hidden" onClick={() => setSidebarOpen(false)}><X className="h-5 w-5" /></button>
        </div>
        <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
          {sidebarItems.map((item) => (
            <button key={item.key} onClick={() => { setActiveSection(item.key); setSidebarOpen(false); }}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeSection === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <item.icon className="h-4 w-4 shrink-0" /><span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-3 border-t">
          <Button variant="destructive" size="sm" className="w-full" onClick={handleLogout}><LogOut className="mr-1 h-4 w-4" /> Logout</Button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-card/80 backdrop-blur-md px-4 h-14">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)}><Menu className="h-5 w-5" /></button>
          <h1 className="text-lg font-display font-bold capitalize">{sidebarItems.find((s) => s.key === activeSection)?.label || activeSection}</h1>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {/* OVERVIEW */}
          {activeSection === "overview" && (
            <div className="space-y-6 animate-fade-in">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Total Applicants", value: totals.total, icon: FileText, color: "text-primary" },
                  { label: "Approved", value: totals.approved, icon: CheckCircle, color: "text-success" },
                  { label: "Rejected", value: totals.rejected, icon: XCircle, color: "text-destructive" },
                  { label: "Pending", value: totals.pending, icon: Clock, color: "text-warning" },
                ].map((stat, i) => (
                  <Card key={i}><CardContent className="flex items-center gap-3 py-5">
                    <div className="h-11 w-11 rounded-xl bg-accent flex items-center justify-center shrink-0"><stat.icon className={`h-5 w-5 ${stat.color}`} /></div>
                    <div className="min-w-0"><p className="text-2xl font-bold font-display">{stat.value}</p><p className="text-xs text-muted-foreground truncate">{stat.label}</p></div>
                  </CardContent></Card>
                ))}
              </div>

              {/* Budget + Rates Row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Total Budget</p><p className="text-xl font-bold font-display text-primary">{formatPHP(totals.totalBudget)}</p></CardContent></Card>
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Disbursed</p><p className="text-xl font-bold font-display text-success">{formatPHP(totals.totalDisbursed)}</p></CardContent></Card>
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Remaining</p><p className="text-xl font-bold font-display text-warning">{formatPHP(totals.remaining)}</p></CardContent></Card>
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Approval Rate</p><p className="text-xl font-bold font-display text-success">{approvalRate}%</p><Progress value={approvalRate} className="mt-2 h-1.5" /></CardContent></Card>
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Budget Utilization</p><p className="text-xl font-bold font-display text-primary">{budgetUtilization}%</p><Progress value={budgetUtilization} className="mt-2 h-1.5" /></CardContent></Card>
              </div>

              {/* Charts Row 1: Applications per Month + Status Distribution */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Applications per Month</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={applicationsPerMonth}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {statusPieData.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="text-base">Approval vs Rejection Rate</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={240}>
                        <PieChart>
                          <Pie data={statusPieData} dataKey="value" nameKey="name" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                            {statusPieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                          </Pie>
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Charts Row 2: Scholarship Distribution + Active/Inactive Scholars */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Scholarship Distribution</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={scholarshipDistribution} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                        <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">Active vs Inactive Scholars</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={activeInactiveScholars} dataKey="value" nameKey="name" outerRadius={80} label>
                          <Cell fill="hsl(var(--success))" />
                          <Cell fill="hsl(var(--muted-foreground))" />
                        </Pie>
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* APPLICATIONS */}
          {activeSection === "applications" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold">Applicant Management</h2>
                <div className="flex gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search name, scholarship..." value={appSearch} onChange={(e) => setAppSearch(e.target.value)} className="pl-9 w-60" />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Card>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Applicant</TableHead><TableHead>Scholarship</TableHead><TableHead>Grade</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredApps.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No applications found</TableCell></TableRow>}
                    {filteredApps.map((a) => {
                      const name = a.profiles ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}`.trim() : "—";
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{name}</TableCell>
                          <TableCell>{a.scholarships?.name || "—"}</TableCell>
                          <TableCell>{a.profiles?.average_grade || "—"}</TableCell>
                          <TableCell>{new Date(a.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>{statusBadge(a.status)}</TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button size="icon" variant="ghost" onClick={() => setViewApp(a)} title="View"><Eye className="h-4 w-4" /></Button>
                            {a.status === "Pending" && (<>
                              <Button size="icon" variant="ghost" onClick={async () => {
                                await supabase.from("applications").update({ status: "Approved" }).eq("id", a.id);
                                toast.success(`${name} approved!`);
                                loadData();
                              }}><CheckCircle className="h-4 w-4 text-success" /></Button>
                              <Button size="icon" variant="ghost" onClick={async () => {
                                await supabase.from("applications").update({ status: "Rejected" }).eq("id", a.id);
                                toast.error(`${name} rejected`);
                                loadData();
                              }}><XCircle className="h-4 w-4 text-destructive" /></Button>
                            </>)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>

              <Dialog open={!!viewApp} onOpenChange={(open) => !open && setViewApp(null)}>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>Application Details</DialogTitle></DialogHeader>
                  {viewApp && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label className="text-muted-foreground text-xs">Applicant</Label><p className="font-medium">{viewApp.profiles ? `${viewApp.profiles.first_name} ${viewApp.profiles.last_name}` : "—"}</p></div>
                        <div><Label className="text-muted-foreground text-xs">Email</Label><p className="font-medium">{viewApp.profiles?.email || "—"}</p></div>
                        <div><Label className="text-muted-foreground text-xs">School</Label><p className="font-medium">{viewApp.profiles?.school_name || "—"}</p></div>
                        <div><Label className="text-muted-foreground text-xs">Course</Label><p className="font-medium">{viewApp.profiles?.course || "—"}</p></div>
                        <div><Label className="text-muted-foreground text-xs">Year Level</Label><p className="font-medium">{viewApp.profiles?.year_level || "—"}</p></div>
                        <div><Label className="text-muted-foreground text-xs">Grade</Label><p className="font-medium">{viewApp.profiles?.average_grade || "—"}</p></div>
                        <div><Label className="text-muted-foreground text-xs">Scholarship</Label><p className="font-medium">{viewApp.scholarships?.name || "—"}</p></div>
                        <div><Label className="text-muted-foreground text-xs">Status</Label><div>{statusBadge(viewApp.status)}</div></div>
                      </div>
                      <div><Label className="text-xs">Reviewer Remarks</Label><Textarea placeholder="Add notes..." /></div>
                      {viewApp.status === "Pending" && (
                        <div className="flex gap-2 pt-2">
                          <Button className="flex-1" onClick={async () => {
                            await supabase.from("applications").update({ status: "Approved" }).eq("id", viewApp.id);
                            toast.success("Approved!"); setViewApp(null); loadData();
                          }}><CheckCircle className="mr-1 h-4 w-4" /> Approve</Button>
                          <Button variant="destructive" className="flex-1" onClick={async () => {
                            await supabase.from("applications").update({ status: "Rejected" }).eq("id", viewApp.id);
                            toast.error("Rejected"); setViewApp(null); loadData();
                          }}><XCircle className="mr-1 h-4 w-4" /> Reject</Button>
                        </div>
                      )}
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* SCHOLARSHIPS */}
          {activeSection === "scholarships" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-display font-bold">Scholarship Programs</h2>
                <Dialog>
                  <DialogTrigger asChild><Button className="bg-gradient-primary shadow-primary"><Plus className="mr-1 h-4 w-4" /> Add Scholarship</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle className="font-display">Add New Scholarship</DialogTitle></DialogHeader>
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      await supabase.from("scholarships").insert({
                        name: fd.get("name") as string,
                        description: fd.get("description") as string,
                        slots: parseInt(fd.get("slots") as string) || 0,
                        total_budget: parseInt(fd.get("budget") as string) || 0,
                        deadline: fd.get("deadline") as string || null,
                      });
                      toast.success("Scholarship added!"); loadData();
                    }} className="space-y-4">
                      <div><Label>Name</Label><Input name="name" required placeholder="Scholarship name" /></div>
                      <div><Label>Description</Label><Textarea name="description" placeholder="Description" /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div><Label>Slots</Label><Input name="slots" type="number" placeholder="50" /></div>
                        <div><Label>Deadline</Label><Input name="deadline" type="date" /></div>
                      </div>
                      <div><Label>Budget</Label><Input name="budget" type="number" placeholder="500000" /></div>
                      <Button type="submit" className="w-full bg-gradient-primary">Save Scholarship</Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
              <Card>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Name</TableHead><TableHead>Slots</TableHead><TableHead>Deadline</TableHead><TableHead>Budget</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {scholarships.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>{s.slots}</TableCell>
                        <TableCell>{s.deadline || "—"}</TableCell>
                        <TableCell>{formatPHP(s.total_budget)}</TableCell>
                        <TableCell><Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="icon" variant="ghost" onClick={async () => {
                            await supabase.from("scholarships").update({ is_active: !s.is_active }).eq("id", s.id);
                            toast.success(`${s.name} ${s.is_active ? "disabled" : "enabled"}`); loadData();
                          }}>{s.is_active ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4 text-success" />}</Button>
                          <Button size="icon" variant="ghost" onClick={async () => {
                            await supabase.from("scholarships").delete().eq("id", s.id);
                            toast.error("Scholarship deleted"); loadData();
                          }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* STUDENTS */}
          {activeSection === "students" && (
            <div className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-display font-bold">Student Management</h2>
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by name or email..." value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} className="pl-9" />
              </div>
              <Card>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>School</TableHead><TableHead>Course</TableHead><TableHead>Grade</TableHead><TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {profiles.filter((p) => {
                      const q = studentSearch.toLowerCase();
                      return !q || `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) || (p.email || "").toLowerCase().includes(q);
                    }).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.first_name} {p.last_name}</TableCell>
                        <TableCell>{p.email}</TableCell>
                        <TableCell>{p.school_name || "—"}</TableCell>
                        <TableCell>{p.course || "—"}</TableCell>
                        <TableCell>{p.average_grade || "—"}</TableCell>
                        <TableCell><Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* FUNDS */}
          {activeSection === "funds" && (
            <div className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-display font-bold">Fund Management</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Total Allocated</p><p className="text-2xl font-bold font-display">{formatPHP(totals.totalBudget)}</p></CardContent></Card>
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Total Disbursed</p><p className="text-2xl font-bold font-display text-success">{formatPHP(totals.totalDisbursed)}</p></CardContent></Card>
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Remaining</p><p className="text-2xl font-bold font-display text-warning">{formatPHP(totals.remaining)}</p></CardContent></Card>
              </div>
              <Card>
                <CardHeader><CardTitle className="text-base">Budget per Program</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={scholarships.map((s) => ({ name: s.name, Budget: s.total_budget }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Bar dataKey="Budget" fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {/* DISBURSEMENT */}
          {activeSection === "disbursement" && (
            <div className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-display font-bold">Disbursement Management</h2>
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="py-3 flex items-start gap-2">
                  <Lock className="h-4 w-4 text-warning mt-0.5" />
                  <p className="text-sm text-muted-foreground">Disbursed payments are <strong className="text-foreground">locked</strong>. Editing and deletion are disabled.</p>
                </CardContent>
              </Card>
              <Card>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Reference</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Scheduled</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {payments.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No payments yet</TableCell></TableRow>}
                    {payments.map((p) => {
                      const isLocked = p.status === "Disbursed";
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.reference || "—"}</TableCell>
                          <TableCell className="font-medium">{formatPHP(p.amount)}</TableCell>
                          <TableCell>{p.method}</TableCell>
                          <TableCell>{p.scheduled_date || "—"}</TableCell>
                          <TableCell>{disbStatusBadge(p.status)}</TableCell>
                          <TableCell className="text-right space-x-1">
                            {isLocked ? (
                              <Button size="icon" variant="ghost" title="View receipt"><Receipt className="h-4 w-4" /></Button>
                            ) : (
                              <Button size="sm" onClick={async () => {
                                await supabase.from("payments").update({ status: "Disbursed", disbursed_at: new Date().toISOString() }).eq("id", p.id);
                                toast.success("Marked as disbursed"); loadData();
                              }}>Mark Disbursed</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* REPORTS */}
          {activeSection === "reports" && (
            <div className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-display font-bold">Reports & Analytics</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { title: "List of Scholars", desc: "Complete roster of active and past scholars", icon: Users, exportKey: "scholars" },
                  { title: "Fund Utilization Report", desc: "Budget allocation vs disbursement breakdown", icon: Wallet, exportKey: "funds" },
                  { title: "Disbursement Summary", desc: "All payments by period, status, and program", icon: Banknote, exportKey: "disbursements" },
                  { title: "Applicant Statistics", desc: "Applications, approval rates, demographics", icon: BarChart3, exportKey: "statistics" },
                ].map((r, i) => (
                  <Card key={i}>
                    <CardHeader><CardTitle className="text-base flex items-center gap-2"><r.icon className="h-4 w-4 text-primary" />{r.title}</CardTitle><CardDescription>{r.desc}</CardDescription></CardHeader>
                    <CardContent className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => exportPDF(r.exportKey)}><FileDown className="mr-1 h-4 w-4" /> PDF</Button>
                      <Button variant="outline" size="sm" onClick={() => exportExcel(r.exportKey)}><FileDown className="mr-1 h-4 w-4" /> Excel</Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* NOTIFICATIONS */}
          {activeSection === "notifications" && (
            <div className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-display font-bold">Notifications</h2>
              <Card>
                <CardHeader><CardTitle className="text-base">Notification Settings</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {["Auto-send application status updates", "Auto-send approval notices", "Auto-send disbursement notifications"].map((label, i) => (
                    <div key={i} className="flex items-center justify-between border-b last:border-0 pb-3 last:pb-0">
                      <span className="text-sm">{label}</span><Switch defaultChecked />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {/* SETTINGS */}
          {/* SCHOLAR VERIFICATION */}
          {activeSection === "verification" && (
            <div className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-display font-bold">Scholar Verification</h2>
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="py-3 flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 text-warning mt-0.5" />
                  <p className="text-sm text-muted-foreground">Verify applicants to prevent duplicate scholarships. Flagged records require manual review.</p>
                </CardContent>
              </Card>
              <Card>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Applicant</TableHead><TableHead>Student ID</TableHead><TableHead>Gov ID</TableHead><TableHead>Existing Scholarship</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {verifications.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No verification records</TableCell></TableRow>}
                    {verifications.map((v: any) => {
                      const prof = profiles.find(p => p.id === v.user_id);
                      const name = prof ? `${prof.first_name || ""} ${prof.last_name || ""}`.trim() : "Unknown";
                      return (
                        <TableRow key={v.id}>
                          <TableCell className="font-medium">{name}</TableCell>
                          <TableCell className="font-mono text-xs">{v.student_id_number || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{v.government_id || "—"}</TableCell>
                          <TableCell>{v.has_existing_scholarship ? <Badge variant="destructive">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                          <TableCell>
                            <Badge variant={v.verification_status === "Verified" ? "default" : v.verification_status === "Flagged" ? "destructive" : "secondary"}>
                              {v.verification_status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right space-x-1">
                            {v.verification_status === "Pending" && (<>
                              <Button size="sm" onClick={async () => {
                                await supabase.from("scholar_verifications").update({ verification_status: "Verified", verified_at: new Date().toISOString() }).eq("id", v.id);
                                await logAudit("verify_scholar", "scholar_verifications", v.id, null, { status: "Verified" });
                                toast.success("Verified!"); loadData();
                              }}>Verify</Button>
                              <Button size="sm" variant="destructive" onClick={async () => {
                                await supabase.from("scholar_verifications").update({ verification_status: "Flagged", verified_at: new Date().toISOString() }).eq("id", v.id);
                                await logAudit("flag_scholar", "scholar_verifications", v.id, null, { status: "Flagged" });
                                toast.error("Flagged!"); loadData();
                              }}>Flag</Button>
                            </>)}
                            {v.verification_status === "Flagged" && (
                              <Button size="sm" variant="outline" onClick={async () => {
                                await supabase.from("scholar_verifications").update({ verification_status: "Cleared" }).eq("id", v.id);
                                await logAudit("clear_scholar", "scholar_verifications", v.id, null, { status: "Cleared" });
                                toast.success("Cleared!"); loadData();
                              }}>Clear</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* USER MANAGEMENT */}
          {activeSection === "user-management" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-display font-bold">User Management</h2>
                <Dialog>
                  <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" /> Add Admin</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Admin User</DialogTitle></DialogHeader>
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      const email = fd.get("email") as string;
                      const role = fd.get("role") as string;
                      const existingUser = profiles.find(p => p.email === email);
                      if (!existingUser) { toast.error("User not found. They must register first."); return; }
                      await supabase.from("user_roles").update({ role }).eq("user_id", existingUser.id);
                      await logAudit("assign_role", "user_roles", existingUser.id, null, { role });
                      toast.success(`${email} promoted to ${role}`); loadData();
                    }} className="space-y-4">
                      <div><Label>User Email (must be registered)</Label><Input name="email" required placeholder="user@email.com" /></div>
                      <div><Label>Role</Label>
                        <Select name="role" defaultValue="reviewer">
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="super_admin">Super Admin</SelectItem>
                            <SelectItem value="finance_admin">Finance Admin</SelectItem>
                            <SelectItem value="reviewer">Reviewer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button type="submit" className="w-full">Assign Role</Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Super Admin", desc: "Full system access", color: "border-destructive/30" },
                  { label: "Admin", desc: "Manage all modules", color: "border-primary/30" },
                  { label: "Finance Admin", desc: "Funds & disbursement", color: "border-success/30" },
                  { label: "Reviewer", desc: "Review applications", color: "border-warning/30" },
                ].map(r => (
                  <Card key={r.label} className={r.color}>
                    <CardContent className="py-4">
                      <p className="text-sm font-semibold">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.desc}</p>
                      <p className="text-lg font-bold mt-1">{allUserRoles.filter(u => u.role === r.label.toLowerCase().replace(" ", "_")).length}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Card>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {allUserRoles.filter(u => u.role !== "student").map((u: any) => {
                      const prof = profiles.find(p => p.id === u.user_id);
                      const name = prof ? `${prof.first_name || ""} ${prof.last_name || ""}`.trim() || prof.email : "Unknown";
                      return (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{prof?.email || "—"}</TableCell>
                          <TableCell><Badge variant={u.role === "super_admin" ? "destructive" : "default"}>{u.role}</Badge></TableCell>
                          <TableCell className="text-right space-x-1">
                            <Select defaultValue={u.role} onValueChange={async (val) => {
                              await supabase.from("user_roles").update({ role: val }).eq("id", u.id);
                              await logAudit("change_role", "user_roles", u.user_id, { role: u.role }, { role: val });
                              toast.success("Role updated"); loadData();
                            }}>
                              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="super_admin">Super Admin</SelectItem>
                                <SelectItem value="finance_admin">Finance Admin</SelectItem>
                                <SelectItem value="reviewer">Reviewer</SelectItem>
                                <SelectItem value="student">Student</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* AUDIT LOGS */}
          {activeSection === "audit-logs" && (
            <div className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-display font-bold">Audit Logs</h2>
              <Card>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Details</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {auditLogs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No audit logs yet</TableCell></TableRow>}
                    {auditLogs.map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</TableCell>
                        <TableCell className="text-sm">{log.user_email || "System"}</TableCell>
                        <TableCell><Badge variant="outline">{log.action}</Badge></TableCell>
                        <TableCell className="text-xs">{log.entity_type}</TableCell>
                        <TableCell className="text-xs font-mono max-w-[200px] truncate">{log.new_value ? JSON.stringify(log.new_value).slice(0, 80) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* ADMIN PROFILE */}
          {activeSection === "profile" && (
            <div className="space-y-4 animate-fade-in max-w-2xl">
              <h2 className="text-xl font-display font-bold">Admin Profile</h2>
              <Card>
                <CardContent className="py-6 space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className="h-20 w-20 rounded-full bg-accent flex items-center justify-center overflow-hidden">
                        {adminProfile?.profile_picture_url ? (
                          <img src={adminProfile.profile_picture_url} alt="Profile" className="h-20 w-20 rounded-full object-cover" />
                        ) : (
                          <User className="h-10 w-10 text-muted-foreground" />
                        )}
                      </div>
                      <label className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center cursor-pointer hover:bg-primary/90">
                        <Camera className="h-3.5 w-3.5" />
                        <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const { data: { user } } = await supabase.auth.getUser();
                          if (!user) return;
                          const filePath = `${user.id}/avatar/${file.name}`;
                          await supabase.storage.from("profile-pictures").upload(filePath, file, { upsert: true });
                          const { data: urlData } = supabase.storage.from("profile-pictures").getPublicUrl(filePath);
                          await supabase.from("profiles").update({ profile_picture_url: urlData.publicUrl }).eq("id", user.id);
                          await logAudit("update_profile_photo", "profiles", user.id);
                          toast.success("Profile photo updated"); loadData();
                        }} />
                      </label>
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{adminProfile?.first_name} {adminProfile?.last_name}</p>
                      <p className="text-sm text-muted-foreground">{adminEmail}</p>
                      <Badge className="mt-1">Admin</Badge>
                    </div>
                  </div>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    const updates = {
                      first_name: fd.get("first_name") as string,
                      last_name: fd.get("last_name") as string,
                      phone: fd.get("phone") as string,
                    };
                    await supabase.from("profiles").update(updates).eq("id", user.id);
                    await logAudit("update_profile", "profiles", user.id, null, updates);
                    toast.success("Profile updated"); loadData();
                  }} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>First Name</Label><Input name="first_name" defaultValue={adminProfile?.first_name || ""} /></div>
                      <div><Label>Last Name</Label><Input name="last_name" defaultValue={adminProfile?.last_name || ""} /></div>
                    </div>
                    <div><Label>Phone</Label><Input name="phone" defaultValue={adminProfile?.phone || ""} /></div>
                    <Button type="submit">Save Changes</Button>
                  </form>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Change Password</CardTitle></CardHeader>
                <CardContent>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const newPassword = fd.get("new_password") as string;
                    if (newPassword.length < 8) { toast.error("Password must be at least 8 characters"); return; }
                    const { error } = await supabase.auth.updateUser({ password: newPassword });
                    if (error) { toast.error(error.message); return; }
                    await logAudit("change_password", "auth", undefined);
                    toast.success("Password updated");
                    e.currentTarget.reset();
                  }} className="space-y-3">
                    <div><Label>New Password</Label><Input name="new_password" type="password" required minLength={8} placeholder="Min 8 characters" /></div>
                    <Button type="submit">Update Password</Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}

          {/* SETTINGS */}
          {activeSection === "settings" && (
            <div className="space-y-4 animate-fade-in max-w-2xl">
              <h2 className="text-xl font-display font-bold">System Settings</h2>
              <Card>
                <CardHeader><CardTitle className="text-base">Academic Year & Semester</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Academic Year</Label><Input defaultValue={systemSettings.find(s => s.key === "academic_year")?.value?.replace(/"/g, "") || "2025-2026"} onChange={async (e) => {
                      await supabase.from("system_settings").update({ value: JSON.stringify(e.target.value) }).eq("key", "academic_year");
                    }} /></div>
                    <div><Label>Semester</Label>
                      <Select defaultValue={systemSettings.find(s => s.key === "current_semester")?.value?.replace(/"/g, "") || "1st Semester"} onValueChange={async (val) => {
                        await supabase.from("system_settings").update({ value: JSON.stringify(val) }).eq("key", "current_semester");
                        toast.success("Semester updated");
                      }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1st Semester">1st Semester</SelectItem>
                          <SelectItem value="2nd Semester">2nd Semester</SelectItem>
                          <SelectItem value="Summer">Summer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Scholarship Criteria</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div><Label>Minimum Grade Average</Label><Input type="number" defaultValue={systemSettings.find(s => s.key === "min_grade_requirement")?.value || 85} onChange={async (e) => {
                    await supabase.from("system_settings").update({ value: e.target.value }).eq("key", "min_grade_requirement");
                  }} /></div>
                  <div><Label>Max Scholarships Per Student</Label><Input type="number" defaultValue={systemSettings.find(s => s.key === "max_scholarships_per_student")?.value || 1} onChange={async (e) => {
                    await supabase.from("system_settings").update({ value: e.target.value }).eq("key", "max_scholarships_per_student");
                  }} /></div>
                  <Button onClick={() => toast.success("Criteria saved")}>Save Criteria</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Payment Methods</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {["Bank Transfer (LandBank)", "GCash", "E-Wallet", "Check", "Cash Assistance"].map((m) => (
                    <div key={m} className="flex items-center justify-between border-b last:border-0 pb-3 last:pb-0">
                      <span className="text-sm">{m}</span><Switch defaultChecked={m !== "Cash Assistance"} />
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Notifications</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div><p className="text-sm font-medium">Email Notifications</p><p className="text-xs text-muted-foreground">Send email for application updates</p></div>
                    <Switch defaultChecked={systemSettings.find(s => s.key === "email_notifications")?.value === true || systemSettings.find(s => s.key === "email_notifications")?.value === "true"} onCheckedChange={async (val) => {
                      await supabase.from("system_settings").update({ value: val }).eq("key", "email_notifications");
                    }} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div><p className="text-sm font-medium">SMS Notifications</p><p className="text-xs text-muted-foreground">Send SMS for disbursement updates</p></div>
                    <Switch defaultChecked={systemSettings.find(s => s.key === "sms_notifications")?.value === true || systemSettings.find(s => s.key === "sms_notifications")?.value === "true"} onCheckedChange={async (val) => {
                      await supabase.from("system_settings").update({ value: val }).eq("key", "sms_notifications");
                    }} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
