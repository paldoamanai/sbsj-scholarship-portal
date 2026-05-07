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
  FileDown, Receipt, Loader2,
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
  { icon: GraduationCap, label: "Scholarships", key: "scholarships" },
  { icon: Users, label: "Students", key: "students" },
  { icon: Wallet, label: "Funds", key: "funds" },
  { icon: Banknote, label: "Disbursement", key: "disbursement" },
  { icon: BarChart3, label: "Reports", key: "reports" },
  { icon: Bell, label: "Notifications", key: "notifications" },
  { icon: SettingsIcon, label: "Settings", key: "settings" },
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

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
    if (roleData?.role !== "admin") { router.push("/student-dashboard"); return; }

    const [appsRes, scholsRes, profilesRes, paymentsRes] = await Promise.all([
      supabase.from("applications").select("*, scholarships(name)").order("created_at", { ascending: false }),
      supabase.from("scholarships").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("*"),
      supabase.from("payments").select("*").order("created_at", { ascending: false }),
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
    setLoading(false);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); router.push("/"); router.refresh(); };

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
        <div className="p-3 border-t space-y-2">
          <Link href="/"><Button variant="outline" size="sm" className="w-full">Back to Home</Button></Link>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Total Budget</p><p className="text-2xl font-bold font-display text-primary">{formatPHP(totals.totalBudget)}</p></CardContent></Card>
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Total Disbursed</p><p className="text-2xl font-bold font-display text-success">{formatPHP(totals.totalDisbursed)}</p></CardContent></Card>
                <Card><CardContent className="py-5"><p className="text-xs text-muted-foreground">Remaining</p><p className="text-2xl font-bold font-display text-warning">{formatPHP(totals.remaining)}</p>{totals.totalBudget > 0 && <Progress value={(totals.totalDisbursed / totals.totalBudget) * 100} className="mt-2 h-2" />}</CardContent></Card>
              </div>
              {statusPieData.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Application Status Distribution</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={statusPieData} dataKey="value" nameKey="name" outerRadius={80} label>
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
                        <div><Label className="text-muted-foreground text-xs">Status</Label><p>{statusBadge(viewApp.status)}</p></div>
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
                  { title: "List of Scholars", desc: "Complete roster of active and past scholars", icon: Users },
                  { title: "Fund Utilization Report", desc: "Budget allocation vs disbursement breakdown", icon: Wallet },
                  { title: "Disbursement Summary", desc: "All payments by period, status, and program", icon: Banknote },
                  { title: "Applicant Statistics", desc: "Applications, approval rates, demographics", icon: BarChart3 },
                ].map((r, i) => (
                  <Card key={i}>
                    <CardHeader><CardTitle className="text-base flex items-center gap-2"><r.icon className="h-4 w-4 text-primary" />{r.title}</CardTitle><CardDescription>{r.desc}</CardDescription></CardHeader>
                    <CardContent className="flex gap-2">
                      <Button variant="outline" size="sm"><FileDown className="mr-1 h-4 w-4" /> PDF</Button>
                      <Button variant="outline" size="sm"><FileDown className="mr-1 h-4 w-4" /> Excel</Button>
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
          {activeSection === "settings" && (
            <div className="space-y-4 animate-fade-in max-w-2xl">
              <h2 className="text-xl font-display font-bold">Settings</h2>
              <Card>
                <CardHeader><CardTitle className="text-base">Scholarship Criteria Template</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div><Label>Minimum Grade Average</Label><Input type="number" defaultValue={85} /></div>
                  <Button onClick={() => toast.success("Criteria saved")}>Save</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Payment Methods</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {["Bank Transfer (LandBank)", "GCash", "Check", "Cash"].map((m) => (
                    <div key={m} className="flex items-center justify-between border-b last:border-0 pb-3 last:pb-0">
                      <span className="text-sm">{m}</span><Switch defaultChecked={m !== "Cash"} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
