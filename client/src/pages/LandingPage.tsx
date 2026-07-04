import { Link, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Shield, FileText, AlertTriangle, Search, MessageCircle, 
  ChevronRight, Phone, Mail, Clock, Menu, X, ChevronUp, ShieldCheck, 
  Globe, ArrowRight, Quote, Send, 
  HeartHandshake, Scale, Fingerprint,
  Building2, Target, Activity, Database, Network, FileSearch
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useFormat } from "@/i18n/format";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BuildStampLine } from "@/components/BuildStampLine";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { PremiumBackground, SubduedSpaceBackground } from "@/components/PremiumBackground";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";

import fraudPreventionImg from "@assets/stock_images/professional_busines_04dbc0cc.jpg";
import supportImg from "@assets/stock_images/customer_support_hel_5992ddae.jpg";
import verificationImg from "@assets/stock_images/digital_verification_c77d4aa6.jpg";
import caseManagementImg from "@assets/stock_images/document_filing_case_067f3224.jpg";

const fadeIn = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 }
};

const fadeInScale = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const services = [
  {
    id: "report",
    title: "Report Suspicious Activity",
    description: "Document and report potential fraud, scams, or suspicious blockchain-related incidents for professional investigation.",
    icon: AlertTriangle,
    image: fraudPreventionImg,
    href: "/verify",
    gradient: "from-red-500 via-orange-500 to-amber-500",
    bgGlow: "bg-red-500/20"
  },
  {
    id: "verify",
    title: "Verify Platform Legitimacy",
    description: "Check if a cryptocurrency platform, exchange, or service is legitimate and registered with authorities.",
    icon: Search,
    image: verificationImg,
    href: "/verify",
    gradient: "from-blue-500 via-cyan-500 to-teal-500",
    bgGlow: "bg-blue-500/20"
  },
  {
    id: "case-status",
    title: "Track Your Case",
    description: "Access your existing case dashboard using your unique verification code to track progress in real-time.",
    icon: FileText,
    image: caseManagementImg,
    href: "/verify",
    gradient: "from-emerald-500 via-green-500 to-lime-500",
    bgGlow: "bg-emerald-500/20"
  },
  {
    id: "support",
    title: "24/7 Expert Support",
    description: "Connect with our dedicated support team for immediate assistance with your case or general inquiries.",
    icon: MessageCircle,
    image: supportImg,
    href: "/verify",
    gradient: "from-purple-500 via-violet-500 to-fuchsia-500",
    bgGlow: "bg-purple-500/20"
  }
];

const departments = [
  {
    id: "aml",
    title: "AML Division",
    subtitle: "Anti-Money Laundering",
    description: "Transaction monitoring, suspicious activity reports, and compliance auditing.",
    icon: ShieldCheck,
    image: "/images/dept-aml.png",
    color: "from-blue-600 to-cyan-500"
  },
  {
    id: "cyber",
    title: "Cybercrime & Digital Forensics",
    subtitle: "Blockchain Trace Analysis",
    description: "Wallet forensics, dark web surveillance, and advanced crypto-tracing.",
    icon: Network,
    image: "/images/dept-cyber.png",
    color: "from-purple-600 to-indigo-500"
  },
  {
    id: "recovery",
    title: "Asset Recovery Unit",
    subtitle: "Cross-Border Enforcement",
    description: "Civil litigation support, frozen assets tracking, and global recovery operations.",
    icon: Database,
    image: "/images/dept-recovery.png",
    color: "from-amber-600 to-yellow-500"
  },
  {
    id: "compliance",
    title: "Compliance & Regulatory Affairs",
    subtitle: "FATF Alignment",
    description: "Jurisdictional reporting, legal framework adherence, and regulatory coordination.",
    icon: Scale,
    image: "/images/dept-compliance.png",
    color: "from-slate-600 to-slate-400"
  },
  {
    id: "intelligence",
    title: "Intelligence & Threat Analysis",
    subtitle: "Threat Actor Profiling",
    description: "Scam network mapping, early warning systems, and actionable intel.",
    icon: Activity,
    image: "/images/dept-intel.png",
    color: "from-red-600 to-rose-500"
  },
  {
    id: "support",
    title: "Victim Support Services",
    subtitle: "Case Intake & Advocacy",
    description: "Secure case intake, victim advocacy, and holistic recovery counseling.",
    icon: HeartHandshake,
    image: "/images/dept-support.png",
    color: "from-emerald-600 to-teal-500"
  }
];

const complianceBadges = [
  { id: "fatf", name: "FATF" },
  { id: "fincen", name: "FinCEN" },
  { id: "fca", name: "FCA" },
  { id: "interpol", name: "INTERPOL" },
  { id: "iso", name: "ISO 27001" }
];

const partners = [
  { name: "UNODC", short: "UN" },
  { name: "Europol", short: "EU" },
  { name: "Global Cyber Alliance", short: "GCA" },
  { name: "World Economic Forum", short: "WEF" },
  { name: "Financial Intelligence Units", short: "FIU" }
];

const _defaultFaqs = [
  { question: "How do I file a complaint?", answer: "You can file a complaint by clicking the 'Access Portal' button and entering your case access code. If you're a new user, contact our support team to initiate a case." },
  { question: "How long does the investigation process take?", answer: "Investigation timelines vary depending on complexity. Most cases receive initial review within 24-48 hours, with full investigations typically completed within 2-4 weeks." },
  { question: "Is my information kept confidential?", answer: "Yes, absolutely. All information submitted to IBCCF is encrypted and stored securely. We never share personal information without explicit consent." },
  { question: "What types of fraud can I report?", answer: "You can report cryptocurrency scams, fraudulent exchanges, phishing attempts, Ponzi schemes, and any blockchain-related suspicious activities." },
  { question: "Can I track my case status?", answer: "Yes, once your case is created, you'll receive a unique access code that allows you to log in and track your case progress in real-time." }
];

function useAnimatedCounter(endValue: number, duration: number = 2000) {
  const [count, setCount] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isVisible) {
          setIsVisible(true);
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    let startTime: number;
    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(easeOut * endValue));
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }, [isVisible, endValue, duration]);

  return { count, ref };
}

function StatCounter({ value, label, suffix = "", icon: Icon }: { value: number; label: string; suffix?: string; icon?: any }) {
  const { count, ref } = useAnimatedCounter(value, 2500);
  const { formatNumber } = useFormat();
  return (
    <motion.div 
      ref={ref} 
      className="bg-slate-900/50 backdrop-blur-md border border-slate-700/50 rounded-2xl p-6 text-center group cursor-default relative overflow-hidden"
      whileHover={{ scale: 1.05, y: -4 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      {Icon && (
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-400/20 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
          <Icon className="w-6 h-6 text-blue-400" />
        </div>
      )}
      <div className="text-4xl md:text-5xl font-bold text-white mb-2 tracking-tight" style={{ textShadow: '0 0 20px rgba(59,130,246,0.3)' }}>
        {formatNumber(count)}{suffix}
      </div>
      <div className="text-white/60 text-sm font-semibold uppercase tracking-widest">{label}</div>
    </motion.div>
  );
}

function ScamAlertsTicker() {
  const { t } = useTranslation("landing");
  const { data: alerts = [] } = useQuery<any[]>({
    queryKey: ['/api/public/scam-alerts'],
    refetchInterval: 30000
  });

  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (alerts.length === 0) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % alerts.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [alerts.length]);

  if (alerts.length === 0) return null;

  const currentAlert = alerts[currentIndex];
  const severityColors: Record<string, string> = {
    critical: "bg-gradient-to-r from-red-600 to-red-500",
    high: "bg-gradient-to-r from-orange-600 to-orange-500",
    medium: "bg-gradient-to-r from-yellow-600 to-yellow-500",
    low: "bg-gradient-to-r from-blue-600 to-blue-500"
  };

  return (
    <div className="bg-[#020817] border-y border-slate-800 overflow-hidden relative z-40">
      <div className="max-w-7xl mx-auto px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Activity className="w-4 h-4 text-red-500" />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping" />
            </div>
            <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">{t("ticker.globalFeed")}</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-3 overflow-hidden"
            >
              <span className={`px-2.5 py-1 rounded-sm text-[10px] font-bold text-white uppercase tracking-wider ${severityColors[currentAlert.severity] || 'bg-slate-700'}`}>
                {currentAlert.severity}
              </span>
              <span className="text-white/90 text-sm font-medium truncate">{currentAlert.title}</span>
              {currentAlert.platformName && (
                <span className="text-white/50 text-xs font-medium uppercase tracking-wider hidden sm:inline-block">/ {currentAlert.platformName}</span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function LiveActivityIndicator() {
  const { t } = useTranslation("landing");
  const [viewers, setViewers] = useState(Math.floor(Math.random() * 50) + 150);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setViewers(prev => Math.max(100, prev + Math.floor(Math.random() * 7) - 3));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 1 }}
      className="fixed bottom-24 left-4 z-40 hidden lg:block"
    >
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg p-3 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 bg-blue-900/50 rounded flex items-center justify-center border border-blue-500/30">
              <Globe className="w-4 h-4 text-blue-400" />
            </div>
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse border-2 border-slate-900" />
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-none">{viewers}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">{t("liveActivity.activePersonnel")}</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function BackToTop() {
  const { t } = useTranslation("landing");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 20 }}
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-50 w-12 h-12 bg-slate-800 hover:bg-slate-700 text-white rounded flex items-center justify-center shadow-2xl transition-colors border border-slate-700"
          aria-label={t("backToTop.aria")}
          data-testid="button-back-to-top"
        >
          <ChevronUp className="w-5 h-5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function CookieConsent() {
  const { t } = useTranslation("landing");
  const [show, setShow] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookieConsent');
    if (!consent) {
      setTimeout(() => setShow(true), 2000);
    }
  }, []);

  const accept = () => {
    localStorage.setItem('cookieConsent', 'accepted');
    setShow(false);
  };

  if (!show) return null;

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 p-4"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-blue-500 hidden sm:block" />
          <p className="text-sm text-slate-300 text-center sm:text-left">
            {t("cookie.message")}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => setShow(false)}>
            {t("cookie.decline")}
          </Button>
          <Button size="sm" className="bg-blue-600 text-white hover:bg-blue-700" onClick={accept} data-testid="button-accept-cookies">
            {t("cookie.accept")}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "", platform: "", incidentDate: "", amountLost: "" });
  const [complaintSubmitted, setComplaintSubmitted] = useState(false);
  const { toast } = useToast();
  const { t: commonT } = useTranslation("common");
  const { t: landingT } = useTranslation("landing");
  const [, _setLocation] = useLocation();
  const { scrollYProgress } = useScroll();
  const headerOpacity = useTransform(scrollYProgress, [0, 0.1], [1, 0.95]);
  
  const { data: testimonials = [] } = useQuery<any[]>({
    queryKey: ['/api/public/testimonials']
  });

  const { data: faqs = [] } = useQuery<any[]>({
    queryKey: ['/api/public/faq']
  });

  const { data: stats = [] } = useQuery<any[]>({
    queryKey: ['/api/public/statistics']
  });

  const newsletterMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch('/api/public/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to subscribe');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: landingT("newsletter.subscribedTitle"), description: landingT("newsletter.subscribedDesc") });
      setNewsletterEmail("");
    },
    onError: (error: Error) => {
      toast({ title: landingT("newsletter.errorTitle"), description: error.message, variant: "destructive" });
    }
  });

  const contactMutation = useMutation({
    mutationFn: async (data: typeof contactForm) => {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          subject: data.subject || undefined,
          message: data.message,
          platform: data.platform || undefined,
          incidentDate: data.incidentDate || undefined,
          amountLost: data.amountLost || undefined,
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: landingT("contact.toastSuccessTitle"), description: landingT("contact.toastSuccessDesc") });
      setContactForm({ name: "", email: "", subject: "", message: "", platform: "", incidentDate: "", amountLost: "" });
      setComplaintSubmitted(true);
    },
    onError: () => {
      toast({ title: landingT("contact.toastErrorTitle"), description: landingT("contact.toastErrorDesc"), variant: "destructive" });
    }
  });

  const localizedDefaultFaqs = [
    { question: landingT("faqSection.defaults.q1"), answer: landingT("faqSection.defaults.a1") },
    { question: landingT("faqSection.defaults.q2"), answer: landingT("faqSection.defaults.a2") },
    { question: landingT("faqSection.defaults.q3"), answer: landingT("faqSection.defaults.a3") },
    { question: landingT("faqSection.defaults.q4"), answer: landingT("faqSection.defaults.a4") },
    { question: landingT("faqSection.defaults.q5"), answer: landingT("faqSection.defaults.a5") },
  ];
  const displayFaqs = faqs.length > 0 ? faqs : localizedDefaultFaqs;
  const displayStats = stats.length > 0 ? stats : [
    { key: 'cases_resolved', label: landingT("stats.casesResolved"), value: '50000', suffix: '+' },
    { key: 'response_time', label: landingT("stats.responseTime"), value: '2', suffix: 'h' },
    { key: 'recovery_rate', label: landingT("stats.recoveryRate"), value: '94', suffix: '%' },
    { key: 'countries', label: landingT("stats.countries"), value: '180', suffix: '+' }
  ];

  return (
    <div className="min-h-screen bg-[#020817] text-slate-300 font-sans selection:bg-blue-500/30 selection:text-blue-200">
      <ScamAlertsTicker />

      {/* Header */}
      <motion.header 
        style={{ opacity: headerOpacity }}
        className="fixed top-0 left-0 right-0 z-50 bg-[#020817]/90 backdrop-blur-md border-b border-slate-800 transition-all duration-300 pt-10" // added pt-10 to account for ticker
      >
        <div className="max-w-[1400px] mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-900 rounded border border-blue-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.3)] group-hover:shadow-[0_0_25px_rgba(37,99,235,0.5)] transition-shadow">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-bold text-white tracking-wider">IBCCF</span>
                <span className="text-[9px] text-slate-400 uppercase tracking-widest">{landingT("header.brandSubtitle")}</span>
              </div>
            </Link>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-8">
            <div className="flex items-center gap-6 text-sm font-medium text-slate-300 uppercase tracking-wider">
              <a href="#departments" className="hover:text-white transition-colors">{landingT("nav.departments", { defaultValue: "Departments" })}</a>
              <a href="#services" className="hover:text-white transition-colors">{landingT("nav.services", { defaultValue: "Services" })}</a>
              <Link href="/community" className="hover:text-white transition-colors">{commonT("nav.intelNetwork")}</Link>
              <Link href="/legal-resources" className="hover:text-white transition-colors">{commonT("nav.legalResources")}</Link>
              <a href="#faq" className="hover:text-white transition-colors">{landingT("nav.faq", { defaultValue: "FAQ" })}</a>
            </div>
            
            <div className="flex items-center gap-4 border-l border-slate-800 pl-8">
              <LanguageSwitcher variant="header" />
              <Link href="/request-access">
                <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-slate-800 border-0 rounded" data-testid="nav-request-access">
                  {landingT("header.submitReport")}
                </Button>
              </Link>
              <Link href="/verify">
                <Button className="bg-blue-600 hover:bg-blue-500 text-white rounded font-bold tracking-wide shadow-[0_0_15px_rgba(37,99,235,0.3)] border border-blue-500" data-testid="nav-verify">
                  {landingT("header.accessPortal")}
                </Button>
              </Link>
            </div>
          </nav>

          {/* Mobile Menu Toggle */}
          <button 
            className="lg:hidden p-2 text-slate-400 hover:text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={landingT("header.toggleMenu")}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Nav */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden border-t border-slate-800 bg-[#020817]"
            >
              <div className="flex flex-col px-4 py-6 space-y-4">
                <a href="#departments" className="text-slate-300 hover:text-white uppercase tracking-wider text-sm p-2" onClick={() => setMobileMenuOpen(false)}>{landingT("nav.departments")}</a>
                <a href="#services" className="text-slate-300 hover:text-white uppercase tracking-wider text-sm p-2" onClick={() => setMobileMenuOpen(false)}>{landingT("nav.services")}</a>
                <Link href="/community" className="text-slate-300 hover:text-white uppercase tracking-wider text-sm p-2" onClick={() => setMobileMenuOpen(false)}>{landingT("nav.intelNetwork")}</Link>
                <Link href="/legal-resources" className="text-slate-300 hover:text-white uppercase tracking-wider text-sm p-2" onClick={() => setMobileMenuOpen(false)}>{landingT("nav.legalHub")}</Link>
                <a href="#faq" className="text-slate-300 hover:text-white uppercase tracking-wider text-sm p-2" onClick={() => setMobileMenuOpen(false)}>{landingT("nav.faq")}</a>
                <div className="h-px bg-slate-800 my-2" />
                <Link href="/request-access" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="outline" className="w-full justify-start border-slate-700 text-slate-300 rounded" data-testid="mobile-nav-request-access">
                    {landingT("header.submitReport")}
                  </Button>
                </Link>
                <Link href="/verify" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full justify-start bg-blue-600 hover:bg-blue-500 text-white rounded border border-blue-500" data-testid="mobile-nav-verify">
                    {landingT("header.accessPortal")}
                  </Button>
                </Link>
                {/* Mobile language switcher — mobile public visitors
                    must be able to change language without opening the
                    desktop layout. */}
                <div className="pt-2 flex justify-start">
                  <LanguageSwitcher variant="compact" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>

      <main id="main-content" tabIndex={-1} className="pt-[120px]">
        {/* ===== HERO SECTION ===== */}
        <section className="relative min-h-[90vh] flex items-center pt-20 pb-32 overflow-hidden border-b border-slate-800" aria-label={landingT("hero.ariaLabel")}>
          <PremiumBackground />

          <div className="max-w-[1400px] mx-auto px-4 relative z-10 w-full">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <motion.div
                initial="hidden"
                animate="visible"
                variants={staggerContainer}
                className="text-left"
              >
                <motion.div variants={fadeIn} className="inline-flex items-center gap-3 px-4 py-2 border border-blue-500/30 bg-blue-500/10 rounded-sm mb-8">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                  </span>
                  <span className="text-xs font-bold text-blue-300 uppercase tracking-widest">{landingT("hero.globalIntelActive")}</span>
                </motion.div>

                <motion.h1 variants={fadeIn} className="text-5xl md:text-6xl lg:text-7xl font-extrabold text-white leading-[1.1] tracking-tight mb-8">
                  {landingT("hero.titleLine1")} <br/>
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-teal-400">{landingT("hero.titleLine2")}</span>
                </motion.h1>

                <motion.p variants={fadeIn} className="text-lg md:text-xl text-slate-400 mb-10 max-w-xl leading-relaxed border-l-2 border-slate-700 pl-6">
                  {landingT("hero.paragraph")}
                </motion.p>

                <motion.div variants={fadeIn} className="flex flex-col sm:flex-row gap-4">
                  <Link href="/verify">
                    <Button size="lg" className="h-14 px-8 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold tracking-wider uppercase text-sm shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:shadow-[0_0_30px_rgba(37,99,235,0.6)] border border-blue-400 transition-all duration-200 w-full sm:w-auto" data-testid="hero-button-access">
                      {landingT("hero.accessSecurePortal")}
                      <ChevronRight className="ml-2 w-4 h-4" />
                    </Button>
                  </Link>
                  <Link href="/request-access">
                    <Button size="lg" variant="outline" className="h-14 px-8 border-blue-700/60 bg-blue-900/20 hover:bg-blue-900/40 hover:border-blue-600 text-white rounded font-bold tracking-wider uppercase text-sm transition-all duration-200 w-full sm:w-auto" data-testid="hero-button-report">
                      {landingT("hero.submitIncidentReport")}
                      <ChevronRight className="ml-2 w-4 h-4 opacity-60" />
                    </Button>
                  </Link>
                </motion.div>

                <motion.div variants={fadeIn} className="mt-12 flex items-center gap-6 border-t border-slate-800 pt-8">
                  <div className="flex -space-x-4">
                    {[1,2,3,4].map((i) => (
                      <div key={i} className="w-10 h-10 rounded-full border-2 border-[#020817] bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400 z-10 relative overflow-hidden">
                        <span className="text-[10px]">{['UN', 'EU', 'UK', 'US'][i-1]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-sm">
                    <div className="text-white font-bold">{landingT("hero.trustedTitle")}</div>
                    <div className="text-slate-500">{landingT("hero.trustedSubtitle")}</div>
                  </div>
                </motion.div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.95, rotateY: 10 }}
                animate={{ opacity: 1, scale: 1, rotateY: 0 }}
                transition={{ duration: 1, delay: 0.4 }}
                className="hidden lg:block relative"
                style={{ perspective: "1000px" }}
              >
                {/* 3D Dashboard representation */}
                <div className="relative z-10 bg-slate-900/80 backdrop-blur-xl border border-slate-700 rounded-lg shadow-2xl p-6 transform-gpu" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(37, 99, 235, 0.2)" }}>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500" />
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                    </div>
                    <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">{landingT("hero.securedConnection")}</div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="h-8 w-1/3 bg-slate-800 rounded animate-pulse" />
                    <div className="grid grid-cols-3 gap-4">
                      <div className="h-24 bg-slate-800 rounded border border-slate-700/50 p-3">
                        <div className="text-[10px] text-slate-500 uppercase mb-2">{landingT("hero.traceStatus")}</div>
                        <div className="h-2 w-1/2 bg-blue-500/50 rounded mb-2" />
                        <div className="h-2 w-3/4 bg-blue-500/30 rounded" />
                      </div>
                      <div className="h-24 bg-slate-800 rounded border border-slate-700/50 p-3">
                        <div className="text-[10px] text-slate-500 uppercase mb-2">{landingT("hero.confidence")}</div>
                        <div className="text-2xl font-bold text-green-400">94%</div>
                      </div>
                      <div className="h-24 bg-slate-800 rounded border border-slate-700/50 p-3">
                        <div className="text-[10px] text-slate-500 uppercase mb-2">{landingT("hero.jurisdiction")}</div>
                        <div className="text-lg font-bold text-slate-300">EU-UK</div>
                      </div>
                    </div>
                    <div className="h-40 bg-slate-800 rounded border border-slate-700/50 overflow-hidden relative">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.1)_0%,transparent_100%)]" />
                      {/* Fake chart lines */}
                      <svg className="absolute bottom-0 w-full h-1/2" preserveAspectRatio="none" viewBox="0 0 100 100">
                        <path d="M0,100 L0,50 Q25,30 50,60 T100,20 L100,100 Z" fill="rgba(37,99,235,0.2)" />
                        <path d="M0,50 Q25,30 50,60 T100,20" fill="none" stroke="rgba(59,130,246,0.8)" strokeWidth="2" />
                      </svg>
                    </div>
                  </div>
                </div>
                
                {/* Floating elements behind */}
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-600/20 blur-[50px] rounded-full" />
                <div className="absolute -bottom-10 -left-10 w-60 h-60 bg-purple-600/20 blur-[60px] rounded-full" />
              </motion.div>
            </div>
          </div>
        </section>

        {/* ===== COMPLIANCE BADGES ===== */}
        <section className="py-10 border-b border-slate-800 bg-[#030a1a]">
          <div className="max-w-[1400px] mx-auto px-4 overflow-hidden">
            <div className="flex flex-wrap justify-center md:justify-between items-center gap-8 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
              {complianceBadges.map((badge, i) => (
                <div key={i} className="flex flex-col items-center group cursor-default">
                  <div className="text-2xl font-black tracking-tighter text-slate-400 group-hover:text-blue-400 transition-colors">
                    {badge.name}
                  </div>
                  <div className="text-[9px] uppercase tracking-widest text-slate-600 group-hover:text-blue-500/70">
                    {landingT(`complianceBadges.${badge.id}`)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== STATS ===== */}
        <section className="py-20 relative bg-[#020817]">
          <div className="max-w-[1400px] mx-auto px-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              {displayStats.map((stat: any, _index: number) => {
                const numValue = parseInt(stat.value.replace(/[^0-9]/g, '')) || 0;
                let icon = Activity;
                if(stat.key === 'cases_resolved') icon = FileSearch;
                if(stat.key === 'response_time') icon = Clock;
                if(stat.key === 'recovery_rate') icon = ShieldCheck;
                if(stat.key === 'countries') icon = Globe;

                return (
                  <StatCounter 
                    key={stat.key} 
                    value={numValue} 
                    label={stat.label} 
                    suffix={stat.suffix || ''} 
                    icon={icon} 
                  />
                );
              })}
            </div>
          </div>
        </section>

        {/* ===== DEPARTMENTS HUB ===== */}
        <section id="departments" className="py-32 relative border-t border-slate-800 bg-[#030a1a]" aria-labelledby="departments-heading">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
          <div className="max-w-[1400px] mx-auto px-4">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="mb-20"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px w-8 bg-blue-500" />
                <span className="text-sm font-bold text-blue-400 uppercase tracking-widest">{landingT("departments.eyebrow")}</span>
              </div>
              <h2 id="departments-heading" className="text-4xl md:text-5xl font-bold text-white tracking-tight max-w-2xl">
                {landingT("departments.sectionTitle")}
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {departments.map((dept, index) => (
                <Link key={dept.id} href={`/divisions/${dept.id}`}>
                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={fadeInScale}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="group relative cursor-pointer"
                  >
                    <div className="absolute -inset-0.5 bg-gradient-to-b from-slate-700 to-slate-800 rounded-lg opacity-50 group-hover:opacity-100 transition-opacity" />
                    <div className="relative h-full bg-slate-900 border border-slate-800 rounded-lg p-1 overflow-hidden">
                      <div className="h-48 overflow-hidden rounded top-section relative">
                        <img src={dept.image} alt={landingT(`departments.items.${dept.id}.title`, { defaultValue: dept.title })} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700" />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 to-transparent" />
                        <div className="absolute bottom-4 left-4">
                          <div className={`w-10 h-10 rounded bg-slate-800/80 backdrop-blur border border-slate-700 flex items-center justify-center mb-2`}>
                            <dept.icon className="w-5 h-5 text-white" />
                          </div>
                        </div>
                      </div>
                      <div className="p-6">
                        <div className="text-[10px] text-blue-400 font-mono uppercase tracking-widest mb-2">{landingT(`departments.items.${dept.id}.subtitle`, { defaultValue: dept.subtitle })}</div>
                        <h3 className="text-xl font-bold text-white mb-3 group-hover:text-blue-300 transition-colors">{landingT(`departments.items.${dept.id}.title`, { defaultValue: dept.title })}</h3>
                        <p className="text-slate-400 text-sm leading-relaxed mb-6">{landingT(`departments.items.${dept.id}.description`, { defaultValue: dept.description })}</p>
                        
                        <div className="flex items-center text-xs font-bold text-slate-500 uppercase tracking-widest group-hover:text-white transition-colors">
                          <span>{landingT("departments.viewDivision")}</span>
                          <ChevronRight className="w-3 h-3 ml-1 transform group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ===== GLOBAL OPERATIONS MAP ===== */}
        <section className="py-32 relative border-t border-slate-800 bg-[#020817] overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img 
              src="/images/global-map.png" 
              alt={landingT("crossBorder.mapAlt")} 
              className="w-full h-full object-cover opacity-20 mix-blend-screen"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#020817] via-[#020817]/80 to-[#020817]/50" />
          </div>

          <div className="max-w-[1400px] mx-auto px-4 relative z-10">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeIn}
                transition={{ duration: 0.5 }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px w-8 bg-amber-500" />
                  <span className="text-sm font-bold text-amber-500 uppercase tracking-widest">{landingT("crossBorder.eyebrow")}</span>
                </div>
                <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-6">
                  {landingT("crossBorder.title")}
                </h2>
                <p className="text-slate-400 text-lg leading-relaxed mb-8">
                  {landingT("crossBorder.paragraph")}
                </p>

                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-1">
                      <Target className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <h4 className="text-white font-bold mb-1">{landingT("crossBorder.treatyTitle")}</h4>
                      <p className="text-sm text-slate-500">{landingT("crossBorder.treatyDesc")}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-1">
                      <Fingerprint className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <h4 className="text-white font-bold mb-1">{landingT("crossBorder.courtTitle")}</h4>
                      <p className="text-sm text-slate-500">{landingT("crossBorder.courtDesc")}</p>
                    </div>
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeInScale}
                className="grid grid-cols-2 gap-4"
              >
                {/* Jurisdiction Cards */}
                {[
                  { id: "na", label: landingT("crossBorder.regions.na") },
                  { id: "eu", label: landingT("crossBorder.regions.eu") },
                  { id: "apac", label: landingT("crossBorder.regions.apac") },
                  { id: "me", label: landingT("crossBorder.regions.me") }
                ].map((region) => (
                  <div key={region.id} className="bg-slate-900/60 backdrop-blur border border-slate-800 p-6 rounded group hover:border-slate-600 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                      <Globe className="w-6 h-6 text-slate-600 group-hover:text-blue-400 transition-colors" />
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                    </div>
                    <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-1">{landingT("crossBorder.activeRegion")}</div>
                    <div className="text-lg font-bold text-white">{region.label}</div>
                  </div>
                ))}
              </motion.div>
            </div>
          </div>
        </section>


        {/* ===== SERVICES (PORTAL FEATURES) ===== */}
        <section id="services" className="py-32 relative border-t border-slate-800 bg-[#030a1a]" aria-labelledby="services-heading">
          <div className="max-w-[1400px] mx-auto px-4">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-20"
            >
              <h2 id="services-heading" className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">
                {landingT("services.sectionTitle")}
              </h2>
              <p className="text-slate-400 max-w-2xl mx-auto text-lg">
                {landingT("services.sectionSubtitle")}
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-8">
              {services.map((service, index) => (
                <motion.div
                  key={service.id}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={fadeInScale}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="group"
                >
                  <Link href={service.href} className="block h-full bg-slate-900 border border-slate-800 rounded hover:border-blue-500/50 transition-colors p-8 relative overflow-hidden" data-testid={`service-card-${service.id}`}>
                    <div className="absolute right-0 top-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors" />
                    
                    <div className="flex items-start gap-6 relative z-10">
                      <div className="w-14 h-14 rounded bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                        <service.icon className="w-6 h-6 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white mb-3">{landingT(`services.items.${service.id}.title`, { defaultValue: service.title })}</h3>
                        <p className="text-slate-400 text-sm leading-relaxed mb-6">
                          {landingT(`services.items.${service.id}.description`, { defaultValue: service.description })}
                        </p>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center group-hover:text-blue-400 transition-colors">
                          {landingT("services.accessModule")} <ArrowRight className="w-3 h-3 ml-2" />
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== HOW IT WORKS ===== */}
        <section id="how-it-works" className="py-32 bg-[#020817] border-t border-slate-800 relative">
          <div className="max-w-[1400px] mx-auto px-4">
             <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="mb-20 text-center"
            >
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">
                {landingT("howItWorks.sectionTitle")}
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-4 gap-8 relative">
              {/* Connector line */}
              <div className="hidden md:block absolute top-12 left-[10%] right-[10%] h-px bg-slate-800" />

              {[
                { step: "01", id: "intake", title: landingT("howItWorks.steps.intake.title"), desc: landingT("howItWorks.steps.intake.desc") },
                { step: "02", id: "triage", title: landingT("howItWorks.steps.triage.title"), desc: landingT("howItWorks.steps.triage.desc") },
                { step: "03", id: "forensics", title: landingT("howItWorks.steps.forensics.title"), desc: landingT("howItWorks.steps.forensics.desc") },
                { step: "04", id: "enforcement", title: landingT("howItWorks.steps.enforcement.title"), desc: landingT("howItWorks.steps.enforcement.desc") }
              ].map((step, i) => (
                <motion.div 
                  key={i}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={fadeIn}
                  transition={{ delay: i * 0.1 }}
                  className="relative text-center"
                >
                  <div className="w-24 h-24 mx-auto bg-[#020817] border-2 border-slate-800 rounded-full flex items-center justify-center mb-6 relative z-10 group hover:border-blue-500 transition-colors">
                    <span className="text-2xl font-mono text-slate-500 group-hover:text-blue-400">{step.step}</span>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{step.title}</h3>
                  <p className="text-sm text-slate-500 px-4">{step.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== PARTNERS ===== */}
        <section className="py-20 border-t border-slate-800 bg-[#030a1a]">
          <div className="max-w-[1400px] mx-auto px-4">
            <div className="text-center mb-10 text-xs font-mono text-slate-500 uppercase tracking-widest">
              {landingT("partners.eyebrow")}
            </div>
            <div className="flex flex-wrap justify-center items-center gap-12 lg:gap-24 opacity-40">
              {partners.map((partner, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Building2 className="w-6 h-6 text-slate-400" />
                  <span className="text-lg font-bold text-slate-400">{partner.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>


        {/* ===== TESTIMONIALS (Data Driven) ===== */}
        {testimonials.length > 0 && (
          <section className="py-32 bg-[#020817] border-t border-slate-800" aria-labelledby="testimonials-heading">
            <div className="max-w-[1400px] mx-auto px-4">
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeIn}
                transition={{ duration: 0.5 }}
                className="text-center mb-20"
              >
                 <h2 id="testimonials-heading" className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">
                  {landingT("testimonials.sectionTitle")}
                </h2>
              </motion.div>

              <div className="grid md:grid-cols-3 gap-6">
                {testimonials.slice(0, 3).map((testimonial: any, index: number) => (
                  <motion.div
                    key={testimonial.id}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={fadeInScale}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                  >
                    <div className="h-full bg-slate-900 border border-slate-800 rounded p-8">
                      <Quote className="w-8 h-8 text-slate-700 mb-6" />
                      <p className="text-slate-400 mb-8 text-sm leading-relaxed">"{testimonial.content}"</p>
                      
                      <div className="flex items-center gap-4 pt-6 border-t border-slate-800">
                        <div className="w-10 h-10 bg-slate-800 rounded flex items-center justify-center font-bold text-slate-400">
                          {testimonial.authorName?.[0] || 'A'}
                        </div>
                        <div>
                          <div className="font-bold text-white text-sm">{testimonial.authorName}</div>
                          {testimonial.authorLocation && (
                            <div className="text-xs text-slate-500 font-mono mt-1">{testimonial.authorLocation}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ===== FAQ ===== */}
        <section id="faq" className="py-32 px-4 border-t border-slate-800 bg-[#030a1a]" aria-labelledby="faq-heading">
          <div className="max-w-3xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-16"
            >
              <h2 id="faq-heading" className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">
                {landingT("faqSection.sectionTitle")}
              </h2>
            </motion.div>

            <Accordion type="single" collapsible className="space-y-4">
              {displayFaqs.map((faq: any, index: number) => (
                <AccordionItem key={index} value={`item-${index}`} className="bg-slate-900 border border-slate-800 rounded px-6 data-[state=open]:border-blue-500/30 transition-colors">
                  <AccordionTrigger className="text-left font-bold text-white hover:text-blue-400 hover:no-underline py-6" data-testid={`faq-trigger-${index}`}>
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-400 pb-6 leading-relaxed">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ===== NEWSLETTER ===== */}
        <section className="py-32 relative border-t border-slate-800 bg-[#020817] overflow-hidden" aria-labelledby="newsletter-heading">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.05)_0%,transparent_70%)]" />
          <div className="max-w-xl mx-auto px-4 relative z-10 text-center">
            <Mail className="w-8 h-8 text-blue-500 mx-auto mb-6" />
            <h2 id="newsletter-heading" className="text-3xl font-bold text-white mb-4">
              {landingT("newsletter.title")}
            </h2>
            <p className="text-slate-400 mb-8 text-sm">
              {landingT("newsletter.subtitle")}
            </p>
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                if (newsletterEmail) newsletterMutation.mutate(newsletterEmail);
              }}
              className="flex flex-col sm:flex-row gap-3"
            >
              <Input
                type="email"
                placeholder={landingT("newsletter.placeholder")}
                value={newsletterEmail}
                onChange={(e) => setNewsletterEmail(e.target.value)}
                className="flex-1 bg-slate-900 border-slate-700 text-white placeholder:text-slate-600 h-12"
                required
                aria-label={landingT("newsletter.ariaEmail")}
                data-testid="input-newsletter-email"
              />
              <Button
                type="submit"
                disabled={newsletterMutation.isPending}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-12 px-8 rounded"
                data-testid="button-subscribe"
              >
                {newsletterMutation.isPending ? landingT("newsletter.processing") : landingT("newsletter.subscribe")}
              </Button>
            </form>
          </div>
        </section>

        {/* ===== CONTACT / CTA ===== */}
        <section id="contact" className="relative py-24 border-t border-slate-800 overflow-hidden" aria-labelledby="cta-heading">
          <SubduedSpaceBackground />
          <div className="relative z-10 max-w-[1400px] mx-auto px-4">
            <div className="text-center mb-10">
              <h2 id="cta-heading" className="text-3xl font-bold text-white mb-6">
                {landingT("contact.title")}
              </h2>
              <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                {landingT("contact.paragraph")}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row justify-center gap-4 mb-10">
              <Link href="/verify">
                <Button size="lg" className="w-full sm:w-auto h-14 px-8 bg-red-600 hover:bg-red-500 text-white font-bold uppercase tracking-wider text-sm rounded shadow-[0_0_15px_rgba(220,38,38,0.3)]" data-testid="button-urgent-report">
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  {landingT("contact.urgent")}
                </Button>
              </Link>
            </div>

            {complaintSubmitted ? (
              <div className="max-w-2xl mx-auto bg-slate-900 border border-slate-700 rounded-lg p-8 text-center" data-testid="complaint-success">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                  <Send className="w-5 h-5 text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">{landingT("contact.secureTitle")}</h3>
                <p className="text-slate-400">{landingT("contact.secureDesc")}</p>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto bg-slate-900 border border-slate-700 rounded-lg p-8">
                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-400" />
                  {landingT("contact.formHeading")}
                </h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    contactMutation.mutate(contactForm);
                  }}
                  className="space-y-4"
                >
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">{landingT("contact.labelName")}</label>
                      <Input
                        type="text"
                        value={contactForm.name}
                        onChange={(e) => setContactForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder={landingT("contact.placeholderName")}
                        required
                        className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                        data-testid="complaint-input-name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">{landingT("contact.labelEmail")}</label>
                      <Input
                        type="email"
                        value={contactForm.email}
                        onChange={(e) => setContactForm(prev => ({ ...prev, email: e.target.value }))}
                        placeholder={landingT("contact.placeholderEmail")}
                        required
                        className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                        data-testid="complaint-input-email"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">{landingT("contact.labelSubject")}</label>
                    <Input
                      type="text"
                      value={contactForm.subject}
                      onChange={(e) => setContactForm(prev => ({ ...prev, subject: e.target.value }))}
                      placeholder={landingT("contact.placeholderSubject")}
                      className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                      data-testid="complaint-input-subject"
                    />
                  </div>

                  <div className="grid sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">{landingT("contact.labelPlatform")}</label>
                      <Input
                        type="text"
                        value={contactForm.platform}
                        onChange={(e) => setContactForm(prev => ({ ...prev, platform: e.target.value }))}
                        placeholder={landingT("contact.placeholderPlatform")}
                        className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                        data-testid="complaint-input-platform"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">{landingT("contact.labelIncidentDate")}</label>
                      <Input
                        type="text"
                        value={contactForm.incidentDate}
                        onChange={(e) => setContactForm(prev => ({ ...prev, incidentDate: e.target.value }))}
                        placeholder={landingT("contact.placeholderIncidentDate")}
                        className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                        data-testid="complaint-input-incident-date"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">{landingT("contact.labelAmountLost")}</label>
                      <Input
                        type="text"
                        value={contactForm.amountLost}
                        onChange={(e) => setContactForm(prev => ({ ...prev, amountLost: e.target.value }))}
                        placeholder={landingT("contact.placeholderAmountLost")}
                        className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                        data-testid="complaint-input-amount-lost"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">{landingT("contact.labelDescription")}</label>
                    <Textarea
                      value={contactForm.message}
                      onChange={(e) => setContactForm(prev => ({ ...prev, message: e.target.value }))}
                      placeholder={landingT("contact.placeholderDescription")}
                      required
                      rows={5}
                      className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 resize-none"
                      data-testid="complaint-input-message"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      type="submit"
                      disabled={contactMutation.isPending}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold h-12"
                      data-testid="complaint-submit-button"
                    >
                      <Send className="w-4 h-4 mr-2" />
                      {contactMutation.isPending ? landingT("contact.submittingButton") : landingT("contact.submitButton")}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* ===== FOOTER ===== */}
      <footer className="relative border-t border-slate-800 py-16 px-4 overflow-hidden" role="contentinfo">
        <SubduedSpaceBackground />
        <div className="relative z-10 max-w-[1400px] mx-auto">
          <div className="grid md:grid-cols-4 gap-12 mb-16">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-slate-800 rounded border border-slate-700 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-slate-400" />
                </div>
                <div>
                  <span className="text-lg font-bold text-white tracking-widest">IBCCF</span>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest">{landingT("footer.brandSubtitle")}</p>
                </div>
              </div>
              <p className="text-slate-500 text-sm leading-relaxed max-w-md">
                {landingT("footer.brandDesc")}
              </p>
            </div>

            <div>
              <h4 className="font-bold text-white mb-6 uppercase tracking-widest text-xs">{landingT("footer.divisionsTitle")}</h4>
              <ul className="space-y-3 text-sm text-slate-500">
                <li><a href="#departments" className="hover:text-blue-400 transition-colors">{landingT("footer.divAml")}</a></li>
                <li><a href="#departments" className="hover:text-blue-400 transition-colors">{landingT("footer.divForensics")}</a></li>
                <li><a href="#departments" className="hover:text-blue-400 transition-colors">{landingT("footer.divRecovery")}</a></li>
                <li><Link href="/verify" className="hover:text-blue-400 transition-colors">{landingT("footer.divIntake")}</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-white mb-6 uppercase tracking-widest text-xs">{landingT("footer.commsTitle")}</h4>
              <ul className="space-y-3 text-sm text-slate-500">
                <li className="flex items-center gap-3">
                  <Mail className="w-4 h-4" />
                  intake@ibccf.org
                </li>
                <li className="flex items-center gap-3">
                  <Phone className="w-4 h-4" />
                  +1 (800) ENFORCE
                </li>
                <li className="flex items-center gap-3">
                  <Clock className="w-4 h-4" />
                  {landingT("footer.ops")}
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-slate-600 font-mono uppercase tracking-widest">
            <p>
              {landingT("footer.copyright", { year: new Date().getFullYear() })}
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 justify-center">
              <Link href="/privacy-policy" className="hover:text-slate-400 transition-colors">{landingT("footer.linkPrivacy")}</Link>
              <Link href="/terms-of-use" className="hover:text-slate-400 transition-colors">{landingT("footer.linkTerms")}</Link>
              <Link href="/legal-resources" className="hover:text-slate-400 transition-colors">{landingT("footer.linkJurisdiction")}</Link>
              <Link href="/legal-resources" className="hover:text-slate-400 transition-colors">{landingT("footer.linkLegal")}</Link>
              <Link href="/withdrawal-guide" className="hover:text-slate-400 transition-colors">{landingT("footer.linkWithdrawalGuide")}</Link>
              <BuildStampLine className="text-slate-600" />
            </div>
          </div>
        </div>
      </footer>

      <LiveActivityIndicator />
      <BackToTop />
      <CookieConsent />
    </div>
  );
}
