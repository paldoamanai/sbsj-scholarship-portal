import Link from "next/link";
import Layout from "@/components/Layout";
import LandingFooter from "@/components/LandingFooter";

export const metadata = { title: "Privacy Policy | SB San Jose Scholarship Portal" };

const sections = [
  {
    title: "What we collect",
    body: [
      "Account details: your name, email address and Student ID.",
      "Application details: your school, year level, grades, address and the documents you upload (such as ID, grades, certificate of registration, barangay indigency and birth certificate).",
      "Payout details: the payment method, schedule and status of any scholarship funds released to you.",
      "Portal activity: notifications, settings and sign-in records needed to keep your account secure.",
    ],
  },
  {
    title: "Why we collect it",
    body: [
      "To verify your identity and eligibility, process and decide your application, release payouts, and contact you about your scholarship.",
      "To keep the program fair, for example by preventing duplicate or ineligible applications, and to keep records for audit.",
      "We do not sell your information or use it for advertising.",
    ],
  },
  {
    title: "Who can see it",
    body: [
      "Authorized staff of the Sangguniang Bayan ng San Jose who administer the scholarship program.",
      "Service providers that host the portal and send its emails, only as needed to run it.",
      "Public pages show only totals, such as the number of scholars and amounts disbursed. They never show personal information.",
    ],
  },
  {
    title: "How long we keep it",
    body: [
      "We keep records for as long as needed to run the program and to meet government record-keeping and audit requirements, then dispose of them securely.",
    ],
  },
  {
    title: "Your rights",
    body: [
      "Under the Data Privacy Act of 2012 (Republic Act No. 10173) you may ask to access, correct or, where appropriate, delete your personal information, and you may object to how it is processed.",
      "You can update most of your details from your dashboard. For anything else, contact us using the details below.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <Layout>
      <section className="bg-orange-50/60 border-b py-14">
        <div className="container text-center max-w-2xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">Privacy Policy</h1>
          <p className="text-muted-foreground">How the SB San Jose Scholarship Portal handles your personal information.</p>
        </div>
      </section>

      <div className="container max-w-3xl py-14 space-y-10">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="text-xl font-display font-bold text-foreground mb-3">{s.title}</h2>
            <ul className="space-y-2 list-disc pl-5 text-muted-foreground leading-relaxed">
              {s.body.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </section>
        ))}
        <section>
          <h2 className="text-xl font-display font-bold text-foreground mb-3">Contact</h2>
          <p className="text-muted-foreground leading-relaxed">
            For privacy questions or requests, use the contact form on the <Link href="/#contact" className="text-primary underline">home page</Link> or the Contact page.
          </p>
        </section>
      </div>
      <LandingFooter />
    </Layout>
  );
}
