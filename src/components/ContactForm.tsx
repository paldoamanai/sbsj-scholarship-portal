"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Contact form that emails the LGU through /api/contact. Only reports success when the email was sent. */
export default function ContactForm({ withSubject = false }: { withSubject?: boolean }) {
  const [sending, setSending] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setSending(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Message not sent", { description: json.error ?? "Please try again." });
        return;
      }
      form.reset();
      toast.success("Message sent!", { description: "We'll get back to you within 1–2 business days." });
    } catch {
      toast.error("Message not sent", { description: "Check your connection and try again." });
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {/* Honeypot for bots; hidden from people and assistive tech. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      <div className={withSubject ? "grid grid-cols-1 sm:grid-cols-2 gap-4" : "space-y-4"}>
        <div className="space-y-2">
          <Label htmlFor="cf-name">Name</Label>
          <Input id="cf-name" name="name" placeholder="Your full name" maxLength={100} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cf-email">Email</Label>
          <Input id="cf-email" name="email" type="email" placeholder="you@example.com" maxLength={255} required />
        </div>
      </div>
      {withSubject && (
        <div className="space-y-2">
          <Label htmlFor="cf-subject">Subject</Label>
          <Input id="cf-subject" name="subject" placeholder="Inquiry about..." maxLength={150} required />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="cf-message">Message</Label>
        <Textarea id="cf-message" name="message" placeholder="How can we help?" rows={withSubject ? 5 : 4} maxLength={1000} required />
      </div>
      <Button type="submit" disabled={sending} className="w-full h-11 bg-gradient-primary shadow-primary cursor-pointer">
        {sending ? "Sending…" : <><span>Send Message</span> <Send className="ml-2 h-4 w-4" /></>}
      </Button>
    </form>
  );
}
