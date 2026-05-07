"use client";

import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Mail, Phone, MapPin } from "lucide-react";

const contactInfo = [
  { icon: Mail, label: "Email", value: "scholarship@sbsj.gov.ph" },
  { icon: Phone, label: "Phone", value: "(043) 457-0001" },
  { icon: MapPin, label: "Address", value: "Sangguniang Bayan Building, San Jose, Occidental Mindoro, Philippines 5100" },
];

export default function ContactPage() {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Message sent successfully!", { description: "We'll get back to you within 1-2 business days." });
  };

  return (
    <Layout>
      <div className="container py-16 max-w-4xl">
        <div className="text-center mb-12 animate-fade-in">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">Contact Us</h1>
          <p className="text-muted-foreground">Have questions about scholarships? We&apos;re here to help.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-2 space-y-4">
            {contactInfo.map((c, i) => (
              <Card key={i} className="hover-lift">
                <CardContent className="flex items-start gap-4 py-5">
                  <div className="h-10 w-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
                    <c.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-sm text-muted-foreground">{c.value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardContent className="py-5">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  The Sangguniang Bayan ng San Jose Scholarship Portal is managed by the Sangguniang Bayan of San Jose, Occidental Mindoro. Office hours are Monday to Friday, 8:00 AM to 5:00 PM.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="lg:col-span-3">
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
                <Button type="submit" className="w-full bg-gradient-primary shadow-primary">Send Message</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
