import Layout from "@/components/Layout";
import LandingFooter from "@/components/LandingFooter";

export const metadata = { title: "Terms of Use | SB San Jose Scholarship Portal" };

const sections = [
  {
    title: "Using the portal",
    body: [
      "The portal is for students applying to, or receiving, scholarships from the Sangguniang Bayan ng San Jose, and for the staff who administer them.",
      "You must give accurate information and upload genuine documents. Each person may keep one account.",
      "Keep your password private. You are responsible for activity under your account.",
    ],
  },
  {
    title: "Applications and awards",
    body: [
      "Submitting an application does not guarantee an award. Decisions follow each program's published requirements, available slots and budget.",
      "Providing false, altered or duplicate information may lead to rejection, cancellation of an award, or recovery of funds already released.",
      "Application periods, requirements and amounts may change. The details shown on the portal at the time you apply apply to you.",
    ],
  },
  {
    title: "Acceptable use",
    body: [
      "Do not attempt to access other people's data, disrupt the portal, or use it for anything other than the scholarship program.",
    ],
  },
  {
    title: "Changes",
    body: [
      "We may update these terms and the portal from time to time. Continued use after a change means you accept the updated terms.",
    ],
  },
];

export default function TermsPage() {
  return (
    <Layout>
      <section className="bg-orange-50/60 border-b py-14">
        <div className="container text-center max-w-2xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">Terms of Use</h1>
          <p className="text-muted-foreground">The rules for using the SB San Jose Scholarship Portal.</p>
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
        <p className="text-sm text-muted-foreground">
          See also our <a href="/privacy" className="text-primary underline">Privacy Policy</a>.
        </p>
      </div>
      <LandingFooter />
    </Layout>
  );
}
