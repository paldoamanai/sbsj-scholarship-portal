"use client";

import Link from "next/link";
import Image from "next/image";
import { GraduationCap, Mail, Phone, MapPin, Facebook, ExternalLink } from "lucide-react";

const LandingFooter = () => {
  return (
    <>
      {/* Footer */}
      <footer className="bg-[#0F2557]">
        <div className="container py-14 grid grid-cols-1 md:grid-cols-12 gap-10">

          {/* Brand column */}
          <div className="md:col-span-4 space-y-4">
            <Link href="/" className="flex items-center gap-3 group w-fit">
              <Image
                src="/municipal-logo.png"
                alt="SB San Jose Logo"
                width={48}
                height={48}
                className="h-12 w-12 drop-shadow-md"
              />
              <div>
                <p className="text-base font-bold text-white leading-tight group-hover:text-orange-300 transition-colors">
                  SB San Jose<br />Scholarship Portal
                </p>
              </div>
            </Link>
            <p className="text-sm text-white/65 leading-relaxed max-w-xs">
              Empowering the youth of San Jose, Occidental Mindoro through transparent, accessible, and merit-based scholarships.
            </p>
            <div className="pt-1">
              <Link
                href="https://www.facebook.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-xs text-white/50 hover:text-orange-300 transition-colors"
              >
                <Facebook className="h-4 w-4" />
                Follow us on Facebook
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>

          {/* Navigation columns */}
          <div className="md:col-span-2 space-y-3">
            <h4 className="text-xs font-bold text-orange-300 tracking-widest uppercase">Navigate</h4>
            <ul className="space-y-2.5 text-sm text-white/65">
              <li><Link href="/" className="hover:text-orange-300 transition-colors duration-150">Home</Link></li>
              <li><Link href="/about" className="hover:text-orange-300 transition-colors duration-150">About</Link></li>
              <li><Link href="/#scholarships" className="hover:text-orange-300 transition-colors duration-150">Scholarships</Link></li>
              <li><Link href="/#contact" className="hover:text-orange-300 transition-colors duration-150">Contact</Link></li>
            </ul>
          </div>

          <div className="md:col-span-2 space-y-3">
            <h4 className="text-xs font-bold text-orange-300 tracking-widest uppercase">Account</h4>
            <ul className="space-y-2.5 text-sm text-white/65">
              <li><Link href="/login" className="hover:text-orange-300 transition-colors duration-150">Login</Link></li>
              <li><Link href="/register" className="hover:text-orange-300 transition-colors duration-150">Register</Link></li>
            </ul>
          </div>

          {/* Contact column */}
          <div className="md:col-span-4 space-y-3">
            <h4 className="text-xs font-bold text-orange-300 tracking-widest uppercase">Contact</h4>
            <ul className="space-y-3 text-sm text-white/65">
              <li className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Mail className="h-4 w-4 text-orange-300" />
                </div>
                <span>scholarship@sbsj.gov.ph</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Phone className="h-4 w-4 text-orange-300" />
                </div>
                <span>(043) 123-4567</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 mt-0.5">
                  <MapPin className="h-4 w-4 text-orange-300" />
                </div>
                <span className="leading-relaxed">
                  Sangguniang Bayan ng San Jose,<br />Occidental Mindoro
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/10 bg-[#0A1C42]">
          <div className="container py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-xs text-white/40">
              &copy; {new Date().getFullYear()} Sangguniang Bayan ng San Jose Scholarship Portal. All rights reserved.
            </p>
            <div className="flex items-center gap-1.5 text-xs text-orange-300 font-medium">
              <GraduationCap className="h-3.5 w-3.5" />
              <span>Ang Kabataan ang Pag-asa ng Bayan</span>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
};

export default LandingFooter;
