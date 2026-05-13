"use client";

import Layout from "@/components/Layout";
import LandingFooter from "@/components/LandingFooter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Mail, Phone, MapPin, Send, Clock } from "lucide-react";

const contactInfo = [
  { icon: Mail, label: "Email", value: "scholarship@sbsj.gov.ph" },
  { icon: Phone, label: "Phone", value: "(043) 457-0001" },
  { icon: MapPin, label: "Address", value: "Sangguniang Bayan Building, San Jose, Occidental Mindoro, Philippines 5100" },
  { icon: Clock, label: "Office Hours", value: "Monday to Friday, 8:00 AM – 5:00 PM" },
];

export default function ContactPage() {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Message sent successfully!", { description: "We'll get back to you within 1-2 business days." });
  };

  return (
    <Layout>
      {/* Page hero */}
      <section className="bg-orange-50/60 border-b py-14">
        <div className="container text-center max-w-xl mx-auto animate-fade-in">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-orange-700 bg-orange-100 rounded-full mb-4 tracking-widest uppercase">Contact Us</span>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">Get In Touch</h1>
          <p className="text-muted-foreground">Have questions about scholarships? We&apos;re here to help.</p>
        </div>
      </section>

      <div className="container py-16 max-w-4xl">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Contact info */}
          <div className="lg:col-span-2 space-y-4">
            {contactInfo.map((c, i) => (
              <Card key={i} className="hover-lift">
                <CardContent className="flex items-start gap-4 py-5">
                  <div className="h-11 w-11 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                    <c.icon className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{c.label}</p>
                    <p className="text-sm text-muted-foreground">{c.value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Contact form */}
          <Card className="lg:col-span-3 border-t-4 border-t-primary">
            <CardHeader>
              <CardTitle className="font-display">Send us a Message</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><Label>Full Name</Label><Input required placeholder="Your name" /></div>
                  <div><Label>Email</Label><Input type="email" required placeholder="you@email.com" /></div>
                </div>
                <div><Label>Subject</Label><Input required placeholder="Inquiry about..." /></div>
                <div><Label>Message</Label><Textarea required placeholder="Your message..." rows={5} /></div>
                <Button type="submit" className="w-full bg-gradient-primary shadow-primary cursor-pointer">
                  Send Message <Send className="ml-2 h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <LandingFooter />
    </Layout>
  );
}
