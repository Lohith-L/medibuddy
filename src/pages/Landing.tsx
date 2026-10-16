import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion, useScroll, useTransform, useSpring, AnimatePresence } from "framer-motion";
import { SplineScene } from "@/components/ui/splite";
import { Spotlight } from "@/components/ui/spotlight";
import { Capacitor } from "@capacitor/core";
import { useLanguage } from "@/contexts/LanguageContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import BrandLogo from "@/components/BrandLogo";
import ThemeToggle from "@/components/ThemeToggle";
import {
  Clock, Heart, Shield, Users, Smartphone, ArrowRight,
  Menu, X, Upload, Bell, BarChart3, Globe, Check,
  Brain, MessageSquare, Activity, ChevronDown, Play,
  Sparkles, Zap, Lock, HeartHandshake, ArrowUpRight,
  BellOff, Languages, HeartCrack, MapPin, Siren
} from "lucide-react";

// In the Android/iOS app the landing page leaves out the 3D robot column and
// purely decorative, costly effects (floating dots, blurred blobs, scroll parallax,
// glass blur). The website renders exactly as before.
const isNative = Capacitor.isNativePlatform();

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
  { label: "landing.nav.features", href: "#features" },
  { label: "landing.nav.how", href: "#how-it-works" },
  { label: "landing.nav.languages", href: "#languages" },
];

const features = [
  { icon: Brain, title: "landing.feat.1.title", description: "landing.feat.1.desc", highlight: "landing.feat.1.highlight" },
  { icon: Globe, title: "landing.feat.2.title", description: "landing.feat.2.desc", highlight: "landing.feat.2.highlight" },
  { icon: Bell, title: "landing.feat.3.title", description: "landing.feat.3.desc", highlight: "landing.feat.3.highlight" },
  { icon: Users, title: "landing.feat.4.title", description: "landing.feat.4.desc", highlight: "landing.feat.4.highlight" },
  { icon: Activity, title: "landing.feat.5.title", description: "landing.feat.5.desc", highlight: "landing.feat.5.highlight" },
  { icon: Shield, title: "landing.feat.6.title", description: "landing.feat.6.desc", highlight: "landing.feat.6.highlight" },
  { icon: MapPin, title: "landing.feat.7.title", description: "landing.feat.7.desc", highlight: "landing.feat.7.highlight" },
  { icon: Siren, title: "landing.feat.8.title", description: "landing.feat.8.desc", highlight: "landing.feat.8.highlight" },
];

const steps = [
  { step: "01", icon: Upload, title: "landing.step.1.title", description: "landing.step.1.desc", color: "from-blue-500 to-cyan-400" },
  { step: "02", icon: Brain, title: "landing.step.2.title", description: "landing.step.2.desc", color: "from-violet-500 to-purple-400" },
  { step: "03", icon: Bell, title: "landing.step.3.title", description: "landing.step.3.desc", color: "from-emerald-500 to-teal-400" },
  { step: "04", icon: HeartHandshake, title: "landing.step.4.title", description: "landing.step.4.desc", color: "from-rose-500 to-pink-400" },
];

const languages = [
  { name: "landing.langName.en", native: "Hello!", flag: "🇺🇸", speakers: "English" },
  { name: "landing.langName.hi", native: "नमस्ते!", flag: "🇮🇳", speakers: "Hindi" },
  { name: "landing.langName.te", native: "నమస్కారం!", flag: "🇮🇳", speakers: "Telugu" },
  { name: "landing.langName.ta", native: "வணக்கம்!", flag: "🇮🇳", speakers: "Tamil" },
  { name: "landing.langName.kn", native: "ನಮಸ್ಕಾರ!", flag: "🇮🇳", speakers: "Kannada" },
  { name: "landing.langName.mr", native: "नमस्कार!", flag: "🇮🇳", speakers: "Marathi" },
  { name: "landing.langName.bn", native: "নমস্কার!", flag: "🇮🇳", speakers: "Bengali" },
  { name: "landing.langName.gu", native: "નમસ્તે!", flag: "🇮🇳", speakers: "Gujarati" },
];

const faqs = [
  { q: "landing.faq.1.q", a: "landing.faq.1.a" },
  { q: "landing.faq.2.q", a: "landing.faq.2.a" },
  { q: "landing.faq.3.q", a: "landing.faq.3.a" },
  { q: "landing.faq.4.q", a: "landing.faq.4.a" },
  { q: "landing.faq.5.q", a: "landing.faq.5.a" },
];

const stats = [
  { value: "50K+", label: "landing.stat.1", suffix: "" },
  { value: "98%", label: "landing.stat.2", suffix: "" },
  { value: "8", label: "landing.stat.3", suffix: "" },
  { value: "10K+", label: "landing.stat.4", suffix: "" },
];

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
  const { t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -100]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);

  const springOption = { stiffness: 100, damping: 30 };
  const heroY = useSpring(useTransform(scrollYProgress, [0, 0.3], [0, -50]), springOption);

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Navbar */}
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="app-header fixed top-0 left-0 right-0 z-50 bg-background/60 backdrop-blur-xl border-b border-border/50"
      >
        <div className="container flex items-center justify-between h-18 md:h-20">
          <motion.div
            className="flex items-center gap-2 cursor-pointer"
            whileHover={{ scale: 1.02 }}
            onClick={() => navigate("/")}
          >
            <BrandLogo variant="horizontal" className="h-9 md:h-11" />
          </motion.div>

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <motion.a
                key={t(link.label)}
                href={link.href}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors relative group"
                whileHover={{ y: -2 }}
              >
                {t(link.label)}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-primary group-hover:w-full transition-all duration-300" />
              </motion.a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <ThemeToggle />
            <LanguageSwitcher />
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")}>
              {t("landing.signIn")}
            </Button>
            <Button variant="hero" size="sm" onClick={() => navigate("/auth")}>
              {t("landing.getStarted")}
              <ArrowRight className="ml-1 w-4 h-4" />
            </Button>
          </div>

          <ThemeToggle className="md:hidden ml-auto mr-1" />
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
                    key={t(link.label)}
                    href={link.href}
                    className="block py-3 text-lg font-medium text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setMenuOpen(false)}
                  >
                    {t(link.label)}
                  </a>
                ))}
                <div className="pt-4 flex flex-col gap-3">
                  <LanguageSwitcher className="self-start" />
                  <Button variant="outline" className="w-full" onClick={() => { navigate("/auth"); setMenuOpen(false); }}>
                    {t("landing.signIn")}
                  </Button>
                  <Button variant="hero" className="w-full" onClick={() => { navigate("/auth"); setMenuOpen(false); }}>
                    {t("landing.getStarted")}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>

      {/* Hero Section */}
      <section className="relative pt-24 pb-16 md:pt-40 md:pb-32 overflow-hidden">
        {!isNative && (
          <>
            <FloatingParticles />

            {/* Background blobs */}
            <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl -translate-y-1/2" />
            <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-3xl translate-y-1/2" />
          </>
        )}

        <div className="container relative">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-20 items-center min-w-0">
            {/* Left content */}
            <motion.div
              style={isNative ? undefined : { y: heroY, opacity, scale }}
              className="relative z-10 min-w-0"
            >
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-2 rounded-full text-xs sm:text-sm font-semibold mb-8 max-w-full"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span className="truncate">{t("landing.badge")}</span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.2 }}
                className="text-[2rem] sm:text-5xl md:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight mb-6 break-words max-w-full"
              >
                {t("landing.heroLine1")}{" "}
                <span className="relative">
                  <span className="gradient-text">{t("landing.heroHighlight")}</span>
                </span>
                <br />{t("landing.heroLine2")}
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="text-lg md:text-xl text-muted-foreground mb-10 max-w-lg leading-relaxed"
              >
                {t("landing.heroSubBefore")}{" "}
                <span className="font-semibold text-foreground">{t("landing.heroSubLanguages")}</span>{t("landing.heroSubAfter")}
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
                className="flex flex-col sm:flex-row gap-4 mb-10 min-w-0"
              >
                <Button
                  variant="hero"
                  size="xl"
                  className="group w-full sm:w-auto whitespace-normal text-base sm:text-xl px-6 sm:px-10"
                  onClick={() => navigate("/auth")}
                >
                  {t("landing.startFree")}
                  <ArrowRight className="ml-2 w-5 h-5 shrink-0 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  variant="outline"
                  size="xl"
                  className="group w-full sm:w-auto whitespace-normal text-base sm:text-xl px-6 sm:px-10"
                  onClick={() => {
                    document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  <Play className="mr-2 w-5 h-5 shrink-0" />
                  {t("landing.seeHow")}
                </Button>
              </motion.div>


            </motion.div>

            {/* Right content - 3D Interactive Robot (website only; the app
                doesn't render this column at all, so the next section follows
                the hero buttons directly) */}
            {!isNative && (
              <motion.div
                style={{ y }}
                className="relative h-full self-stretch min-w-0"
              >
                {/* Main 3D robot container */}
                <motion.div
                  initial={{ opacity: 0, x: 60 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="relative w-full h-full"
                >
                  <div className="relative w-full h-[250px] sm:h-[320px] lg:h-full lg:min-h-[500px] overflow-hidden bg-transparent">
                    <Spotlight className="-top-40 left-0" size={500} />
                    <SplineScene
                      scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
                      className="w-full h-full"
                    />
                  </div>
                </motion.div>
              </motion.div>
            )}
          </div>


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
            className="grid grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8"
          >
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                variants={fadeInUp}
                className="text-center"
              >
                <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold gradient-text mb-2">
                  {stat.value}{stat.suffix}
                </div>
                <p className="text-sm md:text-base text-muted-foreground font-medium">{t(stat.label)}</p>
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
              {t("landing.challengeEyebrow")}
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-3xl sm:text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">
              {t("landing.challengeTitle")}
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground">
              {t("landing.challengeDesc")}
              
            </motion.p>
          </motion.div>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                icon: BellOff,
                title: "landing.challenge.1.title",
                desc: "landing.challenge.1.desc",
                stat: "landing.challenge.1.stat"
              },
              {
                icon: Languages,
                title: "landing.challenge.2.title",
                desc: "landing.challenge.2.desc",
                stat: "landing.challenge.2.stat"
              },
              {
                icon: HeartCrack,
                title: "landing.challenge.3.title",
                desc: "landing.challenge.3.desc",
                stat: "landing.challenge.3.stat"
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                variants={fadeInUp}
                className="group bg-card rounded-3xl border border-border/50 p-8 md:p-10 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <item.icon className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-2xl font-bold mb-3">{t(item.title)}</h3>
                <p className="text-muted-foreground mb-6 leading-relaxed">{t(item.desc)}</p>
                <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-semibold">
                  <Heart className="w-4 h-4" />
                  {t(item.stat)}
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
              {t("landing.howEyebrow")}
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-3xl sm:text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">
              {t("landing.howTitle")}
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground">
              {t("landing.howDesc")}
            </motion.p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
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
                  <span className="inline-block text-sm font-bold text-primary/60 mb-2 tracking-wider">{t("landing.stepN", { n: step.step })}</span>
                  <h3 className="text-xl font-bold mb-3">{t(step.title)}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{t(step.description)}</p>
                </div>

                {/* Connector arrow */}
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-4 transform -translate-y-1/2">
                    <ArrowRight className="w-8 h-8 text-border" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>


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
              {t("landing.featuresEyebrow")}
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-3xl sm:text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">
              {t("landing.featuresTitle")}
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground">
              {t("landing.featuresDesc")}
            </motion.p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                variants={scaleIn}
                className="group bg-card rounded-3xl border border-border/50 p-5 sm:p-6 md:p-8 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-11 h-11 sm:w-12 sm:h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-primary/10 flex items-center justify-center mb-4 md:mb-6 group-hover:scale-110 transition-transform duration-300">
                  <feature.icon className="w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8 text-primary" />
                </div>
                <h3 className="text-base sm:text-lg md:text-xl font-bold mb-2 md:mb-3">{t(feature.title)}</h3>
                <p className="text-sm md:text-base text-muted-foreground mb-4 md:mb-6 leading-relaxed">{t(feature.description)}</p>
                <div className="inline-flex items-center gap-2 bg-secondary/10 text-secondary px-3 py-1.5 rounded-full text-xs font-semibold">
                  <Zap className="w-3 h-3" />
                  {t(feature.highlight)}
                </div>
              </motion.div>
            ))}
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
              {t("landing.langEyebrow")}
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-3xl sm:text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">
              {t("landing.langTitle")}
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-muted-foreground">
              {t("landing.langDesc")}
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
                className="bg-card rounded-2xl border border-border/50 p-4 sm:p-6 text-center shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1 cursor-default"
              >
                <span className="text-4xl mb-3 block">{lang.flag}</span>
                <p className="text-xl font-bold mb-1">{lang.native}</p>
                <p className="text-sm text-muted-foreground font-medium">{t(lang.name)}</p>
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
              {t("landing.faqEyebrow")}
            </motion.p>
            <motion.h2 variants={fadeInUp} className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight">
              {t("landing.faqTitle")}
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
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left min-h-[44px]"
                >
                  <span className="font-semibold text-base sm:text-lg pr-4">{t(faq.q)}</span>
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
                        {t(faq.a)}
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
        {!isNative && (
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-1/2 left-1/4 w-96 h-96 bg-primary/50 rounded-full blur-3xl -translate-y-1/2" />
            <div className="absolute top-1/2 right-1/4 w-96 h-96 bg-secondary/50 rounded-full blur-3xl -translate-y-1/2" />
          </div>
        )}

        <div className="container relative z-10">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="max-w-3xl mx-auto text-center"
          >
            <motion.div variants={scaleIn} className="w-28 h-28 rounded-3xl bg-white flex items-center justify-center mx-auto mb-8 shadow-float p-3">
              <BrandLogo variant="symbol" className="h-full" />
            </motion.div>

            <motion.h2 variants={fadeInUp} className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-primary-foreground mb-6 tracking-tight">
              {t("landing.ctaTitle")}
            </motion.h2>

            <motion.p variants={fadeInUp} className="text-xl text-primary-foreground/80 mb-10 max-w-xl mx-auto leading-relaxed">
              {t("landing.ctaDesc")}
            </motion.p>

            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                variant="secondary"
                size="xl"
                className="text-lg shadow-lg hover:shadow-xl transition-all"
                onClick={() => navigate("/auth")}
              >
                {t("landing.ctaButton")}
                <ArrowUpRight className="ml-2 w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                size="xl"
                className="text-lg bg-transparent hover:bg-primary-foreground/10 text-primary-foreground hover:text-primary-foreground border-primary-foreground/30 hover:border-primary-foreground/50"
                onClick={() => {
                  document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                {t("landing.learnMore")}
              </Button>
            </motion.div>


          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-card py-16">
        <div className="container">
          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-12 mb-12">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <BrandLogo variant="horizontal" className="h-11" />
              </div>
              <p className="text-muted-foreground mb-6 max-w-sm leading-relaxed">
                {t("landing.footerTagline")}
              </p>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded-lg">
                  <Lock className="w-4 h-4 text-secondary" />
                  <span className="text-xs font-medium">{t("landing.hipaa")}</span>
                </div>
                <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded-lg">
                  <Shield className="w-4 h-4 text-secondary" />
                  <span className="text-xs font-medium">{t("landing.encryption")}</span>
                </div>
              </div>
            </div>

            <div>
              <p className="font-bold mb-4">{t("landing.footerProduct")}</p>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {["landing.nav.features", "landing.nav.how", "landing.footer.pricing", "landing.footer.changelog"].map((item) => (
                  <li key={item}>
                    <a href="#" className="hover:text-foreground transition-colors">{t(item)}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-bold mb-4">{t("landing.footerSupport")}</p>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {["landing.footer.help", "landing.footer.contact", "landing.faqEyebrow", "landing.footer.community"].map((item) => (
                  <li key={item}>
                    <a href="#" className="hover:text-foreground transition-colors">{t(item)}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-bold mb-4">{t("landing.footerLegal")}</p>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {["landing.footer.privacy", "landing.footer.terms", "landing.footer.cookies", "landing.footer.gdpr"].map((item) => (
                  <li key={item}>
                    <a href="#" className="hover:text-foreground transition-colors">{t(item)}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-border/50 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              {t("landing.copyright")}
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