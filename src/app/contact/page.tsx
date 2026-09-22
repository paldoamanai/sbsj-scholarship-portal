"use client";

import Layout from "@/components/Layout";
import LandingFooter from "@/components/LandingFooter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ContactForm from "@/components/ContactForm";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { Mail, Phone, MapPin, Clock } from "lucide-react";


export default function ContactPage() {
  const { settings } = useSystemSettings();
  const contactInfo = [
    { icon: Mail, label: "Email", value: settings.contact_email },
    { icon: Phone, label: "Phone", value: settings.contact_phone },
    { icon: MapPin, label: "Address", value: settings.contact_address },
    { icon: Clock, label: "Office Hours", value: settings.office_hours },
  ].filter((c) => c.value);

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
              <ContactForm withSubject />
            </CardContent>
          </Card>
        </div>
      </div>

      <LandingFooter />
    </Layout>
  );
}
