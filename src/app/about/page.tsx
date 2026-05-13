import Layout from "@/components/Layout";
import LandingFooter from "@/components/LandingFooter";
import { Card, CardContent } from "@/components/ui/card";
import { GraduationCap, Target, Heart, Users } from "lucide-react";

const values = [
  { icon: GraduationCap, title: "Education First", description: "We believe every deserving student in San Jose, Occidental Mindoro should have access to quality education regardless of financial status." },
  { icon: Target, title: "Transparency", description: "All scholarship processes are conducted with full transparency, ensuring fair evaluation of every applicant." },
  { icon: Heart, title: "Community Impact", description: "Our scholars become future leaders who give back to their communities and contribute to provincial development." },
  { icon: Users, title: "Inclusivity", description: "We welcome applicants from all municipalities and barangays across San Jose, Occidental Mindoro." },
];

export default function AboutPage() {
  return (
    <Layout>
      {/* Page hero */}
      <section className="bg-orange-50/60 border-b py-14">
        <div className="container text-center max-w-2xl mx-auto animate-fade-in">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-orange-700 bg-orange-100 rounded-full mb-4 tracking-widest uppercase">About Us</span>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
            Serving the Youth of San Jose
          </h1>
          <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
            The Sangguniang Bayan ng San Jose Scholarship Management System is a digital platform designed to streamline the scholarship application, evaluation, and management process for the students of San Jose, Occidental Mindoro.
          </p>
        </div>
      </section>

      <div className="container py-16 max-w-4xl">
        {/* Mission */}
        <Card className="mb-12 border-l-4 border-l-primary">
          <CardContent className="py-8 space-y-4">
            <span className="inline-block px-3 py-1 text-xs font-semibold text-orange-700 bg-orange-100 rounded-full tracking-widest uppercase">Mission</span>
            <h2 className="text-2xl font-display font-bold">Our Mission</h2>
            <p className="text-muted-foreground leading-relaxed">
              To provide an efficient, transparent, and accessible scholarship management system that empowers deserving students from San Jose, Occidental Mindoro to pursue their educational dreams. We aim to bridge the gap between opportunity and talent through technology-driven solutions.
            </p>
          </CardContent>
        </Card>

        {/* Values */}
        <div className="text-center mb-10">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-orange-700 bg-orange-100 rounded-full mb-4 tracking-widest uppercase">Values</span>
          <h2 className="text-2xl font-display font-bold text-foreground">Our Core Values</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {values.map((v, i) => (
            <Card key={i} className="hover-lift animate-fade-in-up" style={{ animationDelay: `${i * 0.1}s` }}>
              <CardContent className="py-6 flex gap-4">
                <div className="h-12 w-12 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                  <v.icon className="h-6 w-6 text-orange-600" />
                </div>
                <div>
                  <h3 className="font-display font-bold mb-1">{v.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{v.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <LandingFooter />
    </Layout>
  );
}
