import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  Pill, Clock, Heart, Shield, Users, Smartphone, ArrowRight,
  Menu, X, Upload, Bell, BarChart3, Globe, Star, Check,
  Brain, MessageSquare, Activity
} from "lucide-react";

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" as const },
  }),
};

const painPoints = [
  {
    emoji: "😟",
    title: "Forgetting Medicines",
    description: "Elderly patients miss doses regularly, putting their health at serious risk.",
  },
  {
    emoji: "🗣️",
    title: "Language Barriers",
    description: "Most health apps are English-only. Your parents need reminders in their language.",
  },
  {
    emoji: "😰",
    title: "Family Worry",
    description: "Caregivers live far away and can't be sure their parents took their medicines.",
  },
];

const steps = [
  { step: "01", icon: Upload, title: "Upload Prescription", description: "Snap a photo of any prescription. Our AI reads it instantly." },
  { step: "02", icon: Brain, title: "AI Extracts Medicines", description: "Gemini AI identifies every medicine, dosage, and timing automatically." },
  { step: "03", icon: Bell, title: "Get Reminders", description: "Receive gentle reminders via email in your preferred language." },
  { step: "04", icon: Heart, title: "Family Stays Informed", description: "Caregivers get alerts if a dose is missed. Peace of mind for everyone." },
];

const features = [
  { icon: Brain, title: "AI Prescription Reading", description: "Upload a photo and let AI extract all medicine details automatically." },
  { icon: Globe, title: "8 Indian Languages", description: "Reminders in Hindi, Telugu, Tamil, Kannada, Marathi, Bengali, Gujarati & English." },
  { icon: Bell, title: "Smart Reminders", description: "Timely email notifications that are warm, caring, and easy to understand." },
  { icon: Users, title: "Family Alerts", description: "Automatic notifications to caregivers when a dose is missed." },
  { icon: Activity, title: "Health Tracking", description: "Track adherence over time with beautiful charts and weekly reports." },
  { icon: Shield, title: "Safe & Private", description: "Your health data is encrypted and never shared with third parties." },
];

const stats = [
  { value: "50K+", label: "Medicines Tracked" },
  { value: "98%", label: "Adherence Rate" },
  { value: "8", label: "Languages Supported" },
  { value: "10K+", label: "Happy Families" },
];

const testimonials = [
  {
    name: "Lakshmi Devi",
    location: "Hyderabad",
    text: "My mother finally takes her medicines on time. The Telugu reminders make her feel so comfortable!",
    rating: 5,
  },
  {
    name: "Ramesh Kumar",
    location: "Delhi",
    text: "I live in the US but MedBuddy keeps me updated about my father's medicines. Such peace of mind!",
    rating: 5,
  },
  {
    name: "Priya Sharma",
    location: "Bangalore",
    text: "The AI prescription reader is amazing! No more typing medicine names manually. It just works!",
    rating: 5,
  },
];

const languages = [
  { name: "English", script: "Hello!" },
  { name: "हिंदी", script: "नमस्ते!" },
  { name: "తెలుగు", script: "నమస్కారం!" },
  { name: "தமிழ்", script: "வணக்கம்!" },
  { name: "ಕನ್ನಡ", script: "ನಮಸ್ಕಾರ!" },
  { name: "मराठी", script: "नमस्कार!" },
  { name: "বাংলা", script: "নমস্কার!" },
  { name: "ગુજરાતી", script: "નમસ્તે!" },
];

const Landing = () => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="container flex items-center justify-between h-16 md:h-18">
          <span className="text-2xl font-extrabold tracking-tight">
            <span className="gradient-text">Med</span>Buddy 💊
          </span>
          <div className="hidden md:flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")}>Login</Button>
            <Button variant="hero" size="sm" onClick={() => navigate("/auth")}>Get Started</Button>
          </div>
          <button className="md:hidden p-2" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t bg-background p-4 space-y-3">
            <Button variant="ghost" className="w-full" onClick={() => { navigate("/auth"); setMenuOpen(false); }}>Login</Button>
            <Button variant="hero" className="w-full" onClick={() => { navigate("/auth"); setMenuOpen(false); }}>Get Started</Button>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="pt-28 pb-16 md:pt-36 md:pb-24 gradient-hero">
        <div className="container grid md:grid-cols-2 gap-12 items-center">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-semibold mb-6">
              <Heart className="w-4 h-4" /> Caring for your family's health
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight mb-6">
              Never Miss a{" "}
              <span className="gradient-text">Medicine</span>{" "}
              Again
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-lg">
              AI-powered medicine reminders in <strong>8 Indian languages</strong>.
              Upload prescriptions, get gentle reminders, and keep your family informed.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <Button variant="hero" size="xl" onClick={() => navigate("/auth")}>
                Start Free <ArrowRight className="ml-1 w-5 h-5" />
              </Button>
              <Button variant="outline" size="xl" onClick={() => navigate("/auth")}>
                I Have an Account
              </Button>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Check className="w-4 h-4 text-secondary" /> Free forever</span>
              <span className="flex items-center gap-1"><Check className="w-4 h-4 text-secondary" /> No credit card</span>
              <span className="flex items-center gap-1"><Check className="w-4 h-4 text-secondary" /> 8 languages</span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative hidden md:block"
          >
            {/* Dashboard mockup */}
            <div className="bg-card rounded-2xl shadow-float p-6 border">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl gradient-warm flex items-center justify-center">
                  <Pill className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-bold">Today's Schedule</p>
                  <p className="text-sm text-muted-foreground">3 medicines remaining</p>
                </div>
              </div>
              {[
                { name: "Paracetamol 500mg", time: "8:00 AM", status: "done" },
                { name: "Amoxicillin 250mg", time: "2:00 PM", status: "next" },
                { name: "Cetirizine 10mg", time: "10:00 PM", status: "pending" },
              ].map((med) => (
                <div key={med.name} className={`flex items-center justify-between p-3 rounded-xl mb-2 ${
                  med.status === "done" ? "bg-secondary/10" : med.status === "next" ? "bg-primary/10" : "bg-muted"
                }`}>
                  <div>
                    <p className="font-semibold text-sm">{med.name}</p>
                    <p className="text-xs text-muted-foreground">{med.time}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                    med.status === "done" ? "bg-secondary/20 text-secondary" :
                    med.status === "next" ? "bg-primary/20 text-primary" :
                    "bg-muted-foreground/20 text-muted-foreground"
                  }`}>
                    {med.status === "done" ? "✅ Taken" : med.status === "next" ? "⏰ Next" : "⏳ Later"}
                  </span>
                </div>
              ))}
            </div>

            {/* Floating notification card */}
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -top-4 -right-4 bg-card rounded-xl shadow-float p-4 border max-w-[200px]"
            >
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-primary" />
                <p className="text-sm font-semibold">Time for medicine!</p>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Paracetamol 500mg — Now</p>
            </motion.div>

            {/* Floating language card */}
            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }}
              className="absolute -bottom-4 -left-4 bg-card rounded-xl shadow-float p-4 border"
            >
              <p className="text-sm font-semibold">🗣️ దయచేసి మందు తీసుకోండి</p>
              <p className="text-xs text-muted-foreground">Reminder in Telugu</p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="py-20">
        <div className="container">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-14">
            <motion.p variants={fadeIn} custom={0} className="text-primary font-semibold mb-2">THE PROBLEM</motion.p>
            <motion.h2 variants={fadeIn} custom={1} className="text-3xl md:text-4xl font-extrabold mb-4">
              Medicine Management is Broken
            </motion.h2>
            <motion.p variants={fadeIn} custom={2} className="text-muted-foreground text-lg max-w-xl mx-auto">
              Millions of elderly Indians struggle with their daily medicines. Their families worry constantly.
            </motion.p>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-6">
            {painPoints.map((p, i) => (
              <motion.div
                key={p.title}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeIn}
                className="bg-card rounded-2xl border p-8 shadow-card hover:shadow-card-hover transition-shadow text-center"
              >
                <span className="text-5xl mb-4 block">{p.emoji}</span>
                <h3 className="text-xl font-bold mb-2">{p.title}</h3>
                <p className="text-muted-foreground">{p.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 gradient-soft">
        <div className="container">
          <div className="text-center mb-14">
            <p className="text-primary font-semibold mb-2">HOW IT WORKS</p>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Simple as 1-2-3-4</h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Get started in under 2 minutes. No tech skills required.
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {steps.map((s, i) => (
              <motion.div
                key={s.step}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeIn}
                className="text-center"
              >
                <div className="w-16 h-16 rounded-2xl gradient-warm flex items-center justify-center mx-auto mb-4 shadow-card">
                  <s.icon className="w-7 h-7 text-primary-foreground" />
                </div>
                <span className="text-sm font-bold text-primary/60 mb-1 block">STEP {s.step}</span>
                <h3 className="text-lg font-bold mb-2">{s.title}</h3>
                <p className="text-muted-foreground text-sm">{s.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20">
        <div className="container">
          <div className="text-center mb-14">
            <p className="text-primary font-semibold mb-2">FEATURES</p>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Everything Your Family Needs</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeIn}
                className="bg-card rounded-2xl border p-7 shadow-card hover:shadow-card-hover transition-all group"
              >
                <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <f.icon className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">{f.title}</h3>
                <p className="text-muted-foreground">{f.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Banner */}
      <section className="py-16 gradient-dark">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeIn}
                className="text-center"
              >
                <p className="text-4xl md:text-5xl font-extrabold text-primary-foreground mb-1">{s.value}</p>
                <p className="text-primary-foreground/70 font-medium">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20">
        <div className="container">
          <div className="text-center mb-14">
            <p className="text-primary font-semibold mb-2">TESTIMONIALS</p>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Loved by Families</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <motion.div
                key={t.name}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeIn}
                className="bg-card rounded-2xl border p-7 shadow-card"
              >
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: t.rating }).map((_, j) => (
                    <Star key={j} className="w-5 h-5 fill-warning text-warning" />
                  ))}
                </div>
                <p className="text-foreground mb-6 italic">"{t.text}"</p>
                <div>
                  <p className="font-bold">{t.name}</p>
                  <p className="text-sm text-muted-foreground">{t.location}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Language Showcase */}
      <section className="py-20 gradient-soft">
        <div className="container">
          <div className="text-center mb-14">
            <p className="text-primary font-semibold mb-2">MULTILINGUAL</p>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Speaks Your Language</h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              MedBuddy sends reminders in 8 Indian languages so your parents feel right at home.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {languages.map((l, i) => (
              <motion.div
                key={l.name}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeIn}
                className="bg-card rounded-2xl border p-5 text-center shadow-card hover:shadow-card-hover transition-shadow"
              >
                <p className="text-2xl font-bold mb-1">{l.script}</p>
                <p className="text-sm text-muted-foreground font-medium">{l.name}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24">
        <div className="container max-w-2xl text-center">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }}>
            <motion.h2 variants={fadeIn} custom={0} className="text-3xl md:text-4xl font-extrabold mb-4">
              Give Your Parents the Care They Deserve
            </motion.h2>
            <motion.p variants={fadeIn} custom={1} className="text-muted-foreground text-lg mb-8">
              Join thousands of families who trust MedBuddy. It's free, simple, and works in your language.
            </motion.p>
            <motion.div variants={fadeIn} custom={2}>
              <Button variant="hero" size="xl" onClick={() => navigate("/auth")}>
                Get Started — It's Free <ArrowRight className="ml-1" />
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-12 bg-card">
        <div className="container">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <p className="text-xl font-extrabold mb-3">
                <span className="gradient-text">Med</span>Buddy 💊
              </p>
              <p className="text-muted-foreground text-sm">
                AI-powered medicine reminders for elderly Indian patients and their families.
              </p>
            </div>
            <div>
              <p className="font-bold mb-3">Product</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-foreground cursor-pointer">Features</li>
                <li className="hover:text-foreground cursor-pointer">How it Works</li>
                <li className="hover:text-foreground cursor-pointer">Pricing</li>
              </ul>
            </div>
            <div>
              <p className="font-bold mb-3">Support</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-foreground cursor-pointer">Help Center</li>
                <li className="hover:text-foreground cursor-pointer">Contact Us</li>
                <li className="hover:text-foreground cursor-pointer">FAQ</li>
              </ul>
            </div>
            <div>
              <p className="font-bold mb-3">Legal</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-foreground cursor-pointer">Privacy Policy</li>
                <li className="hover:text-foreground cursor-pointer">Terms of Service</li>
              </ul>
            </div>
          </div>
          <div className="border-t pt-6 text-center text-sm text-muted-foreground">
            <p>© 2026 MedBuddy. Made with ❤️ for healthier Indian families.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
