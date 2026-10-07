"use client";

import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import ContactForm from "@/components/ContactForm";
import { Panel, SectionTitle } from "@/components/student/ui";
import { useSystemSettings } from "@/hooks/use-system-settings";

const FAQ = [
  {
    q: "How do I apply?",
    a: "Upload every required document on the Documents tab first. Then open Application, choose New application, pick a program and certify that your information is true. You can apply to every open program; each one decides on its own.",
  },
  {
    q: "A document was disapproved. What now?",
    a: "Open Documents. The office's reason is shown under the document. Choose Upload new to send a corrected copy, and the office will review it again.",
  },
  {
    q: "The office asked me to make changes",
    a: "The request is shown in red on your application in the Application tab. Do what it asks (for example, upload a clearer document), then press \"I've made the changes\" so the office knows to look again.",
  },
  {
    q: "How and when do I get paid?",
    a: "Once you are approved, the office schedules your payouts. The Payouts tab shows each one, how to claim it, and lets you say whether you prefer cash or cheque.",
  },
  {
    q: "I received my money. What do I enter?",
    a: "On the Payouts tab, type the receipt number printed on the acknowledgment slip you signed. That confirms you received the payment.",
  },
  {
    q: "Something is wrong with a payment",
    a: "On the Payouts tab, use Report a problem on that payment. The office's reply appears there and in your notifications.",
  },
  {
    q: "I need proof that I'm a scholar",
    a: "Open Application and choose Award notice on an approved application. It opens a printable notice you can print or save as a PDF. The office can verify it using the reference number on it.",
  },
  {
    q: "Some of my details are locked",
    a: "Your name, school and similar details lock once you apply or are approved, so they match what the office reviewed. Send the office a message below to correct them.",
  },
];

/** Student Help tab: office contact details, common questions, and a message form. */
export default function HelpSection({ name, email }: { name: string; email: string }) {
  const { settings } = useSystemSettings();
  const contact = [
    { icon: Mail, label: "Email", value: settings.contact_email, href: settings.contact_email ? `mailto:${settings.contact_email}` : null },
    { icon: Phone, label: "Phone", value: settings.contact_phone, href: settings.contact_phone ? `tel:${settings.contact_phone.replace(/[^\d+]/g, "")}` : null },
    { icon: MapPin, label: "Office", value: settings.contact_address, href: null },
    { icon: Clock, label: "Office hours", value: settings.office_hours, href: null },
  ].filter((c) => c.value);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">Help</h2>
        <p className="text-sm text-muted-foreground">Reach the scholarship office, or find a quick answer below.</p>
      </div>

      {contact.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {contact.map((c) => (
            <Panel key={c.label} className="p-4 flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
                <c.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                {c.href
                  ? <a href={c.href} className="text-sm font-semibold text-foreground break-words hover:text-primary">{c.value}</a>
                  : <p className="text-sm font-semibold text-foreground break-words">{c.value}</p>}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel>
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Common questions</SectionTitle></div>
        <Accordion type="single" collapsible className="px-4 sm:px-6">
          {FAQ.map((f, i) => (
            <AccordionItem key={f.q} value={`q${i}`} className={i === FAQ.length - 1 ? "border-b-0" : ""}>
              <AccordionTrigger className="text-sm text-left">{f.q}</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground leading-relaxed">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Panel>

      <Panel>
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted">
          <SectionTitle>Message the office</SectionTitle>
          <p className="text-sm text-muted-foreground -mt-3">The office replies to your email, usually within 1–2 business days.</p>
        </div>
        <div className="p-4 sm:p-6">
          <ContactForm withSubject defaults={{ name, email }} />
        </div>
      </Panel>
    </div>
  );
}
