import HomePage, { type HomePageData } from "@/components/landing/HomePage";
import { createClient } from "@/lib/supabase/server";
import { parseSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";

// Loads the programs, stats, settings and posted announcements on the server, so they are in the
// HTML that search engines and link previews read. The page keeps them live in the browser after that.
async function loadHomePage(): Promise<HomePageData> {
  const supabase = await createClient();
  const [programs, stats, settings, announcements, byYear] = await Promise.all([
    supabase.rpc("scholarships_public"),
    supabase.rpc("public_stats"),
    supabase.from("system_settings").select("key, value"),
    supabase.rpc("public_announcements"),
    supabase.rpc("public_scholars_by_year"),
  ]);
  return {
    settings: parseSettings(settings.data),
    scholarships: programs.error ? null : (programs.data ?? []),
    stats: stats.data?.[0] ?? null,
    announcements: announcements.data ?? [],
    scholarsByYear: byYear.data ?? [],
  };
}

export default async function Page() {
  const data = await loadHomePage();
  const s = data.settings;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "GovernmentOrganization",
        "@id": `${siteUrl}/#organization`,
        name: "Sangguniang Bayan ng San Jose",
        url: siteUrl,
        logo: new URL("/municipal-logo.png", siteUrl).toString(),
        email: s.contact_email || undefined,
        telephone: s.contact_phone || undefined,
        address: s.contact_address || undefined,
        areaServed: "San Jose, Occidental Mindoro, Philippines",
        sameAs: s.facebook_url ? [s.facebook_url] : undefined,
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        name: s.program_name,
        url: siteUrl,
        inLanguage: ["en", "fil"],
        publisher: { "@id": `${siteUrl}/#organization` },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        // Escape "<" so text from the settings can't close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <HomePage initial={data} />
    </>
  );
}
