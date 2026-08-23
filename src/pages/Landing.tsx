import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion, useScroll, useTransform, useSpring, AnimatePresence } from "framer-motion";
import {
  Pill, Clock, Heart, Shield, Users, Smartphone, ArrowRight,
  Menu, X, Upload, Bell, BarChart3, Globe, Star, Check,
  Brain, MessageSquare, Activity, ChevronDown, Play, Quote,
  Sparkles, Zap, Lock, HeartHandshake, ArrowUpRight, CheckCircle2
} from "lucide-react";

// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } }
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }
};

// Data
const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How it Works", href: "#how-it-works" },
  { label: "Testimonials", href: "#testimonials" },
  { label: "Languages", href: "#languages" },
];

const features = [
  { icon: Brain, title: "AI Prescription Scanner", description: "Snap a photo. Our AI extracts every medicine, dosage, and timing automatically in seconds.", highlight: "95% accuracy" },
  { icon: Globe, title: "8 Indian Languages", description: "Reminders in Hindi, Telugu, Tamil, Kannada, Marathi, Bengali, Gujarati & English.", highlight: "750M+ speakers" },
  { icon: Bell, title: "Smart Reminders", description: "Gentle email notifications at the right time, every time. Never miss a dose.", highlight: "98% adherence" },
  { icon: Users, title: "Family Circle", description: "Invite family members to monitor and receive alerts when doses are missed.", highlight: "Real-time sync" },
  { icon: Activity, title: "Health Insights", description: "Beatiful dashboards showing adherence trends, weekly reports, and health patterns.", highlight: "Visual analytics" },
  { icon: Shield, title: "Privacy First", description: "HIPAA-compliant encryption. Your health data is yours alone, always.", highlight: "Bank-grade security" },
];

const steps = [
  { step: "01", icon: Upload, title: "Upload Prescription", description: "Snap a photo of any prescription. Our AI reads it instantly, even handwritten notes.", color: "from-blue-500 to-cyan-400" },
  { step: "02", icon: Brain, title: "AI Extraction", description: "Gemini AI identifies every medicine, dosage, frequency, and timing automatically.", color: "from-violet-500 to-purple-400" },
  { step: "03", icon: Bell, title: "Set Reminders", description: "Choose your reminder times and language. We handle the rest automatically.", color: "from-emerald-500 to-teal-400" },
  { step: "04", icon: HeartHandshake, title: "Family Stays Connected", description: "Caregivers get notified of missed doses. Everyone sleeps better.", color: "from-rose-500 to-pink-400" },
];

const testimonials = [
  { name: "Lakshmi Devi", location: "Hyderabad", text: "My mother finally takes her medicines on time. The Telugu reminders make her feel so comfortable and cared for!", rating: 5, avatar: "LD" },
  { name: "Ramesh Kumar", location: "New Jersey, USA", text: "I live abroad but MedBuddy keeps me connected to my father's health. The family alerts are a lifesaver.", rating: 5, avatar: "RK" },
  { name: "Priya Nair", location: "Mumbai", text: "The AI prescription scanner is incredible. It saved me hours of manual entry and works flawlessly.", rating: 5, avatar: "PN" },
  { name: "Anil Agarwal", location: "Jaipur", text: "My mom takes 6 medicines daily. MedBuddy helped us achieve 100% adherence for 3 months straight.", rating: 5, avatar: "AA" },
];

const languages = [
  { name: "English", native: "Hello!", flag: "🇺🇸", speakers: "English" },
  { name: "Hindi", native: "नमस्ते!", flag: "🇮🇳", speakers: "Hindi" },
  { name: "Telugu", native: "నమస్కారం!", flag: "🇮🇳", speakers: "Telugu" },
  { name: "Tamil", native: "வணக்கம்!", flag: "🇮🇳", speakers: "Tamil" },
  { name: "Kannada", native: "ನಮಸ್ಕಾರ!", flag: "🇮🇳", speakers: "Kannada" },
  { name: "Marathi", native: "नमस्कार!", flag: "🇮🇳", speakers: "Marathi" },
  { name: "Bengali", native: "নমস্কার!", flag: "🇮🇳", speakers: "Bengali" },
  { name: "Gujarati", native: "નમસ્તે!", flag: "🇮🇳", speakers: "Gujarati" },
];

const faqs = [
  { q: "Is MedBuddy really free?", a: "Yes! MedBuddy has a generous free tier that includes unlimited prescriptions, 8-language reminders, and family alerts. We believe every family deserves proper medicine management." },
  { q: "How does the AI prescription scanner work?", a: "Upload a photo of any prescription — even handwritten ones. Our AI (powered by Gemini) analyzes the image and extracts medicine names, dosages, and timing within seconds." },
  { q: "Can family members see my health data?", a: "Only people you explicitly invite can see your medicine schedule and adherence. You control exactly who sees what. Your data is never shared without consent." },
  { q: "What if my parents don't use smartphones?", a: "MedBuddy sends reminders via email, so they can check on any device with email access. Family members receive SMS/email alerts when doses are missed." },
  { q: "Is my health data secure?", a: "Absolutely. We use bank-grade encryption (AES-256) and are HIPAA-compliant. Your health data is encrypted at rest and in transit. We never sell your data." },
];

const stats = [
  { value: "50K+", label: "Medicines Tracked", suffix: "" },
  { value: "98%", label: "Adherence Rate", suffix: "" },
  { value: "8", label: "Languages", suffix: "" },
  { value: "10K+", label: "Happy Families", suffix: "" },
  { value: "4.9", label: "App Rating", suffix: "/5" },
];

const trustedBy = ["Tata Trust", "Narayana Health", "Apollo Hospitals", "Max Healthcare", "Manipal Hospitals"];

// Floating particles component
const FloatingParticles = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    {[...Array(20)].map((_, i) => (
      <motion.div
        key={i}
        className="absolute w-2 h-2 rounded-full bg-primary/20"
        initial={{
          x: Math.random() * 100 + "%",
          y: Math.random() * 100 + "%",
          scale: Math.random() * 0.5 + 0.5,
        }}
        animate={{
          y: [null, `${Math.random() * -100 - 50}%`],
          opacity: [0.2, 0.5, 0.2],
        }}
        transition={{
          duration: Math.random() * 10 + 15,
          repeat: Infinity,
          ease: "linear",
        }}
        style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
      />
    ))}
  </div>
);

// Counter animation hook
const useCounter = (end: number, duration: number = 2000, suffix: string = "") => {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStarted(true); },
      { threshold: 0.5 }
    );
    const element = document.getElementById("stats-section");
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    let startTime: number;
    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [started, end, duration]);

  return `${count}${suffix}`;
};

const Landing = () => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -100]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);

  // Auto-rotate testimonials
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTestimonial((prev) => (prev + 1) % testimonials.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const springOption = { stiffness: 100, damping: 30 };
  const heroY = useSpring(useTransform(scrollYProgress, [0, 0.3], [0, -50]), springOption);

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Navbar */}
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="fixed top-0 left-0 right-0 z-50 bg-background/60 backdrop-blur-xl border-b border-border/50"
      >
        <div className="container flex items-center justify-between h-18 md:h-20">
          <motion.div
            className="flex items-center gap-2 cursor-pointer"
            whileHover={{ scale: 1.02 }}
            onClick={() => navigate("/")}
          >
            <div className="w-10 h-10 rounded-2xl gradient-warm flex items-center justify-center shadow-card">
              <Pill className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-2xl font-extrabold tracking-tight">
              <span className="gradient-text">Med</span>Buddy
            </span>
          </motion.div>

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <motion.a
                key={link.label}
                href={link.href}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors relative group"
                whileHover={{ y: -2 }}
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-primary group-hover:w-full transition-all duration-300" />
              </motion.a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")}>
              Sign In
            </Button>
            <Button variant="hero" size="sm" onClick={() => navigate("/auth")}>
              Get Started Free
              <ArrowRight className="ml-1 w-4 h-4" />
            </Button>
          </div>

          <button
            className="md:hidden p-2.5 rounded-xl hover:bg-muted transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={menuOpen ? "close" : "open"}
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </motion.div>
            </AnimatePresence>
          </button>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="md:hidden overflow-hidden border-t border-border/50 bg-background/95 backdrop-blur-xl"
            >
              <div className="container py-6 space-y-4">
                {navLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className="block py-3 text-lg font-medium text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setMenuOpen(false)}
                  >
                    {link.label}
                  </a>
                ))}
                <div className="pt-4 flex flex-col gap-3">
                  <Button variant="outline" className="w-full" onClick={() => { navigate("/auth"); setMenuOpen(false); }}>
                    Sign In
                  </Button>
                  <Button variant="hero" className="w-full" onClick={() => { navigate("/auth"); setMenuOpen(false); }}>
                    Get Started Free
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>

      {/* Hero Section */}
      <section className="relative pt-28 pb-20 md:pt-40 md:pb-32 overflow-hidden">
        <FloatingParticles />

        {/* Background blobs */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl -translate-y-1/2" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-3xl translate-y-1/2" />

        <div className="container relative">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Left content */}
            <motion.div
              style={{ y: heroY, opacity, scale }}
              className="relative z-10"
            >
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-semibold mb-8"
              >
                <Sparkles className="w-4 h-4" />
                <span>AI-Powered Medicine Management</span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.2 }}
                className="text-5xl md:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight mb-6"
              >
                Never Miss a{" "}
                <span className="relative">
                  <span className="gradient-text">Medicine</span>
                  <motion.span
                    className="absolute -bottom-2 left-0 right-0 h-3 bg-primary/20 rounded-full -z-10"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.8, delay: 0.8 }}
                  />
                </span>
                <br />Again
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="text-lg md:text-xl text-muted-foreground mb-10 max-w-lg leading-relaxed"
              >
                Upload prescriptions, get AI-powered reminders in{" "}
                <span className="font-semibold text-foreground">8 Indian languages</span>,
                and keep your entire family informed — all in one place.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
                className="flex flex-col sm:flex-row gap-4 mb-10"
              >
                <Button
                  variant="hero"
                  size="xl"
                  className="group"
                  onClick={() => navigate("/auth")}
                >
                  Start Free — No Credit Card
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  variant="outline"
                  size="xl"
                  className="group"
                  onClick={() => {
                    document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  <Play className="mr-2 w-5 h-5" />
                  See How It Works
                </Button>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.6 }}
                className="flex flex-wrap items-center gap-6 text-sm"
              >
                {[
                  { icon: CheckCircle2, text: "Free forever plan" },
                  { icon: CheckCircle2, text: "8 languages" },
                  { icon: CheckCircle2, text: "HIPAA Compliant" },
                ].map((item, i) => (
                  <motion.span
                    key={i}
                    className="flex items-center gap-2 text-muted-foreground"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.7 + i * 0.1 }}
                  >
                    <item.icon className="w-4 h-4 text-secondary" />
                    {item.text}
                  </motion.span>
                ))}
              </motion.div>
            </motion.div>

            {/* Right content - Dashboard mockup */}
            <motion.div
              style={{ y }}
              className="relative hidden lg:block"
            >
              {/* Main dashboard card */}
              <motion.div
                initial={{ opacity: 0, x: 60 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="relative"
              >
                <div className="bg-card rounded-3xl shadow-float border border-border/50 p-8">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl gradient-warm flex items-center justify-center shadow-card">
                        <Pill className="w-7 h-7 text-primary-foreground" />
                      </div>
                      <div>
                        <p className="text-xl font-bold">Today's Schedule</p>
                        <p className="text-sm text-muted-foreground">Monday, April 13</p>
                      </div>
                    </div>
                    <div className="bg-secondary/10 text-secondary px-3 py-1.5 rounded-full text-sm font-semibold">
                      3 of 4 Done
                    </div>
                  </div>

                  <div className="space-y-4">
                    {[
                      { name: "Metformin 500mg", time: "7:00 AM", status: "taken", icon: "💊" },
                      { name: "Amlodipine 5mg", time: "8:00 AM", status: "taken", icon: "💊" },
                      { name: "Paracetamol 650mg", time: "2:00 PM", status: "current", icon: "⏰" },
                      { name: "Omeprazole 20mg", time: "10:00 PM", status: "pending", icon: "⏳" },
                    ].map((med, i) => (
                      <motion.div
                        key={med.name}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.6 + i * 0.1 }}
                        className={`flex items-center justify-between p-4 rounded-2xl transition-all ${
                          med.status === "taken" ? "bg-secondary/5 border border-secondary/10" :
                          med.status === "current" ? "bg-primary/5 border-2 border-primary/30 shadow-lg" :
                          "bg-muted/50 border border-border/50"
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-2xl">{med.icon}</span>
                          <div>
                            <p className={`font-semibold ${med.status === "pending" ? "text-muted-foreground" : ""}`}>
                              {med.name}
                            </p>
                            <p className="text-sm text-muted-foreground">{med.time}</p>
                          </div>
                        </div>
                        <span className={`text-sm font-semibold px-3 py-1.5 rounded-xl ${
                          med.status === "taken" ? "bg-secondary/10 text-secondary" :
                          med.status === "current" ? "bg-primary text-primary-foreground" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {med.status === "taken" ? "✓ Taken" : med.status === "current" ? "Now" : "Later"}
                        </span>
                      </motion.div>
                    ))}
                  </div>

                  {/* Progress bar */}
                  <div className="mt-8">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Weekly Progress</span>
                      <span className="font-semibold text-secondary">75%</span>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: "75%" }}
                        transition={{ delay: 1, duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full gradient-warm rounded-full"
                      />
                    </div>
                  </div>
                </div>

                {/* Floating notification */}
                <motion.div
                  animate={{ y: [0, -12, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -top-6 -right-6 bg-card rounded-2xl shadow-float border border-border/50 p-5 max-w-[240px]"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Bell className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">⏰ Time for medicine!</p>
                      <p className="text-xs text-muted-foreground mt-1">Paracetamol 650mg</p>
                      <p className="text-xs text-primary font-medium mt-1">Tap to mark as taken</p>
                    </div>
                  </div>
                </motion.div>

                {/* Language card */}
                <motion.div
                  animate={{ y: [0, 10, 0] }}
                  transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                  className="absolute -bottom-4 -left-8 bg-card rounded-2xl shadow-float border border-border/50 p-4"
                >
                  <div className="flex items-center gap-3">
                    <Globe className="w-6 h-6 text-primary" />
                    <div>
                      <p className="text-sm font-bold">📱 Telugu Reminder</p>
                      <p className="text-xs text-muted-foreground">"దయచేసి మందు తీసుకోండి"</p>
                    </div>
                  </div>
                </motion.div>

                {/* AI badge */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.2 }}
                  className="absolute top-4 -left-4 bg-background/80 backdrop-blur-sm rounded-xl border border-border/50 px-4 py-2 shadow-lg"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 flex items-center justify-center">
                      <Zap className="w-3 h-3 text-white" />
                    </div>
                    <span className="text-sm font-medium">AI-Powered</span>
                  </div>
                </motion.div>
              </motion.div>
            </motion.div>
          </div>

          {/* Trusted by section */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1 }}
            className="mt-20 md:mt-28 text-center"
          >
            <p className="text-sm font-medium text-muted-foreground mb-8">Trusted by families across India</p>
            <div className="flex flex-wrap justify-center items-center gap-8 md:gap-12 opacity-60">
              {trustedBy.map((company) => (
                <span key={company} className="text-lg font-semibold text-muted-foreground">
                  {company}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats Section */}
      <section id="stats-section" className="py-20 gradient-soft">
        <div className="container">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="grid grid-cols-2 md:grid-cols-5 gap-8 md:gap-4"
          >
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                variants={fadeInUp}
                className="text-center"
              >
                <div className="text-4xl md:text-5xl lg:text-6xl font-extrabold gradient-text mb-2">
                  {stat.value}{stat.suffix}
                </div>
                <p className="text-sm md:text-base text-muted-foreground font-medium">{stat.label}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="py-24 md:py-32">
        <div className="container">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto mb-16"
          >
            <motion.p variants={fadeInUp} className="text-primary font-semibold mb-4 tracking-wide uppercase">
              The Challenge
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">
              Medicine Management is Broken
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground">
              50% of elderly patients miss doses. Language barriers make it worse.
              Families worry constantly. There had to be a better way.
            </motion.p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                emoji: "😟",
                title: "Forgetting Medicines",
                desc: "Without reminders, elderly patients miss doses regularly, leading to serious health complications.",
                stat: "50% miss doses"
              },
              {
                emoji: "🗣️",
                title: "Language Barriers",
                desc: "Most apps are English-only. Your parents need reminders in their native language to feel comfortable.",
                stat: "8 major languages"
              },
              {
                emoji: "😰",
                title: "Caregiver Anxiety",
                desc: "When you live far away, you constantly worry if your parents took their medicines today.",
                stat: "1000s affected"
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                variants={fadeInUp}
                className="group bg-card rounded-3xl border border-border/50 p-8 md:p-10 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1"
              >
                <span className="text-5xl mb-6 block">{item.emoji}</span>
                <h3 className="text-2xl font-bold mb-3">{item.title}</h3>
                <p className="text-muted-foreground mb-6 leading-relaxed">{item.desc}</p>
                <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-semibold">
                  <Heart className="w-4 h-4" />
                  {item.stat}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 md:py-32 gradient-soft">
        <div className="container">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto mb-16"
          >
            <motion.p variants={fadeInUp} className="text-primary font-semibold mb-4 tracking-wide uppercase">
              How It Works
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">
              Simple as 1-2-3-4
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground">
              Get started in under 2 minutes. No technical skills required.
            </motion.p>
          </motion.div>

          <div className="grid md:grid-cols-4 gap-6 md:gap-8">
            {steps.map((step, i) => (
              <motion.div
                key={step.step}
                variants={fadeInUp}
                className="relative"
              >
                <div className="bg-card rounded-3xl border border-border/50 p-8 text-center shadow-card hover:shadow-card-hover transition-all duration-300 h-full">
                  <div className={`w-20 h-20 rounded-3xl bg-gradient-to-br ${step.color} flex items-center justify-center mx-auto mb-6 shadow-lg`}>
                    <step.icon className="w-10 h-10 text-white" />
                  </div>
                  <span className="inline-block text-sm font-bold text-primary/60 mb-2 tracking-wider">STEP {step.step}</span>
                  <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{step.description}</p>
                </div>

                {/* Connector arrow */}
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2">
                    <ArrowRight className="w-8 h-8 text-border" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            className="text-center mt-12"
          >
            <Button variant="hero" size="xl" onClick={() => navigate("/auth")}>
              Try It Now — It's Free
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 md:py-32">
        <div className="container">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto mb-16"
          >
            <motion.p variants={fadeInUp} className="text-primary font-semibold mb-4 tracking-wide uppercase">
              Features
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">
              Everything Your Family Needs
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground">
              Powerful features wrapped in a simple, caring interface.
            </motion.p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                variants={scaleIn}
                className="group bg-card rounded-3xl border border-border/50 p-8 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <feature.icon className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                <p className="text-muted-foreground mb-6 leading-relaxed">{feature.description}</p>
                <div className="inline-flex items-center gap-2 bg-secondary/10 text-secondary px-3 py-1.5 rounded-full text-xs font-semibold">
                  <Zap className="w-3 h-3" />
                  {feature.highlight}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-24 md:py-32 gradient-soft">
        <div className="container">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto mb-16"
          >
            <motion.p variants={fadeInUp} className="text-primary font-semibold mb-4 tracking-wide uppercase">
              Testimonials
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">
              Loved by Families
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground">
              Join thousands of families who trust MedBuddy for their health.
            </motion.p>
          </motion.div>

          <div className="max-w-4xl mx-auto">
            <div className="relative bg-card rounded-3xl border border-border/50 p-8 md:p-12 shadow-float">
              <Quote className="absolute top-8 left-8 w-16 h-16 text-primary/10" />

              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTestimonial}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.4 }}
                  className="relative z-10"
                >
                  <div className="flex gap-1 mb-6">
                    {[...Array(testimonials[activeTestimonial].rating)].map((_, i) => (
                      <Star key={i} className="w-6 h-6 fill-warning text-warning" />
                    ))}
                  </div>

                  <p className="text-2xl md:text-3xl font-medium leading-relaxed mb-8">
                    "{testimonials[activeTestimonial].text}"
                  </p>

                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full gradient-warm flex items-center justify-center text-primary-foreground font-bold text-lg">
                      {testimonials[activeTestimonial].avatar}
                    </div>
                    <div>
                      <p className="font-bold text-lg">{testimonials[activeTestimonial].name}</p>
                      <p className="text-muted-foreground">{testimonials[activeTestimonial].location}</p>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Testimonial indicators */}
              <div className="flex justify-center gap-2 mt-8">
                {testimonials.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveTestimonial(i)}
                    className={`w-3 h-3 rounded-full transition-all ${
                      i === activeTestimonial ? "bg-primary w-8" : "bg-muted hover:bg-primary/50"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Languages Showcase */}
      <section id="languages" className="py-24 md:py-32">
        <div className="container">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto mb-16"
          >
            <motion.p variants={fadeInUp} className="text-primary font-semibold mb-4 tracking-wide uppercase">
              Multilingual
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">
              Speaks Your Language
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground">
              MedBuddy sends reminders in 8 Indian languages. Your parents feel right at home.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 max-w-4xl mx-auto">
            {languages.map((lang, i) => (
              <motion.div
                key={lang.name}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="bg-card rounded-2xl border border-border/50 p-6 text-center shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1 cursor-default"
              >
                <span className="text-4xl mb-3 block">{lang.flag}</span>
                <p className="text-xl font-bold mb-1">{lang.native}</p>
                <p className="text-sm text-muted-foreground font-medium">{lang.name}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-24 md:py-32 gradient-soft">
        <div className="container max-w-3xl">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <motion.p variants={fadeInUp} className="text-primary font-semibold mb-4 tracking-wide uppercase">
              FAQ
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-4xl md:text-5xl font-extrabold tracking-tight">
              Questions? Answers.
            </motion.h2>
          </motion.div>

          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-card"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-6 text-left"
                >
                  <span className="font-semibold text-lg pr-4">{faq.q}</span>
                  <motion.div
                    animate={{ rotate: openFaq === i ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
                  </motion.div>
                </button>
                <AnimatePresence>
                  {openFaq === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-6 text-muted-foreground leading-relaxed">
                        {faq.a}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 md:py-32 relative overflow-hidden">
        <div className="absolute inset-0 gradient-dark" />
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/2 left-1/4 w-96 h-96 bg-primary/50 rounded-full blur-3xl -translate-y-1/2" />
          <div className="absolute top-1/2 right-1/4 w-96 h-96 bg-secondary/50 rounded-full blur-3xl -translate-y-1/2" />
        </div>

        <div className="container relative z-10">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="max-w-3xl mx-auto text-center"
          >
            <motion.div variants={scaleIn} className="w-24 h-24 rounded-3xl gradient-warm flex items-center justify-center mx-auto mb-8 shadow-float">
              <Heart className="w-12 h-12 text-primary-foreground" />
            </motion.div>

            <motion.h2 variants={fadeInUp} className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-primary-foreground mb-6 tracking-tight">
              Give Your Parents the Care They Deserve
            </motion.h2>

            <motion.p variants={fadeInUp} className="text-xl text-primary-foreground/80 mb-10 max-w-xl mx-auto leading-relaxed">
              Join 10,000+ families who trust MedBuddy. It's free, simple, and works in your language.
            </motion.p>

            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                variant="secondary"
                size="xl"
                className="text-lg shadow-lg hover:shadow-xl transition-all"
                onClick={() => navigate("/auth")}
              >
                Get Started — 100% Free
                <ArrowUpRight className="ml-2 w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                size="xl"
                className="text-lg border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10"
                onClick={() => {
                  document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Learn More
              </Button>
            </motion.div>

            <motion.p variants={fadeInUp} className="mt-8 text-sm text-primary-foreground/60">
              No credit card required • Free forever • Setup in 2 minutes
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-card py-16">
        <div className="container">
          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-12 mb-12">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 rounded-xl gradient-warm flex items-center justify-center">
                  <Pill className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="text-2xl font-extrabold tracking-tight">
                  <span className="gradient-text">Med</span>Buddy
                </span>
              </div>
              <p className="text-muted-foreground mb-6 max-w-sm leading-relaxed">
                AI-powered medicine reminders for Indian families. Built with love for healthier lives.
              </p>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded-lg">
                  <Lock className="w-4 h-4 text-secondary" />
                  <span className="text-xs font-medium">HIPAA Compliant</span>
                </div>
                <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded-lg">
                  <Shield className="w-4 h-4 text-secondary" />
                  <span className="text-xs font-medium">256-bit Encryption</span>
                </div>
              </div>
            </div>

            <div>
              <p className="font-bold mb-4">Product</p>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {["Features", "How it Works", "Pricing", "Changelog"].map((item) => (
                  <li key={item}>
                    <a href="#" className="hover:text-foreground transition-colors">{item}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-bold mb-4">Support</p>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {["Help Center", "Contact Us", "FAQ", "Community"].map((item) => (
                  <li key={item}>
                    <a href="#" className="hover:text-foreground transition-colors">{item}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-bold mb-4">Legal</p>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {["Privacy Policy", "Terms of Service", "Cookie Policy", "GDPR"].map((item) => (
                  <li key={item}>
                    <a href="#" className="hover:text-foreground transition-colors">{item}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-border/50 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              © 2026 MedBuddy. Made with ❤️ for healthier Indian families.
            </p>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">Twitter</a>
              <a href="#" className="hover:text-foreground transition-colors">LinkedIn</a>
              <a href="#" className="hover:text-foreground transition-colors">Instagram</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;