import { formatDate } from "@/lib/format";
import type { AppSettings, ApplicationsBlock } from "@/lib/settings";

// Text for the landing page. Values that come from the settings (contact details, document names,
// the maintenance message) are shown as the office wrote them.

const times = (n: number) => `${n} ${n === 1 ? "time" : "times"}`;

function windowText(block: ApplicationsBlock | null, closeDate: string): string {
  if (!block) return closeDate ? `Applications are open until ${formatDate(closeDate)}.` : "Applications are open.";
  switch (block.kind) {
    case "maintenance": return block.message;
    case "closed": return "Applications are currently closed.";
    case "not_yet": return `Applications open on ${formatDate(block.date)}.`;
    case "ended": return `The application period ended on ${formatDate(block.date)}.`;
  }
}

function faqs(s: AppSettings, period: string): { q: string; a: string }[] {
  const docs = s.required_documents;
  const methods = s.payment_methods.join(" or ").toLowerCase();
  const pickup = s.payment_pickup_location;
  const phone = s.contact_phone;
  const hours = s.office_hours;

  return [
    {
      q: "Who can apply?",
      a: `Students of San Jose, Occidental Mindoro who meet a general average of at least ${s.min_grade_requirement}. Each program may add its own conditions, such as year level or residency, which are listed on its card above.`,
    },
    {
      q: "What documents do I need?",
      a: docs.length ? `Prepare: ${docs.join(", ")}. Upload them in your dashboard when you apply.` : "The required documents are listed in your dashboard when you apply.",
    },
    {
      q: "When can I apply?",
      a: `${period} Individual programs also show their own opening dates and deadlines.`,
    },
    {
      q: "How many scholarships can I apply for?",
      a: "You can apply to every open program. Each program reviews you against its own requirements, so you can be approved for more than one.",
    },
    {
      q: "How do I track my application?",
      a: "Sign in and open your dashboard. Every stage of your application, and your payout status, is shown there, and you are notified in the portal and by email when something changes.",
    },
    {
      q: "How are funds released?",
      a: `Payouts are made by ${methods}.${pickup ? ` Claim at: ${pickup}.` : ""} ${s.payment_pickup_instructions}`.trim(),
    },
    ...(s.renewal_enabled
      ? [{
          q: "Can I renew my scholarship?",
          a: `Yes. Scholars who keep a general average of at least ${s.renewal_min_grade} can renew, up to ${times(s.max_renewals)}.`,
        }]
      : []),
    {
      q: "Who do I contact for help?",
      a: `Email ${s.contact_email}${phone ? ` or call ${phone}` : ""}${hours ? ` (${hours})` : ""}, or use the contact form below.`,
    },
  ];
}

export function landingCopy(s: AppSettings, block: ApplicationsBlock | null) {
  const period = windowText(block, s.application_close_date);

  return {
    hero: {
      title: ["San Jose Scholarship &", "Financial Assistance"],
      subtitle: "Apply, track, and receive your scholarship or financial assistance with full transparency.",
      register: "Register Now",
      registerClosed: "Create an Account",
      signIn: "Sign In",
      dashboard: "Go to Dashboard",
      closedNote: "You can still create an account so you're ready when applications open.",
      openNow: (n: number) =>
        `${n} ${n === 1 ? "program is" : "programs are"} open now — see programs`,
      scroll: "Scroll to learn more",
    },
    dates: {
      title: block ? "Applications" : "Application period",
      period,
      opens: (d: string) => `Opens ${formatDate(d)}`,
      due: (d: string) => `Due ${formatDate(d)}`,
    },
    stats: {
      applications: "Applications received",
      scholars: "Scholars supported",
      programs: "Active programs",
    },
    news: {
      label: "Announcements",
      heading: ["Latest", "News"],
    },
    programs: {
      label: "Scholarships",
      heading: ["Available", "Programs"],
      desc: (open: number) =>
        open > 0
          ? `${open} ${open === 1 ? "program is" : "programs are"} accepting applications. Browse and apply for the ones that match your qualifications.`
          : "Browse and apply for scholarships that match your qualifications and goals.",
      emptyTitle: "No scholarships available right now",
      emptyDesc: "Check back soon — new programs will be posted here.",
      errorTitle: "We couldn't load the programs",
      errorDesc: "Check your connection and try again.",
      retry: "Try again",
      viewAll: "View All Scholarships",
    },
    process: {
      label: "Process",
      heading: ["From Application to", "Disbursement"],
      desc: "Five simple steps, start to finish.",
      step: "STEP",
      steps: [
        { title: "Register", desc: "Create your account in under 2 minutes." },
        { title: "Apply", desc: "Fill guided forms and upload documents." },
        { title: "Review", desc: "Admins verify your submission." },
        { title: "Get Approved", desc: "We notify you once your application is approved." },
        { title: "Receive Funds", desc: "Claim your payout once it is released." },
      ],
    },
    requirements: {
      label: "Requirements",
      heading: ["Before You", "Apply"],
      desc: "What you need, and what makes you eligible.",
      eligibility: "Eligibility",
      eligibilityItems: [
        `General average of at least ${s.min_grade_requirement}`,
        "Apply to any open program; each one approves you on its own requirements",
        ...(s.renewal_enabled
          ? [`Renewable while you keep an average of ${s.renewal_min_grade}+ (up to ${times(s.max_renewals)})`]
          : []),
        "Year level, residency and other conditions are shown on each program card",
      ],
      documents: "Documents to prepare",
      noDocuments: "The documents you need are listed in your dashboard when you apply.",
      uploadNote: `Upload clear photos or scans. Files up to ${s.max_upload_mb} MB each.`,
    },
    history: {
      label: "Our Impact",
      heading: ["Scholars Through", "the Years"],
      desc: "The number of scholars approved in each school year.",
      scholars: (n: number) => `${n.toLocaleString()} ${n === 1 ? "scholar" : "scholars"}`,
    },
    features: {
      label: "Our Platform",
      heading: ["Everything You Need,", "In One Place"],
      desc: "Built to make scholarship management seamless for students and administrators alike.",
      items: [
        { title: "Easy Application", desc: "Apply in minutes with guided step-by-step forms — no confusion, no paperwork hassle." },
        { title: "Real-Time Tracking", desc: "Monitor every stage of your application and payment status from your personal dashboard." },
        { title: "Secure Disbursement", desc: "Funds are released with full audit trails and status updates." },
        { title: "Instant Notifications", desc: "Stay informed at every milestone with timely in-app and email alerts." },
      ],
    },
    faq: {
      label: "FAQ",
      heading: ["Frequently Asked", "Questions"],
      items: faqs(s, period),
    },
    offeredBy: {
      label: "Offered by",
      sub: "Local Government Unit of San Jose, Occidental Mindoro",
    },
    contact: {
      label: "Contact Us",
      heading: ["We'd Love to", "Hear from You"],
      desc: "Have questions? Reach out and we'll get back to you within 1-2 business days.",
      email: "Email",
      phone: "Phone",
      office: "Office",
      hours: "Office Hours",
      directions: "Open in Maps",
    },
  };
}

export type LandingCopy = ReturnType<typeof landingCopy>;
