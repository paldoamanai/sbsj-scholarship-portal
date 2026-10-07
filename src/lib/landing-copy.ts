import { formatDate } from "@/lib/format";
import type { AppSettings, ApplicationsBlock } from "@/lib/settings";

// Text for the landing page in English and Filipino. Values that come from the settings (contact
// details, document names, the maintenance message) are shown as the office wrote them.

export type LandingLang = "en" | "fil";
export const LANDING_LANGS: { code: LandingLang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fil", label: "Filipino" },
];

const times = (n: number, lang: LandingLang) => (lang === "fil" ? `${n} beses` : `${n} ${n === 1 ? "time" : "times"}`);

function windowText(lang: LandingLang, block: ApplicationsBlock | null, closeDate: string): string {
  if (lang === "fil") {
    if (!block) return closeDate ? `Bukas ang aplikasyon hanggang ${formatDate(closeDate)}.` : "Bukas ang aplikasyon.";
    switch (block.kind) {
      case "maintenance": return block.message;
      case "closed": return "Sarado ang aplikasyon sa ngayon.";
      case "not_yet": return `Magbubukas ang aplikasyon sa ${formatDate(block.date)}.`;
      case "ended": return `Natapos ang panahon ng aplikasyon noong ${formatDate(block.date)}.`;
    }
  }
  if (!block) return closeDate ? `Applications are open until ${formatDate(closeDate)}.` : "Applications are open.";
  switch (block.kind) {
    case "maintenance": return block.message;
    case "closed": return "Applications are currently closed.";
    case "not_yet": return `Applications open on ${formatDate(block.date)}.`;
    case "ended": return `The application period ended on ${formatDate(block.date)}.`;
  }
}

function faqs(lang: LandingLang, s: AppSettings, period: string): { q: string; a: string }[] {
  const docs = s.required_documents;
  const methods = s.payment_methods.join(lang === "fil" ? " o " : " or ").toLowerCase();
  const pickup = s.payment_pickup_location;
  const phone = s.contact_phone;
  const hours = s.office_hours;

  if (lang === "fil") {
    return [
      {
        q: "Sino ang puwedeng mag-apply?",
        a: `Mga mag-aaral ng San Jose, Occidental Mindoro na may general average na hindi bababa sa ${s.min_grade_requirement}. Maaaring may sariling kondisyon ang bawat programa, gaya ng year level o tirahan, na nakasulat sa card nito sa itaas.`,
      },
      {
        q: "Anong mga dokumento ang kailangan ko?",
        a: docs.length ? `Ihanda ang: ${docs.join(", ")}. I-upload ang mga ito sa iyong dashboard kapag nag-apply ka.` : "Makikita sa iyong dashboard ang mga kailangang dokumento kapag nag-apply ka.",
      },
      {
        q: "Kailan ako puwedeng mag-apply?",
        a: `${period} May sariling petsa ng pagbubukas at deadline din ang bawat programa.`,
      },
      {
        q: "Ilang scholarship ang puwede kong applyan?",
        a: "Puwede kang mag-apply sa lahat ng bukas na programa. Sinusuri ka ng bawat programa ayon sa sarili nitong mga kailangan, kaya maaari kang maaprubahan sa higit sa isa.",
      },
      {
        q: "Paano ko masusubaybayan ang aking aplikasyon?",
        a: "Mag-sign in at buksan ang iyong dashboard. Makikita roon ang bawat yugto ng iyong aplikasyon at ang estado ng iyong bayad, at aabisuhan ka sa portal at sa email kapag may pagbabago.",
      },
      {
        q: "Paano ibinibigay ang pondo?",
        a: `Ibinibigay ang bayad sa pamamagitan ng ${methods}.${pickup ? ` Kunin sa: ${pickup}.` : ""} ${s.payment_pickup_instructions}`.trim(),
      },
      ...(s.renewal_enabled
        ? [{
            q: "Puwede ko bang i-renew ang aking scholarship?",
            a: `Oo. Ang mga iskolar na may general average na hindi bababa sa ${s.renewal_min_grade} ay puwedeng mag-renew, hanggang ${times(s.max_renewals, lang)}.`,
          }]
        : []),
      {
        q: "Kanino ako lalapit kung kailangan ko ng tulong?",
        a: `Mag-email sa ${s.contact_email}${phone ? ` o tumawag sa ${phone}` : ""}${hours ? ` (${hours})` : ""}, o gamitin ang contact form sa ibaba.`,
      },
    ];
  }

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
          a: `Yes. Scholars who keep a general average of at least ${s.renewal_min_grade} can renew, up to ${times(s.max_renewals, lang)}.`,
        }]
      : []),
    {
      q: "Who do I contact for help?",
      a: `Email ${s.contact_email}${phone ? ` or call ${phone}` : ""}${hours ? ` (${hours})` : ""}, or use the contact form below.`,
    },
  ];
}

export function landingCopy(lang: LandingLang, s: AppSettings, block: ApplicationsBlock | null) {
  const period = windowText(lang, block, s.application_close_date);
  const fil = lang === "fil";

  return {
    languageLabel: fil ? "Wika" : "Language",
    hero: {
      title: fil ? ["Iskolarship at Tulong", "Pinansyal ng San Jose"] : ["San Jose Scholarship &", "Financial Assistance"],
      subtitle: fil
        ? "Mag-apply, subaybayan, at tanggapin ang iyong scholarship o tulong pinansyal nang malinaw at bukas."
        : "Apply, track, and receive your scholarship or financial assistance with full transparency.",
      register: fil ? "Magparehistro" : "Register Now",
      registerClosed: fil ? "Gumawa ng Account" : "Create an Account",
      signIn: fil ? "Mag-sign In" : "Sign In",
      dashboard: fil ? "Pumunta sa Dashboard" : "Go to Dashboard",
      closedNote: fil ? "Puwede ka pa ring gumawa ng account para handa ka sa susunod na pagbubukas." : "You can still create an account so you're ready when applications open.",
      openNow: (n: number) =>
        fil ? `${n} programa ang bukas ngayon — tingnan` : `${n} ${n === 1 ? "program is" : "programs are"} open now — see programs`,
      scroll: fil ? "Mag-scroll pababa" : "Scroll to learn more",
    },
    dates: {
      title: block ? (fil ? "Aplikasyon" : "Applications") : (fil ? "Panahon ng aplikasyon" : "Application period"),
      period,
      opens: (d: string) => (fil ? `Magbubukas ${formatDate(d)}` : `Opens ${formatDate(d)}`),
      due: (d: string) => (fil ? `Hanggang ${formatDate(d)}` : `Due ${formatDate(d)}`),
    },
    stats: {
      applications: fil ? "Natanggap na aplikasyon" : "Applications received",
      scholars: fil ? "Natulungang iskolar" : "Scholars supported",
      programs: fil ? "Aktibong programa" : "Active programs",
    },
    news: {
      label: fil ? "Anunsyo" : "Announcements",
      heading: fil ? ["Pinakabagong", "Balita"] : ["Latest", "News"],
    },
    programs: {
      label: fil ? "Scholarship" : "Scholarships",
      heading: fil ? ["Mga Bukas na", "Programa"] : ["Available", "Programs"],
      desc: (open: number) =>
        open > 0
          ? fil
            ? `${open} programa ang tumatanggap ng aplikasyon. Tingnan at mag-apply sa mga tugma sa iyong kwalipikasyon.`
            : `${open} ${open === 1 ? "program is" : "programs are"} accepting applications. Browse and apply for the ones that match your qualifications.`
          : fil
            ? "Tingnan at mag-apply sa mga scholarship na tugma sa iyong kwalipikasyon at layunin."
            : "Browse and apply for scholarships that match your qualifications and goals.",
      emptyTitle: fil ? "Wala pang bukas na scholarship sa ngayon" : "No scholarships available right now",
      emptyDesc: fil ? "Bumalik muli — dito ipapaskil ang mga bagong programa." : "Check back soon — new programs will be posted here.",
      errorTitle: fil ? "Hindi ma-load ang mga programa" : "We couldn't load the programs",
      errorDesc: fil ? "Suriin ang iyong koneksyon at subukang muli." : "Check your connection and try again.",
      retry: fil ? "Subukang muli" : "Try again",
      viewAll: fil ? "Tingnan Lahat ng Scholarship" : "View All Scholarships",
    },
    process: {
      label: fil ? "Proseso" : "Process",
      heading: fil ? ["Mula Aplikasyon Hanggang", "Pagtanggap ng Pondo"] : ["From Application to", "Disbursement"],
      desc: fil ? "Limang simpleng hakbang, mula simula hanggang dulo." : "Five simple steps, start to finish.",
      step: fil ? "HAKBANG" : "STEP",
      steps: fil
        ? [
            { title: "Magparehistro", desc: "Gumawa ng account sa loob ng 2 minuto." },
            { title: "Mag-apply", desc: "Sagutan ang form at i-upload ang mga dokumento." },
            { title: "Pagsusuri", desc: "Sinusuri ng opisina ang iyong aplikasyon." },
            { title: "Maaprubahan", desc: "Aabisuhan ka kapag naaprubahan na ang iyong aplikasyon." },
            { title: "Tanggapin ang Pondo", desc: "Kunin ang iyong bayad kapag inilabas na." },
          ]
        : [
            { title: "Register", desc: "Create your account in under 2 minutes." },
            { title: "Apply", desc: "Fill guided forms and upload documents." },
            { title: "Review", desc: "Admins verify your submission." },
            { title: "Get Approved", desc: "We notify you once your application is approved." },
            { title: "Receive Funds", desc: "Claim your payout once it is released." },
          ],
    },
    requirements: {
      label: fil ? "Mga Kailangan" : "Requirements",
      heading: fil ? ["Bago Ka", "Mag-apply"] : ["Before You", "Apply"],
      desc: fil ? "Ang mga kailangan mo, at kung sino ang kwalipikado." : "What you need, and what makes you eligible.",
      eligibility: fil ? "Kwalipikasyon" : "Eligibility",
      eligibilityItems: [
        fil ? `General average na hindi bababa sa ${s.min_grade_requirement}` : `General average of at least ${s.min_grade_requirement}`,
        fil ? "Mag-apply sa kahit anong bukas na programa; bawat isa ay nag-aapruba ayon sa sarili nitong mga kailangan" : "Apply to any open program; each one approves you on its own requirements",
        ...(s.renewal_enabled
          ? [fil
              ? `Puwedeng i-renew habang may average na ${s.renewal_min_grade} pataas (hanggang ${times(s.max_renewals, lang)})`
              : `Renewable while you keep an average of ${s.renewal_min_grade}+ (up to ${times(s.max_renewals, lang)})`]
          : []),
        fil ? "Nakasulat sa card ng bawat programa ang year level, tirahan at iba pang kondisyon" : "Year level, residency and other conditions are shown on each program card",
      ],
      documents: fil ? "Mga dokumentong ihahanda" : "Documents to prepare",
      noDocuments: fil ? "Makikita sa iyong dashboard ang mga kailangang dokumento kapag nag-apply ka." : "The documents you need are listed in your dashboard when you apply.",
      uploadNote: fil
        ? `Mag-upload ng malinaw na litrato o scan. Hanggang ${s.max_upload_mb} MB bawat file.`
        : `Upload clear photos or scans. Files up to ${s.max_upload_mb} MB each.`,
    },
    history: {
      label: fil ? "Mga Nagawa" : "Our Impact",
      heading: fil ? ["Mga Iskolar sa", "Bawat Taon"] : ["Scholars Through", "the Years"],
      desc: fil ? "Bilang ng mga iskolar na naaprubahan sa bawat school year." : "The number of scholars approved in each school year.",
      scholars: (n: number) => (fil ? `${n.toLocaleString()} iskolar` : `${n.toLocaleString()} ${n === 1 ? "scholar" : "scholars"}`),
    },
    features: {
      label: fil ? "Ang Aming Plataporma" : "Our Platform",
      heading: fil ? ["Lahat ng Kailangan Mo,", "Nasa Iisang Lugar"] : ["Everything You Need,", "In One Place"],
      desc: fil
        ? "Ginawa para mapadali ang pamamahala ng scholarship para sa mga mag-aaral at sa opisina."
        : "Built to make scholarship management seamless for students and administrators alike.",
      items: fil
        ? [
            { title: "Madaling Pag-apply", desc: "Mag-apply sa loob ng ilang minuto gamit ang gabay na form — walang kalituhan, walang abala sa papeles." },
            { title: "Real-Time na Pagsubaybay", desc: "Subaybayan ang bawat yugto ng iyong aplikasyon at bayad mula sa iyong dashboard." },
            { title: "Ligtas na Pagbibigay ng Pondo", desc: "Inilalabas ang pondo nang may kumpletong talaan at abiso sa bawat pagbabago." },
            { title: "Agarang Abiso", desc: "Manatiling updated sa bawat yugto sa pamamagitan ng abiso sa portal at sa email." },
          ]
        : [
            { title: "Easy Application", desc: "Apply in minutes with guided step-by-step forms — no confusion, no paperwork hassle." },
            { title: "Real-Time Tracking", desc: "Monitor every stage of your application and payment status from your personal dashboard." },
            { title: "Secure Disbursement", desc: "Funds are released with full audit trails and status updates." },
            { title: "Instant Notifications", desc: "Stay informed at every milestone with timely in-app and email alerts." },
          ],
    },
    faq: {
      label: "FAQ",
      heading: fil ? ["Mga Madalas na", "Itanong"] : ["Frequently Asked", "Questions"],
      items: faqs(lang, s, period),
    },
    offeredBy: {
      label: fil ? "Handog ng" : "Offered by",
      sub: fil ? "Pamahalaang Bayan ng San Jose, Occidental Mindoro" : "Local Government Unit of San Jose, Occidental Mindoro",
    },
    contact: {
      label: fil ? "Makipag-ugnayan" : "Contact Us",
      heading: fil ? ["Gusto Naming", "Makarinig Mula sa Iyo"] : ["We'd Love to", "Hear from You"],
      desc: fil
        ? "May tanong? Sumulat sa amin at sasagot kami sa loob ng 1-2 araw ng trabaho."
        : "Have questions? Reach out and we'll get back to you within 1-2 business days.",
      email: "Email",
      phone: fil ? "Telepono" : "Phone",
      office: fil ? "Opisina" : "Office",
      hours: fil ? "Oras ng Opisina" : "Office Hours",
      directions: fil ? "Buksan sa mapa" : "Open in Maps",
    },
  };
}

export type LandingCopy = ReturnType<typeof landingCopy>;
