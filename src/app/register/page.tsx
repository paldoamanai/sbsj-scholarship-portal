"use client";

import { useHistorySync } from "@/hooks/use-history-sync";
import { useState, useEffect, useRef } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import {
  User, School, Lock, Upload, ChevronRight, ChevronLeft, AlertTriangle, Loader2, GraduationCap, Eye, EyeOff, CalendarIcon,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { rememberCredential } from "@/lib/credentials";
import { DOC_MIME, uploadUserDocument } from "@/lib/documents";
import { YEAR_LEVEL_OPTIONS, coursesFor, isCollege, isSHS, schoolsFor } from "@/lib/academics";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { availabilityInfo, peso, requirementLines, slotsLabel, type PublicScholarship } from "@/lib/scholarships";
import type { RegistrationProfileFields } from "@/lib/registration-profile";

const stepLabels = ["Account", "Personal Info", "School Info", "Documents", "Apply"];

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
  const { settings } = useSystemSettings();
  const minGrade = settings.min_grade_requirement || 85;
  const [step, setStep] = useState(0);
  const maxStep = useRef(0);
  maxStep.current = Math.max(maxStep.current, step);
  // Swipe/browser back and forward move between steps, but only to steps already completed.
  useHistorySync("sbsjStep", step, setStep, (s) => s <= maxStep.current);
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
    studentIdNumber: "",
  });
  const [dob, setDob] = useState<Date | undefined>(undefined);
  const [dobOpen, setDobOpen] = useState(false);
  const [pendingDob, setPendingDob] = useState<Date | undefined>(undefined);

  // Step 2 — Academic
  const [academic, setAcademic] = useState({
    schoolName: "", course: "", yearLevel: "", averageGrade: "",
  });

  // Step 3 — Documents
  const [docFiles, setDocFiles] = useState<Record<string, File | null>>({});

  // Step 4 — Scholarship selection
  const [selectedScholarship, setSelectedScholarship] = useState("");
  const [scholarships, setScholarships] = useState<PublicScholarship[]>([]);
  const [scholarsLoading, setScholarsLoading] = useState(false);
  const [scholarsError, setScholarsError] = useState(false);

  // Coming from "Apply Now" on the public pages with a program already chosen.
  useEffect(() => {
    const program = new URLSearchParams(window.location.search).get("program");
    if (program) setSelectedScholarship(program);
  }, []);

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
      if (!dob) errs.dob = "Required";
      if (!form.phone.trim() || !/^(09|\+639)\d{9}$/.test(form.phone.replace(/\s/g, "")))
        errs.phone = "Valid PH phone required";
      if (!form.barangay.trim()) errs.barangay = "Required";
      if (!form.municipality.trim()) errs.municipality = "Required";
      if (!form.studentIdNumber.trim()) errs.studentIdNumber = "Required";
    } else if (step === 2) {
      if (!academic.schoolName.trim()) errs.schoolName = "Required";
      if (!academic.course.trim()) errs.course = "Required";
      if (!academic.yearLevel) errs.yearLevel = "Required";
      if (!academic.averageGrade.trim()) errs.averageGrade = "Required";
      else if (parseFloat(academic.averageGrade) < minGrade) errs.averageGrade = `Must be ${minGrade} or above to be eligible`;
    } else if (step === 3) {
      const missing = PREREQUISITE_DOCS.filter((doc) => !docFiles[doc]);
      if (missing.length > 0)
        errs.docs = `Please upload the following required documents before proceeding: ${missing.join(" and ")}.`;
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validateStep()) setStep((s) => s + 1); };
  const back = () => { if (step > 0) window.history.back(); };

  const handleSubmit = async () => {
    setLoading(true);
    const supabase = createClient();
    const profileFields: RegistrationProfileFields = {
      first_name: form.firstName,
      middle_name: form.middleName || null,
      last_name: form.lastName,
      sex: form.sex,
      civil_status: form.civilStatus,
      nationality: form.nationality,
      dob: dob ? format(dob, "yyyy-MM-dd") : "",
      phone: form.phone,
      barangay: form.barangay,
      municipality: form.municipality,
      school_name: academic.schoolName,
      course: academic.course,
      year_level: academic.yearLevel,
      average_grade: parseFloat(academic.averageGrade),
      student_id_number: form.studentIdNumber,
    };

    // 1. Create auth user. Metadata is copied into public.profiles by handle_new_user,
    // including when email confirmation is on and there is no session yet.
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          ...profileFields,
          average_grade: String(profileFields.average_grade),
        },
      },
    });

    if (authError || !authData.user) {
      toast.error("Registration failed", { description: authError?.message });
      setLoading(false);
      return;
    }

    const userId = authData.user.id;
    // Ask the browser to remember these credentials, in addition to the native
    // save-password prompt the <form> submit below already triggers.
    rememberCredential(email, password);

    // Email confirmation is enabled — user is not authenticated yet, so RLS-protected
    // writes would fail. The auth trigger still inserts the profile from metadata.
    if (!authData.session) {
      toast.success("Account created!", {
        description: "Check your email to verify your account, then log in to upload documents and apply.",
      });
      setLoading(false);
      router.push("/login");
      return;
    }

    // 2. Upsert profile (update is a no-op if the signup trigger never created a row)
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: userId,
      email,
      ...profileFields,
    });

    if (profileError) {
      toast.error("Profile save failed", { description: profileError.message });
      setLoading(false);
      return;
    }

    // 3. Upload documents. A file the database refuses (wrong type, too large, not on the current
    // required list) doesn't block registration: the student can upload it again from the dashboard.
    const failed: string[] = [];
    for (const [docType, file] of Object.entries(docFiles)) {
      if (!file) continue;
      if (!DOC_MIME.includes(file.type)) { failed.push(docType); continue; }
      const result = await uploadUserDocument(supabase, { userId, docType, file });
      if ("error" in result) failed.push(docType);
    }
    if (failed.length > 0) {
      toast.warning("Some documents were not uploaded", {
        description: `Upload ${failed.join(", ")} again from your dashboard (PDF, JPG or PNG).`,
      });
    }

    // 4. The application itself (statement, household details, certification) is completed in the
    // dashboard; hand over the program picked here so it is already selected.
    const target = selectedScholarship
      ? `/student-dashboard?section=application&apply=${encodeURIComponent(selectedScholarship)}`
      : "/student-dashboard";

    toast.success("Registration submitted successfully!", {
      description: selectedScholarship ? "Finish your application in your dashboard." : "Please check your email for verification.",
    });
    router.push(target);
    router.refresh();
    setLoading(false);
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (step === 4) handleSubmit();
    else next();
  };

  const gradeWarning = academic.averageGrade && parseFloat(academic.averageGrade) < minGrade;

  const FieldError = ({ field }: { field: string }) =>
    errors[field] ? <p className="text-xs text-destructive mt-1">{errors[field]}</p> : null;

  return (
    <Layout>
      <div className="container max-w-2xl py-6 sm:py-12">
        {/* Step indicator: a progress bar on phones, numbered steps from sm up */}
        <div className="sm:hidden mb-5" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-semibold text-foreground">{stepLabels[step]}</p>
            <p className="text-xs text-muted-foreground">Step {step + 1} of {stepLabels.length}</p>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${((step + 1) / stepLabels.length) * 100}%` }} />
          </div>
        </div>
        <div className="hidden sm:flex items-center justify-center gap-2 mb-8">
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
          <CardHeader className="px-4 pt-5 pb-3 sm:p-6">
            <CardTitle className="font-display flex items-center gap-2 text-lg sm:text-2xl">
              {step === 0 && <><Lock className="h-5 w-5 text-primary" /> Account Setup</>}
              {step === 1 && <><User className="h-5 w-5 text-primary" /> Personal Information</>}
              {step === 2 && <><School className="h-5 w-5 text-primary" /> School Information</>}
              {step === 3 && <><Upload className="h-5 w-5 text-primary" /> Document Upload</>}
              {step === 4 && <><GraduationCap className="h-5 w-5 text-primary" /> Select Scholarship</>}
            </CardTitle>
            <CardDescription>Fill in all required fields to proceed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-4 pb-0 sm:px-6 sm:pb-6">
            <form onSubmit={handleFormSubmit} noValidate>
            {/* Kept mounted across all steps so the browser has a username+password
                pair present in the form at final submit, even though the real fields
                above are only rendered during Step 0. Visually hidden, not display:none,
                so password managers still recognize and offer to save them. */}
            <div aria-hidden="true" className="absolute h-px w-px overflow-hidden" style={{ clip: "rect(0,0,0,0)" }}>
              <input type="email" autoComplete="username" readOnly tabIndex={-1} value={email} onChange={() => {}} />
              <input type="password" autoComplete="new-password" readOnly tabIndex={-1} value={password} onChange={() => {}} />
            </div>

            {/* STEP 0: Account */}
            {step === 0 && (
              <>
                <div><Label>Email *</Label><Input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => { setEmail(e.target.value); setErrors(p => ({ ...p, email: "" })); }} /><FieldError field="email" /></div>
                <div>
                  <Label>Password *</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setErrors(p => ({ ...p, password: "" })); }}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Hide password" : "Show password"}
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
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setErrors(p => ({ ...p, confirmPassword: "" })); }}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
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
                <div>
                  <Label>Student ID Number *</Label>
                  <Input autoComplete="off" value={form.studentIdNumber} onChange={(e) => update("studentIdNumber", e.target.value)} />
                  <FieldError field="studentIdNumber" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div><Label>Last Name *</Label><Input autoComplete="family-name" value={form.lastName} onChange={(e) => update("lastName", e.target.value)} /><FieldError field="lastName" /></div>
                  <div><Label>First Name *</Label><Input autoComplete="given-name" value={form.firstName} onChange={(e) => update("firstName", e.target.value)} /><FieldError field="firstName" /></div>
                  <div><Label>Middle Name</Label><Input autoComplete="additional-name" value={form.middleName} onChange={(e) => update("middleName", e.target.value)} /></div>
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
                  {/* Phones get the native date picker (large targets, no tiny dropdowns). */}
                  <Input
                    type="date"
                    className="sm:hidden"
                    autoComplete="bday"
                    min="1925-01-01"
                    max={format(new Date(), "yyyy-MM-dd")}
                    value={dob ? format(dob, "yyyy-MM-dd") : ""}
                    onChange={(e) => {
                      setDob(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined);
                      setErrors((p) => ({ ...p, dob: "" }));
                    }}
                  />
                  <div className="hidden sm:block">
                  <Popover
                    open={dobOpen}
                    onOpenChange={(open) => { setDobOpen(open); if (open) setPendingDob(dob); }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !dob && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dob ? format(dob, "MMMM d, yyyy") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={pendingDob}
                        onSelect={setPendingDob}
                        captionLayout="dropdown-buttons"
                        fromYear={new Date().getFullYear() - 100}
                        toYear={new Date().getFullYear()}
                        disabled={{ after: new Date() }}
                        defaultMonth={pendingDob ?? dob ?? new Date(new Date().getFullYear() - 18, 0)}
                        initialFocus
                      />
                      <div className="flex justify-end gap-2 border-t p-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setDobOpen(false)}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!pendingDob}
                          onClick={() => {
                            setDob(pendingDob);
                            setErrors((p) => ({ ...p, dob: "" }));
                            setDobOpen(false);
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  </div>
                  <FieldError field="dob" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><Label>Phone Number *</Label><Input type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="09XXXXXXXXX" /><FieldError field="phone" /></div>
                  <div><Label>Barangay *</Label><Input autoComplete="address-level3" value={form.barangay} onChange={(e) => update("barangay", e.target.value)} /><FieldError field="barangay" /></div>
                </div>
                <div><Label>Municipality *</Label><Input autoComplete="address-level2" value={form.municipality} onChange={(e) => update("municipality", e.target.value)} /><FieldError field="municipality" /></div>
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
                        const wasSHS = isSHS(academic.yearLevel);
                        const nowSHS = isSHS(v);
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
                        {YEAR_LEVEL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FieldError field="yearLevel" />
                  </div>
                  <div>
                    <Label>Average Grade *</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={academic.averageGrade}
                      onChange={(e) => updateAcademic("averageGrade", e.target.value)}
                      placeholder={`${minGrade}% above`}
                    />
                    <FieldError field="averageGrade" />
                    {gradeWarning && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Grade below {minGrade} — application will be automatically rejected.
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
                      {schoolsFor(academic.yearLevel).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
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
                    disabled={!academic.yearLevel || (isCollege(academic.yearLevel) && !academic.schoolName)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={
                        !academic.yearLevel ? "Select year level first"
                        : isCollege(academic.yearLevel) && !academic.schoolName
                          ? "Select school first"
                          : "Select course / strand"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {coursesFor(academic.yearLevel, academic.schoolName).map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
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
                      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border p-3 sm:p-4 transition-colors ${
                        docFiles[doc]
                          ? "border-success/40 bg-success/5"
                          : "border-primary/30 bg-primary/5"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Upload className={`h-5 w-5 shrink-0 ${docFiles[doc] ? "text-success" : "text-primary"}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">
                            {doc}
                            <span className="ml-1.5 text-primary text-xs">*</span>
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
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
                        <span className="inline-flex w-full sm:w-auto items-center justify-center gap-1 rounded-md border px-3 py-2.5 sm:py-1.5 text-sm font-medium hover:bg-muted cursor-pointer">
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
                    <div key={doc} className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border p-3 sm:p-4 transition-colors ${docFiles[doc] ? "border-success/40 bg-success/5" : ""}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <Upload className={`h-5 w-5 shrink-0 ${docFiles[doc] ? "text-success" : "text-muted-foreground"}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{doc}</p>
                          <p className="text-xs text-muted-foreground truncate">
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
                        <span className="inline-flex w-full sm:w-auto items-center justify-center gap-1 rounded-md border px-3 py-2.5 sm:py-1.5 text-sm font-medium hover:bg-muted cursor-pointer">
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
                  Pick a scholarship program below, or skip and apply later from your dashboard. You will finish the application (your statement and certification) in your dashboard right after registering.
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
                        const avail = availabilityInfo(s);
                        const reqs = requirementLines(s);
                        const deadline = s.deadline
                          ? new Date(s.deadline).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
                          : "Open";
                        return (
                          <button
                            key={s.id}
                            type="button"
                            disabled={!avail.canApply}
                            onClick={() => setSelectedScholarship(isSelected ? "" : s.id)}
                            className={`w-full text-left rounded-xl border p-4 transition-all duration-200 ${avail.canApply ? "cursor-pointer" : "opacity-60 cursor-not-allowed"} ${
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
                                {(reqs.length > 0 || s.eligibility) && (
                                  <p className="text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">Eligibility:</span> {[...reqs, s.eligibility].filter(Boolean).join(" · ")}
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
                                  <span>📅 Deadline: <span className="text-foreground font-medium">{deadline}</span></span>
                                  {Number(s.amount) > 0 && <span>💰 <span className="text-foreground font-medium">{peso(s.amount)}</span> per scholar</span>}
                                  <span>👥 {slotsLabel(s)}</span>
                                  {!avail.canApply && <span className="font-semibold text-destructive">{avail.label}</span>}
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground [&>p]:break-words">
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
            <div className="sticky bottom-0 z-10 -mx-4 flex justify-between gap-3 border-t bg-card/95 px-4 pt-3 pb-safe backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-4 sm:pb-0 sm:backdrop-blur-none">
              {step > 0 ? (
                <Button type="button" variant="outline" onClick={back} className="flex-1 sm:flex-none">
                  <ChevronLeft className="mr-1 h-4 w-4" /> Back
                </Button>
              ) : (
                <div />
              )}
              {step < 4 ? (
                <Button type="button" onClick={next} className="flex-1 sm:flex-none bg-gradient-primary shadow-primary">
                  Next <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button type="submit" className="flex-1 sm:flex-none bg-gradient-primary shadow-primary" disabled={loading}>
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
            </form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
