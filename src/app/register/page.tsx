"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import {
  User, School, Lock, Upload, ChevronRight, ChevronLeft, AlertTriangle, Loader2, GraduationCap, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const stepLabels = ["Account", "Personal Info", "School Info", "Documents", "Apply"];

const requiredDocuments = [
  "Valid ID",
  "Grades",
  "Certificate of Registration",
  "Barangay Indigency",
  "Birth Certificate",
];

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Step 0 — Account
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Step 1 — Personal
  const [form, setForm] = useState({
    lastName: "", firstName: "", middleName: "", sex: "", civilStatus: "",
    nationality: "Filipino", phone: "", barangay: "", municipality: "",
  });
  const [dobMonth, setDobMonth] = useState("");
  const [dobDay, setDobDay] = useState("");
  const [dobYear, setDobYear] = useState("");

  // Step 2 — Academic
  const [academic, setAcademic] = useState({
    schoolName: "", course: "", yearLevel: "", averageGrade: "",
  });

  // Step 3 — Documents
  const [docFiles, setDocFiles] = useState<Record<string, File | null>>({});

  // Step 4 — Scholarship selection
  const [selectedScholarship, setSelectedScholarship] = useState("");
  const [scholarships, setScholarships] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (step === 4) {
      fetch("/api/scholarships")
        .then((r) => r.json())
        .then((data) => Array.isArray(data) && setScholarships(data))
        .catch(() => {});
    }
  }, [step]);

  const update = (field: string, value: string) => {
    setForm((p) => ({ ...p, [field]: value }));
    setErrors((p) => ({ ...p, [field]: "" }));
  };

  const updateAcademic = (field: string, value: string) => {
    setAcademic((p) => ({ ...p, [field]: value }));
    setErrors((p) => ({ ...p, [field]: "" }));
  };

  const validateStep = () => {
    const errs: Record<string, string> = {};

    if (step === 0) {
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Valid email required";
      if (!password || password.length < 8) errs.password = "Min 8 characters";
      if (password !== confirmPassword) errs.confirmPassword = "Passwords do not match";
    } else if (step === 1) {
      if (!form.lastName.trim()) errs.lastName = "Required";
      if (!form.firstName.trim()) errs.firstName = "Required";
      if (!form.sex) errs.sex = "Required";
      if (!form.civilStatus) errs.civilStatus = "Required";
      if (!dobMonth || !dobDay || !dobYear) errs.dob = "Required";
      if (!form.phone.trim() || !/^(09|\+639)\d{9}$/.test(form.phone.replace(/\s/g, "")))
        errs.phone = "Valid PH phone required";
      if (!form.barangay.trim()) errs.barangay = "Required";
      if (!form.municipality.trim()) errs.municipality = "Required";
    } else if (step === 2) {
      if (!academic.schoolName.trim()) errs.schoolName = "Required";
      if (!academic.course.trim()) errs.course = "Required";
      if (!academic.yearLevel) errs.yearLevel = "Required";
      if (!academic.averageGrade.trim()) errs.averageGrade = "Required";
      else if (parseFloat(academic.averageGrade) < 85) errs.averageGrade = "Must be 85 or above to be eligible";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validateStep()) setStep((s) => s + 1); };
  const back = () => setStep((s) => s - 1);

  const handleSubmit = async () => {
    setLoading(true);
    const supabase = createClient();

    // 1. Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (authError || !authData.user) {
      toast.error("Registration failed", { description: authError?.message });
      setLoading(false);
      return;
    }

    // Email confirmation is enabled — user is not authenticated yet, so RLS-protected
    // writes would silently fail. Direct them to verify first.
    if (!authData.session) {
      toast.success("Account created!", {
        description: "Check your email to verify your account, then log in to complete your profile.",
      });
      setLoading(false);
      router.push("/login");
      return;
    }

    const userId = authData.user.id;
    const dob = `${dobYear}-${String(parseInt(dobMonth) + 1).padStart(2, "0")}-${String(parseInt(dobDay)).padStart(2, "0")}`;

    // 2. Update profile
    const { error: profileError } = await supabase.from("profiles").update({
      first_name: form.firstName,
      middle_name: form.middleName || null,
      last_name: form.lastName,
      sex: form.sex,
      civil_status: form.civilStatus,
      nationality: form.nationality,
      dob,
      phone: form.phone,
      barangay: form.barangay,
      municipality: form.municipality,
      school_name: academic.schoolName,
      course: academic.course,
      year_level: academic.yearLevel,
      average_grade: parseFloat(academic.averageGrade),
    }).eq("id", userId);

    if (profileError) {
      toast.error("Profile save failed", { description: profileError.message });
      setLoading(false);
      return;
    }

    // 3. Upload documents
    for (const [docType, file] of Object.entries(docFiles)) {
      if (!file) continue;
      const filePath = `${userId}/${docType}/${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file);

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("documents").getPublicUrl(filePath);
        await supabase.from("documents").insert({
          user_id: userId,
          document_type: docType,
          file_url: urlData.publicUrl,
          file_name: file.name,
        });
      }
    }

    // 4. Create application if scholarship selected
    if (selectedScholarship) {
      const { error: appError } = await supabase.from("applications").insert({
        user_id: userId,
        scholarship_id: selectedScholarship,
      });
      if (appError) {
        toast.error("Application submit failed", { description: appError.message });
        setLoading(false);
        return;
      }
    }

    toast.success("Registration submitted successfully!", {
      description: "Please check your email for verification.",
    });
    router.push("/student-dashboard");
    router.refresh();
    setLoading(false);
  };

  const gradeWarning = academic.averageGrade && parseFloat(academic.averageGrade) < 85;

  const FieldError = ({ field }: { field: string }) =>
    errors[field] ? <p className="text-xs text-destructive mt-1">{errors[field]}</p> : null;

  return (
    <Layout>
      <div className="container max-w-2xl py-12">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {stepLabels.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                {i + 1}
              </div>
              <span className={cn("hidden sm:block text-sm", i <= step ? "text-foreground font-medium" : "text-muted-foreground")}>{s}</span>
              {i < stepLabels.length - 1 && <div className={cn("w-8 h-px", i < step ? "bg-primary" : "bg-border")} />}
            </div>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              {step === 0 && <><Lock className="h-5 w-5 text-primary" /> Account Setup</>}
              {step === 1 && <><User className="h-5 w-5 text-primary" /> Personal Information</>}
              {step === 2 && <><School className="h-5 w-5 text-primary" /> School Information</>}
              {step === 3 && <><Upload className="h-5 w-5 text-primary" /> Document Upload</>}
              {step === 4 && <><GraduationCap className="h-5 w-5 text-primary" /> Select Scholarship</>}
            </CardTitle>
            <CardDescription>Fill in all required fields to proceed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* STEP 0: Account */}
            {step === 0 && (
              <>
                <div><Label>Email *</Label><Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErrors(p => ({ ...p, email: "" })); }} /><FieldError field="email" /></div>
                <div>
                  <Label>Password *</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setErrors(p => ({ ...p, password: "" })); }}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                  </div>
                  <FieldError field="password" />
                </div>
                <div>
                  <Label>Confirm Password *</Label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setErrors(p => ({ ...p, confirmPassword: "" })); }}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                  </div>
                  <FieldError field="confirmPassword" />
                </div>
              </>
            )}

            {/* STEP 1: Personal */}
            {step === 1 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div><Label>Last Name *</Label><Input value={form.lastName} onChange={(e) => update("lastName", e.target.value)} /><FieldError field="lastName" /></div>
                  <div><Label>First Name *</Label><Input value={form.firstName} onChange={(e) => update("firstName", e.target.value)} /><FieldError field="firstName" /></div>
                  <div><Label>Middle Name</Label><Input value={form.middleName} onChange={(e) => update("middleName", e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <Label>Sex *</Label>
                    <Select value={form.sex} onValueChange={(v) => update("sex", v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectContent>
                    </Select>
                    <FieldError field="sex" />
                  </div>
                  <div>
                    <Label>Civil Status *</Label>
                    <Select value={form.civilStatus} onValueChange={(v) => update("civilStatus", v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent><SelectItem value="Single">Single</SelectItem><SelectItem value="Married">Married</SelectItem><SelectItem value="Widowed">Widowed</SelectItem></SelectContent>
                    </Select>
                    <FieldError field="civilStatus" />
                  </div>
                  <div><Label>Nationality</Label><Input value={form.nationality} onChange={(e) => update("nationality", e.target.value)} /></div>
                </div>
                <div>
                  <Label>Date of Birth *</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <Select value={dobMonth} onValueChange={(v) => { setDobMonth(v); setErrors(p => ({ ...p, dob: "" })); }}>
                      <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                      <SelectContent>
                        {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                          <SelectItem key={i} value={String(i)}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={dobDay} onValueChange={(v) => { setDobDay(v); setErrors(p => ({ ...p, dob: "" })); }}>
                      <SelectTrigger><SelectValue placeholder="Day" /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 31 }, (_, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={dobYear} onValueChange={(v) => { setDobYear(v); setErrors(p => ({ ...p, dob: "" })); }}>
                      <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 50 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <FieldError field="dob" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><Label>Phone Number *</Label><Input value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="09XXXXXXXXX" /><FieldError field="phone" /></div>
                  <div><Label>Barangay *</Label><Input value={form.barangay} onChange={(e) => update("barangay", e.target.value)} /><FieldError field="barangay" /></div>
                </div>
                <div><Label>Municipality *</Label><Input value={form.municipality} onChange={(e) => update("municipality", e.target.value)} /><FieldError field="municipality" /></div>
              </>
            )}

            {/* STEP 2: Academic */}
            {step === 2 && (
              <>
                <div>
                  <Label>School Name *</Label>
                  <Select value={academic.schoolName} onValueChange={(v) => updateAcademic("schoolName", v)}>
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
                  <FieldError field="schoolName" />
                </div>
                <div>
                  <Label>Course *</Label>
                  <Select value={academic.course} onValueChange={(v) => updateAcademic("course", v)}>
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
                  <FieldError field="course" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Year Level *</Label>
                    <Select value={academic.yearLevel} onValueChange={(v) => updateAcademic("yearLevel", v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {["Grade 11", "Grade 12", "1st Year", "2nd Year", "3rd Year", "4th Year"].map((y) => (
                          <SelectItem key={y} value={y}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError field="yearLevel" />
                  </div>
                  <div>
                    <Label>Average Grade *</Label>
                    <Input type="number" value={academic.averageGrade} onChange={(e) => updateAcademic("averageGrade", e.target.value)} placeholder="e.g. 88" />
                    <FieldError field="averageGrade" />
                    {gradeWarning && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Grade below 85 — application will be automatically rejected.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* STEP 3: Document Upload */}
            {step === 3 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Upload the required documents. You can also upload them later from your dashboard.</p>
                {requiredDocuments.map((doc) => (
                  <div key={doc} className="flex items-center justify-between rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <Upload className={`h-5 w-5 ${docFiles[doc] ? "text-success" : "text-muted-foreground"}`} />
                      <div>
                        <p className="text-sm font-medium">{doc}</p>
                        <p className="text-xs text-muted-foreground">
                          {docFiles[doc] ? docFiles[doc]!.name : "Not uploaded"}
                        </p>
                      </div>
                    </div>
                    <Label className="cursor-pointer">
                      <Input
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          setDocFiles((prev) => ({ ...prev, [doc]: file }));
                        }}
                      />
                      <span className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted cursor-pointer">
                        <Upload className="h-3 w-3" />
                        {docFiles[doc] ? "Replace" : "Upload"}
                      </span>
                    </Label>
                  </div>
                ))}
              </div>
            )}

            {/* STEP 4: Select Scholarship */}
            {step === 4 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Select a scholarship program to apply for, or skip for now.</p>
                <Select value={selectedScholarship} onValueChange={setSelectedScholarship}>
                  <SelectTrigger><SelectValue placeholder="Select scholarship (optional)" /></SelectTrigger>
                  <SelectContent>
                    {scholarships.length === 0 ? (
                      <SelectItem value="_loading" disabled>Loading scholarships…</SelectItem>
                    ) : (
                      scholarships.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-medium text-sm">Review Your Information</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                    <p>Name: <span className="text-foreground">{form.firstName} {form.lastName}</span></p>
                    <p>Email: <span className="text-foreground">{email}</span></p>
                    <p>School: <span className="text-foreground">{academic.schoolName}</span></p>
                    <p>Course: <span className="text-foreground">{academic.course}</span></p>
                    <p>Grade: <span className="text-foreground">{academic.averageGrade}</span></p>
                    <p>Docs: <span className="text-foreground">{Object.values(docFiles).filter(Boolean).length}/{requiredDocuments.length}</span></p>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-4">
              {step > 0 ? (
                <Button variant="outline" onClick={back}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Back
                </Button>
              ) : (
                <div />
              )}
              {step < 4 ? (
                <Button onClick={next} className="bg-gradient-primary shadow-primary">
                  Next <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={handleSubmit} className="bg-gradient-primary shadow-primary" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit Registration
                </Button>
              )}
            </div>

            {step === 0 && (
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary hover:underline">Login here</Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
