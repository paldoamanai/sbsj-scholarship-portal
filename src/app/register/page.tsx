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

// ── School → courses map ──────────────────────────────────────────────────────

type Course = { value: string; label: string };

const SHS_STRANDS: Course[] = [
  { value: "STEM", label: "Science, Technology, Engineering and Mathematics (STEM)" },
  { value: "ABM",  label: "Accountancy, Business and Management (ABM)" },
  { value: "HUMSS", label: "Humanities and Social Sciences (HUMSS)" },
  { value: "GAS",  label: "General Academic Strand (GAS)" },
  { value: "TVL",  label: "Technical-Vocational-Livelihood (TVL)" },
];

const COURSES_BY_SCHOOL: Record<string, Course[]> = {
  "Occidental Mindoro State College - Main Campus": [
    { value: "BSIT",              label: "BS Information Technology (BSIT)" },
    { value: "BSCS",              label: "BS Computer Science" },
    { value: "BSAg",              label: "BS Agriculture" },
    { value: "BSAgTech",          label: "BS Agricultural Technology" },
    { value: "BSAgroforestry",    label: "BS Agroforestry" },
    { value: "BSCrim",            label: "BS Criminology" },
    { value: "BSHM",              label: "BS Hospitality Management" },
    { value: "BSTM",              label: "BS Tourism Management" },
    { value: "BSBA",              label: "BS Business Administration" },
    { value: "BSEntrepreneurship", label: "BS Entrepreneurship" },
    { value: "BEEd",              label: "Bachelor of Elementary Education (BEEd)" },
    { value: "BSEd",              label: "Bachelor of Secondary Education (BSEd)" },
    { value: "BPE",               label: "Bachelor of Physical Education" },
    { value: "BSF",               label: "BS Fisheries" },
    { value: "BSN",               label: "BS Nursing" },
    { value: "BSM",               label: "BS Midwifery" },
    { value: "BSSA",              label: "BS Social Work" },
  ],
  "Occidental Mindoro State College - San Jose Campus": [
    { value: "BSIT",              label: "BS Information Technology (BSIT)" },
    { value: "BSCS",              label: "BS Computer Science" },
    { value: "BSAg",              label: "BS Agriculture" },
    { value: "BSAgTech",          label: "BS Agricultural Technology" },
    { value: "BSAgroforestry",    label: "BS Agroforestry" },
    { value: "BSCrim",            label: "BS Criminology" },
    { value: "BSHM",              label: "BS Hospitality Management" },
    { value: "BSTM",              label: "BS Tourism Management" },
    { value: "BSBA",              label: "BS Business Administration" },
    { value: "BSEntrepreneurship", label: "BS Entrepreneurship" },
    { value: "BEEd",              label: "Bachelor of Elementary Education (BEEd)" },
    { value: "BSEd",              label: "Bachelor of Secondary Education (BSEd)" },
    { value: "BPE",               label: "Bachelor of Physical Education" },
    { value: "BSF",               label: "BS Fisheries" },
    { value: "TESDA-Automotive",  label: "TESDA – Automotive Servicing" },
    { value: "TESDA-Welding",     label: "TESDA – Welding Technology" },
    { value: "TESDA-Electrical",  label: "TESDA – Electrical Technology" },
    { value: "TESDA-FoodService", label: "TESDA – Food Service Management" },
  ],
  "Occidental Mindoro State College - Murtha Lower Campus": [
    { value: "BSAg",           label: "BS Agriculture" },
    { value: "BSAgTech",       label: "BS Agricultural Technology" },
    { value: "BSAgroforestry", label: "BS Agroforestry" },
    { value: "BSAgribusiness", label: "Agribusiness Management" },
    { value: "BSAnimalSci",    label: "Animal Science" },
    { value: "BSCropSci",      label: "Crop Science" },
  ],
  "Occidental Mindoro State College - Murtha Campus": [
    { value: "BSAg",           label: "BS Agriculture" },
    { value: "BSAgTech",       label: "BS Agricultural Technology" },
    { value: "BSAgroforestry", label: "BS Agroforestry" },
    { value: "BSAgribusiness", label: "Agribusiness Management" },
    { value: "BSAnimalSci",    label: "Animal Science" },
    { value: "BSCropSci",      label: "Crop Science" },
  ],
  "Divine Word College of San Jose": [
    { value: "BSN",   label: "BS Nursing" },
    { value: "BSIT",  label: "BS Information Technology" },
    { value: "BSBA",  label: "BS Business Administration" },
    { value: "BSCrim", label: "BS Criminology" },
    { value: "BSHM",  label: "BS Hospitality Management" },
    { value: "BSTM",  label: "BS Tourism Management" },
    { value: "BEEd",  label: "Bachelor of Elementary Education (BEEd)" },
    { value: "BSEd",  label: "Bachelor of Secondary Education (BSEd)" },
  ],
  "Philippine Central Islands College": [
    { value: "BSCrim", label: "BS Criminology" },
    { value: "BSBA",  label: "BS Business Administration" },
    { value: "BSIT",  label: "BS Information Technology" },
    { value: "BSHM",  label: "BS Hospitality Management" },
    { value: "BEEd",  label: "Education Programs" },
    { value: "TESDA-PICOL", label: "TESDA Courses" },
  ],
  "Occidental Mindoro National College": [
    { value: "BSBA-OMNC",  label: "Business Courses" },
    { value: "BEEd-OMNC",  label: "Education Courses" },
    { value: "BSIT-OMNC",  label: "Computer-related Programs" },
    { value: "TVL-OMNC",   label: "Technical-Vocational Courses" },
  ],
  "CAPT. LAWRENCE A. COOPER TECHNICAL COLLEGE": [
    { value: "BSIT-Cooper",      label: "BS Information Technology" },
    { value: "BSEE-Cooper",      label: "BS Electrical Engineering Technology" },
    { value: "BSME-Cooper",      label: "BS Mechanical Engineering Technology" },
    { value: "TESDA-Cooper",     label: "TESDA Technical Programs" },
  ],
  "Saint Joseph College Seminary": [
    { value: "AB-Philosophy",   label: "AB Philosophy" },
    { value: "AB-Theology",     label: "AB Theology" },
    { value: "BEEd-Seminary",  label: "Bachelor of Elementary Education" },
  ],
};

const PREREQUISITE_DOCS = ["Valid ID", "Grades"] as const;

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
  const [scholarships, setScholarships] = useState<{
    id: string; name: string; description: string | null;
    eligibility: string | null; deadline: string | null;
    amount: number; slots: number;
  }[]>([]);
  const [scholarsLoading, setScholarsLoading] = useState(false);
  const [scholarsError, setScholarsError] = useState(false);

  useEffect(() => {
    if (step === 4) {
      setScholarsLoading(true);
      setScholarsError(false);
      fetch("/api/scholarships")
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setScholarships(data); })
        .catch(() => setScholarsError(true))
        .finally(() => setScholarsLoading(false));
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
    } else if (step === 3) {
      const missing = PREREQUISITE_DOCS.filter((doc) => !docFiles[doc]);
      if (missing.length > 0)
        errs.docs = `Please upload the following required documents before proceeding: ${missing.join(" and ")}.`;
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

        <Card className="overflow-hidden">
          <div className="h-1.5 bg-gradient-primary" />
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
                {/* Year Level — first so school list filters accordingly */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Year Level *</Label>
                    <Select
                      value={academic.yearLevel}
                      onValueChange={(v) => {
                        // Reset school & course when level category changes
                        const wasSHS = ["Grade 11", "Grade 12"].includes(academic.yearLevel);
                        const nowSHS = ["Grade 11", "Grade 12"].includes(v);
                        if (wasSHS !== nowSHS) {
                          setAcademic((p) => ({ ...p, yearLevel: v, schoolName: "", course: "" }));
                          setErrors((p) => ({ ...p, yearLevel: "", schoolName: "", course: "" }));
                        } else {
                          updateAcademic("yearLevel", v);
                        }
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select year level" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Grade 11">Grade 11 (SHS)</SelectItem>
                        <SelectItem value="Grade 12">Grade 12 (SHS)</SelectItem>
                        <SelectItem value="1st Year">1st Year (College)</SelectItem>
                        <SelectItem value="2nd Year">2nd Year (College)</SelectItem>
                        <SelectItem value="3rd Year">3rd Year (College)</SelectItem>
                        <SelectItem value="4th Year">4th Year (College)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldError field="yearLevel" />
                  </div>
                  <div>
                    <Label>Average Grade *</Label>
                    <Input
                      type="number"
                      value={academic.averageGrade}
                      onChange={(e) => updateAcademic("averageGrade", e.target.value)}
                      placeholder="e.g. 88"
                    />
                    <FieldError field="averageGrade" />
                    {gradeWarning && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Grade below 85 — application will be automatically rejected.
                      </div>
                    )}
                  </div>
                </div>

                {/* School — filtered by year level */}
                <div>
                  <Label>School Name *</Label>
                  <Select
                    value={academic.schoolName}
                    onValueChange={(v) => {
                      setAcademic((p) => ({ ...p, schoolName: v, course: "" }));
                      setErrors((p) => ({ ...p, schoolName: "", course: "" }));
                    }}
                    disabled={!academic.yearLevel}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={academic.yearLevel ? "Select school" : "Select year level first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {["Grade 11", "Grade 12"].includes(academic.yearLevel) ? (
                        <>
                          <SelectItem value="San Jose National High School">San Jose National High School</SelectItem>
                          <SelectItem value="San Jose National Agricultural & Industrial High School">San Jose National Agricultural &amp; Industrial High School</SelectItem>
                          <SelectItem value="Divine Word College of San Jose (SHS)">Divine Word College of San Jose</SelectItem>
                          <SelectItem value="Pedro T. Mendiola Sr. Memorial National High School">Pedro T. Mendiola Sr. Memorial National High School</SelectItem>
                          <SelectItem value="Mangarin National High School">Mangarin National High School</SelectItem>
                          <SelectItem value="Central National High School">Central National High School</SelectItem>
                          <SelectItem value="301600 Central National High School">301600 Central National High School</SelectItem>
                          <SelectItem value="San Agustin High School">San Agustin High School</SelectItem>
                          <SelectItem value="Caminawit National High School">Caminawit National High School</SelectItem>
                          <SelectItem value="Iling National High School">Iling National High School</SelectItem>
                          <SelectItem value="Iling National High School – Pawican Annex">Iling National High School – Pawican Annex</SelectItem>
                          <SelectItem value="Holy Family Academy of Central">Holy Family Academy of Central</SelectItem>
                          <SelectItem value="San Jose Adventist Academy Inc.">San Jose Adventist Academy Inc.</SelectItem>
                        </>
                      ) : ["1st Year", "2nd Year", "3rd Year", "4th Year"].includes(academic.yearLevel) ? (
                        <>
                          <SelectItem value="Occidental Mindoro State College - Main Campus">Occidental Mindoro State College – Main Campus</SelectItem>
                          <SelectItem value="Occidental Mindoro State College - San Jose Campus">Occidental Mindoro State College – San Jose Campus</SelectItem>
                          <SelectItem value="Occidental Mindoro State College - Murtha Lower Campus">Occidental Mindoro State College – Murtha Lower Campus</SelectItem>
                          <SelectItem value="Occidental Mindoro State College - Murtha Campus">Occidental Mindoro State College – Murtha Campus</SelectItem>
                          <SelectItem value="Divine Word College of San Jose">Divine Word College of San Jose</SelectItem>
                          <SelectItem value="Philippine Central Islands College">Philippine Central Islands College</SelectItem>
                          <SelectItem value="Occidental Mindoro National College">Occidental Mindoro National College</SelectItem>
                          <SelectItem value="CAPT. LAWRENCE A. COOPER TECHNICAL COLLEGE">CAPT. LAWRENCE A. COOPER TECHNICAL COLLEGE</SelectItem>
                          <SelectItem value="Saint Joseph College Seminary">Saint Joseph College Seminary</SelectItem>
                        </>
                      ) : null}
                    </SelectContent>
                  </Select>
                  <FieldError field="schoolName" />
                </div>

                {/* Course / Strand — filtered by school (college) or year level (SHS) */}
                <div>
                  <Label>Course / Strand *</Label>
                  <Select
                    value={academic.course}
                    onValueChange={(v) => updateAcademic("course", v)}
                    disabled={!academic.yearLevel || (["1st Year", "2nd Year", "3rd Year", "4th Year"].includes(academic.yearLevel) && !academic.schoolName)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={
                        !academic.yearLevel ? "Select year level first"
                        : ["1st Year", "2nd Year", "3rd Year", "4th Year"].includes(academic.yearLevel) && !academic.schoolName
                          ? "Select school first"
                          : "Select course / strand"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {["Grade 11", "Grade 12"].includes(academic.yearLevel)
                        ? SHS_STRANDS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))
                        : (COURSES_BY_SCHOOL[academic.schoolName] ?? []).map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))
                      }
                    </SelectContent>
                  </Select>
                  <FieldError field="course" />
                </div>
              </>
            )}

            {/* STEP 3: Document Upload */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
                  <span className="font-semibold text-primary">Valid ID</span> and <span className="font-semibold text-primary">Grades</span> are required to proceed. The remaining documents can be uploaded later from your dashboard.
                </div>

                {/* Prerequisites */}
                <div className="space-y-2">
                  <p className="text-xs font-bold text-primary tracking-widest uppercase">Required to Proceed</p>
                  {PREREQUISITE_DOCS.map((doc) => (
                    <div
                      key={doc}
                      className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${
                        docFiles[doc]
                          ? "border-success/40 bg-success/5"
                          : "border-primary/30 bg-primary/5"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Upload className={`h-5 w-5 ${docFiles[doc] ? "text-success" : "text-primary"}`} />
                        <div>
                          <p className="text-sm font-semibold">
                            {doc}
                            <span className="ml-1.5 text-primary text-xs">*</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {docFiles[doc] ? docFiles[doc]!.name : "Required — not uploaded"}
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
                            setErrors((p) => ({ ...p, docs: "" }));
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

                {/* Optional documents */}
                <div className="space-y-2">
                  <p className="text-xs font-bold text-muted-foreground tracking-widest uppercase">Optional — Upload Later</p>
                  {requiredDocuments.filter((d) => !(PREREQUISITE_DOCS as readonly string[]).includes(d)).map((doc) => (
                    <div key={doc} className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${docFiles[doc] ? "border-success/40 bg-success/5" : ""}`}>
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

                {errors.docs && (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {errors.docs}
                  </div>
                )}
              </div>
            )}

            {/* STEP 4: Select Scholarship */}
            {step === 4 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Select from currently available scholarship programs below, or skip and apply later from your dashboard.
                </p>

                {/* Loading */}
                {scholarsLoading && (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading available scholarships…
                  </div>
                )}

                {/* Error */}
                {scholarsError && (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Failed to load scholarships. Check your connection and try again.
                  </div>
                )}

                {/* Scholarship cards */}
                {!scholarsLoading && !scholarsError && (
                  scholarships.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                      <GraduationCap className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      No active scholarships at the moment. You can apply later from your dashboard.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {scholarships.map((s) => {
                        const isSelected = selectedScholarship === s.id;
                        const deadline = s.deadline
                          ? new Date(s.deadline).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
                          : "Open";
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setSelectedScholarship(isSelected ? "" : s.id)}
                            className={`w-full text-left rounded-xl border p-4 transition-all duration-200 cursor-pointer ${
                              isSelected
                                ? "border-primary bg-primary/5 shadow-sm"
                                : "border-border hover:border-primary/40 hover:bg-muted/30"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 space-y-1">
                                <p className={`text-sm font-semibold ${isSelected ? "text-primary" : "text-foreground"}`}>
                                  {s.name}
                                </p>
                                {s.description && (
                                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                                    {s.description}
                                  </p>
                                )}
                                {s.eligibility && (
                                  <p className="text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">Eligibility:</span> {s.eligibility}
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
                                  <span>📅 Deadline: <span className="text-foreground font-medium">{deadline}</span></span>
                                  {s.amount > 0 && <span>💰 ₱{s.amount.toLocaleString()} / scholar</span>}
                                  {s.slots > 0 && <span>👥 {s.slots} slot{s.slots !== 1 ? "s" : ""}</span>}
                                </div>
                              </div>
                              <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                                isSelected ? "border-primary bg-primary" : "border-border"
                              }`}>
                                {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )
                )}

                {/* Review summary */}
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <h4 className="font-semibold text-sm">Review Your Information</h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <p>Name: <span className="text-foreground">{form.firstName} {form.lastName}</span></p>
                    <p>Email: <span className="text-foreground">{email}</span></p>
                    <p>School: <span className="text-foreground">{academic.schoolName}</span></p>
                    <p>Course: <span className="text-foreground">{academic.course}</span></p>
                    <p>Grade: <span className="text-foreground">{academic.averageGrade}</span></p>
                    <p>Docs uploaded: <span className="text-foreground">{Object.values(docFiles).filter(Boolean).length}/{requiredDocuments.length}</span></p>
                  </div>
                  {selectedScholarship && (
                    <p className="text-sm pt-1 border-t border-border/50">
                      Applying for: <span className="font-semibold text-primary">{scholarships.find((s) => s.id === selectedScholarship)?.name}</span>
                    </p>
                  )}
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
