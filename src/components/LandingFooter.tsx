"use client";

import Link from "next/link";
import Image from "next/image";
import { GraduationCap, Mail, Phone, MapPin } from "lucide-react";

const LandingFooter = () => {
  return (
    <footer className="border-t bg-card">
      <div className="container py-12 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Image src="/municipal-logo.png" alt="SB San Jose Logo" width={40} height={40} className="h-10 w-10" />
            <div>
              <p className="text-sm font-semibold">SB San Jose Scholarship</p>
              <p className="text-xs text-muted-foreground">San Jose, Occidental Mindoro</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Empowering the youth through transparent and accessible scholarships.
          </p>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-3">Quick Links</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link href="/" className="hover:text-primary">Home</Link></li>
            <li><Link href="/about" className="hover:text-primary">About</Link></li>
            <li><Link href="/#scholarships" className="hover:text-primary">Scholarships</Link></li>
            <li><Link href="/contact" className="hover:text-primary">Contact</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-3">Account</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link href="/login" className="hover:text-primary">Login</Link></li>
            <li><Link href="/register" className="hover:text-primary">Register</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-3">Contact</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2"><Mail className="h-4 w-4" /> scholarship@sbsj.gov.ph</li>
            <li className="flex items-center gap-2"><Phone className="h-4 w-4" /> (043) 123-4567</li>
            <li className="flex items-start gap-2"><MapPin className="h-4 w-4 mt-0.5" /> Sangguniang Bayan ng San Jose, Occidental Mindoro</li>
          </ul>
        </div>
      </div>
      <div className="border-t">
        <div className="container py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Sangguniang Bayan ng San Jose Scholarship Portal. All rights reserved.</p>
          <div className="flex items-center gap-1">
            <GraduationCap className="h-3.5 w-3.5" />
            <span>Ang Kabataan ang Pag-asa ng Bayan</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default LandingFooter;
