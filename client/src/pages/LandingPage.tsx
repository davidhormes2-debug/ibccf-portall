import { Link, useLocation } from "wouter";
import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Shield, FileText, AlertTriangle, CheckCircle, Lock, Search, MessageCircle, 
  ChevronRight, Phone, Mail, Clock, Users, Menu, X, ChevronUp, Star, ShieldCheck, 
  Award, Zap, Globe, ArrowRight, Quote, Send, Plus, Minus, TrendingUp, Eye, Bell, 
  Key, Sparkles, ArrowUpRight, Play, BadgeCheck, HeartHandshake, Scale, Fingerprint,
  Building2, Trophy, Target, Rocket
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

const features = [
  { icon: Lock, title: "Bank-Grade Security", description: "256-bit encryption protects your sensitive data", gradient: "from-blue-600 to-cyan-500" },
  { icon: Clock, title: "24/7 Availability", description: "Submit reports and access your case anytime", gradient: "from-purple-600 to-pink-500" },
  { icon: Users, title: "Expert Analysts", description: "Certified professionals handle every case", gradient: "from-emerald-600 to-teal-500" },
  { icon: BadgeCheck, title: "Verified Process", description: "Industry-standard investigation procedures", gradient: "from-orange-600 to-amber-500" }
];

const trustMetrics = [
  { icon: Shield, value: "99.9%", label: "Security Rating", description: "Enterprise-grade protection" },
  { icon: Trophy, value: "50K+", label: "Cases Resolved", description: "Successfully closed investigations" },
  { icon: Globe, value: "180+", label: "Countries", description: "Worldwide coverage" },
  { icon: Clock, value: "<2h", label: "Response Time", description: "Average first response" }
];

const processSteps = [
  { step: 1, title: "Submit Your Report", description: "Fill out our secure encrypted form with all relevant incident details", icon: FileText, color: "from-blue-500 to-blue-600" },
  { step: 2, title: "Expert Verification", description: "Our certified team reviews and validates your submission", icon: Search, color: "from-purple-500 to-purple-600" },
  { step: 3, title: "Investigation", description: "Comprehensive analysis using advanced fraud detection tools", icon: Shield, color: "from-emerald-500 to-emerald-600" },
  { step: 4, title: "Resolution & Recovery", description: "Receive detailed updates and resolution of your case", icon: CheckCircle, color: "from-amber-500 to-amber-600" }
];

const defaultFaqs = [
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

function ParticlesBackground() {
  const particles = useMemo(() => 
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      delay: Math.random() * 10,
      duration: 15 + Math.random() * 10,
      size: 4 + Math.random() * 4
    })), []
  );

  return (
    <div className="particles-bg">
      {particles.map((p) => (
        <div
          key={p.id}
          className="particle"
          style={{
            left: p.left,
            bottom: '-10px',
            width: p.size,
            height: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`
          }}
        />
      ))}
    </div>
  );
}

function FloatingOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
    </div>
  );
}

function StatCounter({ value, label, suffix = "", icon: Icon }: { value: number; label: string; suffix?: string; icon?: any }) {
  const { count, ref } = useAnimatedCounter(value, 2500);
  return (
    <motion.div 
      ref={ref} 
      className="text-center group"
      whileHover={{ scale: 1.05 }}
      transition={{ type: "spring", stiffness: 300 }}
    >
      <div className="relative inline-block mb-3">
        {Icon && (
          <div className="absolute -top-2 -right-2 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
            <Icon className="w-4 h-4 text-white" />
          </div>
        )}
        <div className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-1 tracking-tight">
          {count.toLocaleString()}{suffix}
        </div>
      </div>
      <div className="text-white/70 text-sm font-medium uppercase tracking-wider">{label}</div>
    </motion.div>
  );
}

function ScamAlertsTicker() {
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
    <div className="bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Bell className="w-4 h-4 text-red-400" />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping" />
            </div>
            <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Live Alert</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-3 overflow-hidden"
            >
              <span className={`px-2.5 py-1 rounded-full text-xs font-bold text-white ${severityColors[currentAlert.severity] || 'bg-gray-600'}`}>
                {currentAlert.severity?.toUpperCase()}
              </span>
              <span className="text-white/90 text-sm font-medium truncate">{currentAlert.title}</span>
              {currentAlert.platformName && (
                <span className="text-white/50 text-xs font-medium">• {currentAlert.platformName}</span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function LiveActivityIndicator() {
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
      <div className="glass-card rounded-xl p-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center">
              <Eye className="w-5 h-5 text-white" />
            </div>
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full animate-pulse border-2 border-white" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-800 dark:text-white">{viewers}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Active now</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function BackToTop() {
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
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-br from-[#004182] to-[#0066cc] hover:from-[#003366] hover:to-[#004182] text-white rounded-full shadow-2xl flex items-center justify-center transition-all btn-premium"
          aria-label="Back to top"
          data-testid="button-back-to-top"
        >
          <ChevronUp className="w-6 h-6" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function CookieConsent() {
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
      className="fixed bottom-0 left-0 right-0 z-50 glass-dark p-4"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-white/80 text-center sm:text-left">
          We use cookies to enhance your experience and ensure security. By continuing, you agree to our privacy policy.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" className="border-white/20 text-white hover:bg-white/10" onClick={() => setShow(false)}>
            Decline
          </Button>
          <Button size="sm" className="bg-white text-[#004182] hover:bg-slate-100 font-semibold" onClick={accept} data-testid="button-accept-cookies">
            Accept
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function PremiumServiceCard({ service, index }: { service: typeof services[0]; index: number }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
      variants={fadeIn}
      transition={{ duration: 0.5, delay: index * 0.1 }}
    >
      <Link href={service.href}>
        <Card 
          className="group relative overflow-hidden cursor-pointer card-premium border-0 bg-white dark:bg-slate-800 h-full"
          data-testid={`service-card-${service.id}`}
        >
          <div className={`absolute inset-0 ${service.bgGlow} opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-3xl`} />
          <div className="relative">
            <div className="h-48 relative overflow-hidden">
              <img 
                src={service.image} 
                alt=""
                className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
                loading="lazy"
              />
              <div className={`absolute inset-0 bg-gradient-to-br ${service.gradient} opacity-70 group-hover:opacity-80 transition-opacity`} />
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.div 
                  whileHover={{ scale: 1.1, rotate: 5 }}
                  className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/30 shadow-2xl"
                >
                  <service.icon className="w-10 h-10 text-white" aria-hidden="true" />
                </motion.div>
              </div>
            </div>
            <CardContent className="p-6 relative">
              <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-3 group-hover:text-[#004182] dark:group-hover:text-blue-400 transition-colors">
                {service.title}
              </h3>
              <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed mb-4">
                {service.description}
              </p>
              <div className="flex items-center text-[#004182] dark:text-blue-400 font-semibold text-sm">
                <span>Get Started</span>
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-2" aria-hidden="true" />
              </div>
            </CardContent>
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "" });
  const { toast } = useToast();
  const [, setLocation] = useLocation();
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
      toast({ title: "Subscribed!", description: "You've been added to our newsletter." });
      setNewsletterEmail("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const contactMutation = useMutation({
    mutationFn: async (data: typeof contactForm) => {
      const res = await fetch('/api/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Message Sent!", description: "We'll get back to you soon." });
      setContactForm({ name: "", email: "", subject: "", message: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const displayFaqs = faqs.length > 0 ? faqs : defaultFaqs;
  const displayStats = stats.length > 0 ? stats : [
    { key: 'cases_resolved', label: 'Cases Resolved', value: '50000', suffix: '+' },
    { key: 'response_time', label: 'Avg Response', value: '2', suffix: 'h' },
    { key: 'recovery_rate', label: 'Success Rate', value: '94', suffix: '%' },
    { key: 'countries', label: 'Countries', value: '180', suffix: '+' }
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-[#004182] focus:text-white focus:px-4 focus:py-2 focus:rounded">
        Skip to main content
      </a>
      
      <ScamAlertsTicker />

      <motion.header 
        style={{ opacity: headerOpacity }}
        className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-700/50 sticky top-0 z-50 shadow-sm" 
        role="banner"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-18 py-3">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#004182] to-[#0066cc] rounded-xl blur-lg opacity-50 group-hover:opacity-75 transition-opacity" />
                <div className="relative w-12 h-12 bg-gradient-to-br from-[#004182] to-[#004AB3] rounded-xl flex items-center justify-center shadow-lg">
                  <Shield className="h-7 w-7 text-white" aria-hidden="true" />
                </div>
              </div>
              <div>
                <span className="text-xl font-bold text-[#004182] dark:text-blue-400 tracking-tight">IBCCF</span>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 hidden sm:block font-medium tracking-wide">International Blockchain Complaints Forum</p>
              </div>
            </Link>
            
            <nav className="hidden lg:flex items-center gap-8" role="navigation" aria-label="Main navigation">
              {[
                { href: "/", label: "Home" },
                { href: "#services", label: "Services" },
                { href: "#how-it-works", label: "How It Works" },
                { href: "/community", label: "Community", isLink: true },
                { href: "#faq", label: "FAQ" },
                { href: "#contact", label: "Contact" }
              ].map((item) => (
                item.isLink ? (
                  <Link key={item.label} href={item.href} className="text-slate-600 dark:text-slate-300 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm transition-colors relative group" data-testid={`link-${item.label.toLowerCase()}`}>
                    {item.label}
                    <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[#004182] group-hover:w-full transition-all duration-300" />
                  </Link>
                ) : (
                  <a key={item.label} href={item.href} className="text-slate-600 dark:text-slate-300 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm transition-colors relative group" data-testid={`link-${item.label.toLowerCase().replace(' ', '-')}`}>
                    {item.label}
                    <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[#004182] group-hover:w-full transition-all duration-300" />
                  </a>
                )
              ))}
            </nav>
            
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <Link href="/verify">
                <Button size="sm" className="bg-gradient-to-r from-[#004182] to-[#0066cc] hover:from-[#003366] hover:to-[#004182] text-white hidden sm:inline-flex font-semibold btn-premium" data-testid="button-login">
                  <Lock className="w-4 h-4 mr-2" />
                  Access Portal
                </Button>
              </Link>
              <button
                className="lg:hidden p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle mobile menu"
                aria-expanded={mobileMenuOpen}
                data-testid="button-mobile-menu"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700"
            >
              <nav className="px-4 py-4 space-y-2" role="navigation" aria-label="Mobile navigation">
                {["Home", "Services", "How It Works", "Community", "FAQ", "Contact"].map((item) => (
                  item === "Community" ? (
                    <Link key={item} href="/community" className="block text-slate-700 dark:text-slate-200 hover:text-[#004182] hover:bg-slate-50 dark:hover:bg-slate-700 font-medium py-3 px-4 rounded-lg transition-colors" onClick={() => setMobileMenuOpen(false)}>{item}</Link>
                  ) : (
                    <a key={item} href={item === "Home" ? "/" : `#${item.toLowerCase().replace(' ', '-')}`} className="block text-slate-700 dark:text-slate-200 hover:text-[#004182] hover:bg-slate-50 dark:hover:bg-slate-700 font-medium py-3 px-4 rounded-lg transition-colors" onClick={() => setMobileMenuOpen(false)}>{item}</a>
                  )
                ))}
                <Link href="/verify" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full bg-gradient-to-r from-[#004182] to-[#0066cc] hover:from-[#003366] hover:to-[#004182] text-white mt-4 font-semibold">
                    <Lock className="w-4 h-4 mr-2" />
                    Access Portal
                  </Button>
                </Link>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>

      <main id="main-content" role="main">
        <section className="relative overflow-hidden min-h-[90vh] flex items-center" aria-labelledby="hero-heading">
          <div className="absolute inset-0 hero-gradient" />
          <div className="absolute inset-0 mesh-gradient opacity-50" />
          <ParticlesBackground />
          <FloatingOrbs />
          
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28 w-full">
            <motion.div 
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
              className="text-center"
            >
              <motion.div variants={fadeIn} className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5 mb-8">
                <Sparkles className="h-5 w-5 text-amber-400" aria-hidden="true" />
                <span className="text-sm font-semibold text-white">World's Leading Blockchain Security Platform</span>
              </motion.div>
              
              <motion.h1 
                variants={fadeIn}
                id="hero-heading" 
                className="text-4xl md:text-5xl lg:text-7xl font-extrabold text-white leading-tight mb-6 tracking-tight"
              >
                Protect Your Digital Assets<br />
                <span className="bg-gradient-to-r from-cyan-400 via-blue-300 to-purple-400 bg-clip-text text-transparent">
                  With Expert Recovery
                </span>
              </motion.h1>
              
              <motion.p 
                variants={fadeIn}
                className="text-lg md:text-xl text-white/90 mb-4 max-w-3xl mx-auto leading-relaxed font-semibold"
              >
                IBCCF provides enterprise-grade fraud prevention, platform verification, and comprehensive 
                case management for blockchain security incidents worldwide.
              </motion.p>
              
              <motion.p 
                variants={fadeIn}
                className="text-base text-white/80 mb-10 max-w-2xl mx-auto font-medium"
              >
                Trusted by 50,000+ users across 180 countries with a 94% success rate
              </motion.p>

              <motion.div variants={fadeIn} className="flex flex-wrap justify-center gap-4 mb-12">
                <Link href="/request-access">
                  <Button 
                    size="lg" 
                    className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold px-8 py-6 text-lg shadow-2xl shadow-emerald-500/30 btn-premium"
                    data-testid="button-generate-key"
                  >
                    <Key className="w-5 h-5 mr-2" />
                    Generate Key
                    <ArrowUpRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Link href="/verify">
                  <Button 
                    size="lg" 
                    variant="outline"
                    className="glass border-white/30 text-white hover:bg-white/20 font-bold px-8 py-6 text-lg"
                    data-testid="button-access-portal-hero"
                  >
                    <Lock className="w-5 h-5 mr-2" />
                    Access Portal
                  </Button>
                </Link>
                <Link href="/community">
                  <Button 
                    size="lg" 
                    variant="outline"
                    className="glass border-white/30 text-white hover:bg-white/20 font-bold px-8 py-6 text-lg"
                    data-testid="button-community-hero"
                  >
                    <Users className="w-5 h-5 mr-2" />
                    Community
                  </Button>
                </Link>
              </motion.div>

              <motion.div variants={fadeIn} className="flex flex-wrap justify-center gap-4">
                {[
                  { icon: ShieldCheck, label: "256-bit SSL" },
                  { icon: Award, label: "Certified Secure" },
                  { icon: Globe, label: "Global Coverage" },
                  { icon: Zap, label: "Instant Response" }
                ].map((badge) => (
                  <div key={badge.label} className="trust-badge flex items-center gap-2 rounded-full px-4 py-2">
                    <badge.icon className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                    <span className="text-xs font-semibold text-white">{badge.label}</span>
                  </div>
                ))}
              </motion.div>
            </motion.div>
          </div>

          <div className="absolute bottom-0 left-0 right-0">
            <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" aria-hidden="true" preserveAspectRatio="none">
              <path d="M0 120L60 105C120 90 240 60 360 52.5C480 45 600 60 720 67.5C840 75 960 75 1080 67.5C1200 60 1320 45 1380 37.5L1440 30V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0Z" className="fill-slate-50 dark:fill-slate-900"/>
            </svg>
          </div>
        </section>

        <section className="py-16 px-4 bg-gradient-to-r from-[#004182] via-[#003366] to-[#004182] -mt-1 relative overflow-hidden" aria-labelledby="stats-heading">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%23ffffff%22%20fill-opacity%3D%220.03%22%3E%3Cpath%20d%3D%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E')] opacity-50" />
          <div className="max-w-7xl mx-auto relative">
            <h2 id="stats-heading" className="sr-only">Our Statistics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12">
              {displayStats.map((stat: any, idx: number) => {
                const numericValue = parseInt(stat.value) || 0;
                const suffix = stat.suffix || stat.value.toString().replace(/[\d,]/g, '').trim() || "";
                const icons = [Trophy, Clock, Target, Globe];
                return (
                  <StatCounter
                    key={`${stat.key}-${numericValue}`}
                    value={numericValue}
                    label={stat.label}
                    suffix={suffix}
                    icon={icons[idx % icons.length]}
                  />
                );
              })}
            </div>
          </div>
        </section>

        <section id="services" className="py-20 lg:py-28 px-4 relative scroll-mt-20" aria-labelledby="services-heading">
          <div className="max-w-7xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-16"
            >
              <div className="inline-flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 rounded-full px-4 py-2 mb-6">
                <Rocket className="w-4 h-4 text-[#004182]" />
                <span className="text-sm font-semibold text-[#004182] dark:text-blue-400">Our Services</span>
              </div>
              <h2 id="services-heading" className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 dark:text-white mb-6 tracking-tight">
                Comprehensive Protection<br />
                <span className="gradient-text">For Your Digital Assets</span>
              </h2>
              <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto text-lg">
                Choose from our range of enterprise-grade services designed to protect you and the blockchain community.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
              {services.map((service, index) => (
                <PremiumServiceCard key={service.id} service={service} index={index} />
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="py-20 lg:py-28 px-4 bg-white dark:bg-slate-800 scroll-mt-20 relative overflow-hidden" aria-labelledby="process-heading">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-purple-50/50 dark:from-slate-800 dark:to-slate-800" />
          <div className="max-w-7xl mx-auto relative">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-16"
            >
              <div className="inline-flex items-center gap-2 bg-purple-50 dark:bg-purple-900/30 rounded-full px-4 py-2 mb-6">
                <Target className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">Simple Process</span>
              </div>
              <h2 id="process-heading" className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 dark:text-white mb-6 tracking-tight">
                How It Works
              </h2>
              <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto text-lg">
                Our streamlined 4-step process ensures your case is handled with maximum efficiency and professionalism.
              </p>
            </motion.div>

            <div className="relative">
              <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 transform -translate-y-1/2 rounded-full opacity-30" aria-hidden="true" />
              
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                {processSteps.map((step, index) => (
                  <motion.div
                    key={step.step}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={fadeInScale}
                    transition={{ duration: 0.5, delay: index * 0.15 }}
                    className="relative"
                  >
                    <div className="glass-card rounded-2xl p-8 text-center relative z-10 h-full">
                      <motion.div 
                        whileHover={{ scale: 1.1, rotate: 5 }}
                        className={`w-20 h-20 bg-gradient-to-br ${step.color} rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl`}
                      >
                        <span className="text-3xl font-bold text-white">{step.step}</span>
                      </motion.div>
                      <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-3">{step.title}</h3>
                      <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{step.description}</p>
                    </div>
                    {index < processSteps.length - 1 && (
                      <div className="hidden lg:block absolute top-1/2 -right-4 transform -translate-y-1/2 z-20">
                        <ChevronRight className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 lg:py-28 px-4" aria-labelledby="features-heading">
          <div className="max-w-7xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-16"
            >
              <div className="inline-flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-full px-4 py-2 mb-6">
                <Shield className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Why Choose Us</span>
              </div>
              <h2 id="features-heading" className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 dark:text-white mb-6 tracking-tight">
                Trusted by Thousands<br />
                <span className="gradient-text">Worldwide</span>
              </h2>
              <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto text-lg">
                Industry-leading security standards and expert support for your peace of mind.
              </p>
            </motion.div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={fadeInScale}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="text-center"
                >
                  <Card className="h-full glass-card border-0 card-premium">
                    <CardContent className="p-8">
                      <motion.div 
                        whileHover={{ scale: 1.1, rotate: -5 }}
                        className={`w-16 h-16 bg-gradient-to-br ${feature.gradient} rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl`}
                      >
                        <feature.icon className="w-8 h-8 text-white" aria-hidden="true" />
                      </motion.div>
                      <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-3">{feature.title}</h3>
                      <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{feature.description}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {testimonials.length > 0 && (
          <section className="py-20 lg:py-28 px-4 bg-slate-100 dark:bg-slate-800/50" aria-labelledby="testimonials-heading">
            <div className="max-w-7xl mx-auto">
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeIn}
                transition={{ duration: 0.5 }}
                className="text-center mb-16"
              >
                <div className="inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-900/30 rounded-full px-4 py-2 mb-6">
                  <HeartHandshake className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">Testimonials</span>
                </div>
                <h2 id="testimonials-heading" className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 dark:text-white mb-6 tracking-tight">
                  What Our Users Say
                </h2>
                <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto text-lg">
                  Real stories from people we've helped protect.
                </p>
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
                    <Card className="h-full glass-card border-0 card-premium">
                      <CardContent className="p-8">
                        <Quote className="w-10 h-10 text-[#004182]/20 mb-6" aria-hidden="true" />
                        <p className="text-slate-600 dark:text-slate-300 mb-6 leading-relaxed text-lg italic">
                          "{testimonial.content}"
                        </p>
                        <div className="flex items-center gap-1 mb-4">
                          {[...Array(parseInt(testimonial.rating) || 5)].map((_, i) => (
                            <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" aria-hidden="true" />
                          ))}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#004182] to-[#0066cc] flex items-center justify-center text-white font-bold text-lg shadow-lg">
                            {testimonial.authorName?.[0] || 'A'}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 dark:text-white">{testimonial.authorName}</p>
                            {testimonial.authorLocation && (
                              <p className="text-slate-500 dark:text-slate-400 text-sm">{testimonial.authorLocation}</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section id="faq" className="py-20 lg:py-28 px-4 scroll-mt-20" aria-labelledby="faq-heading">
          <div className="max-w-3xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-16"
            >
              <div className="inline-flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 rounded-full px-4 py-2 mb-6">
                <MessageCircle className="w-4 h-4 text-[#004182]" />
                <span className="text-sm font-semibold text-[#004182] dark:text-blue-400">FAQ</span>
              </div>
              <h2 id="faq-heading" className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 dark:text-white mb-6 tracking-tight">
                Frequently Asked Questions
              </h2>
              <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto text-lg">
                Find answers to common questions about our services.
              </p>
            </motion.div>

            <Accordion type="single" collapsible className="space-y-4">
              {displayFaqs.map((faq: any, index: number) => (
                <motion.div
                  key={index}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={fadeIn}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                >
                  <AccordionItem value={`item-${index}`} className="glass-card rounded-xl border-0 px-6 overflow-hidden">
                    <AccordionTrigger className="text-left font-semibold text-slate-800 dark:text-white hover:no-underline py-5 text-lg" data-testid={`faq-trigger-${index}`}>
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-slate-600 dark:text-slate-300 pb-5 text-base leading-relaxed">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                </motion.div>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="py-20 px-4 hero-gradient relative overflow-hidden" aria-labelledby="newsletter-heading">
          <ParticlesBackground />
          <div className="max-w-3xl mx-auto text-center relative">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
            >
              <div className="w-20 h-20 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-8 backdrop-blur-sm">
                <Mail className="w-10 h-10 text-white" aria-hidden="true" />
              </div>
              <h2 id="newsletter-heading" className="text-3xl md:text-4xl font-extrabold text-white mb-4 tracking-tight">
                Stay Ahead of Fraud
              </h2>
              <p className="text-white/90 mb-8 text-lg font-semibold">
                Subscribe to receive important security updates and fraud prevention tips.
              </p>
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newsletterEmail) newsletterMutation.mutate(newsletterEmail);
                }}
                className="flex flex-col sm:flex-row gap-4 max-w-lg mx-auto"
              >
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={newsletterEmail}
                  onChange={(e) => setNewsletterEmail(e.target.value)}
                  className="flex-1 glass border-white/20 text-white placeholder:text-white/50 focus:border-white h-14 text-lg px-6"
                  required
                  aria-label="Email address for newsletter"
                  data-testid="input-newsletter-email"
                />
                <Button
                  type="submit"
                  disabled={newsletterMutation.isPending}
                  className="bg-white text-[#004182] hover:bg-slate-100 font-bold h-14 px-8 text-lg btn-premium"
                  data-testid="button-subscribe"
                >
                  {newsletterMutation.isPending ? "Subscribing..." : "Subscribe"}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </form>
            </motion.div>
          </div>
        </section>

        <section id="contact" className="py-20 lg:py-28 px-4 bg-white dark:bg-slate-800 scroll-mt-20" aria-labelledby="cta-heading">
          <div className="max-w-7xl mx-auto">
            <div className="glass-card rounded-3xl p-8 lg:p-12 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-800 dark:to-slate-700">
              <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
                <div className="text-center lg:text-left">
                  <h2 id="cta-heading" className="text-3xl md:text-4xl font-bold text-slate-800 dark:text-white mb-4 tracking-tight">
                    Need Immediate Assistance?
                  </h2>
                  <p className="text-slate-600 dark:text-slate-300 text-lg max-w-xl">
                    Our expert team is available 24/7 to help you with urgent security concerns and fraud reports.
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 justify-center">
                  <Link href="/verify">
                    <Button size="lg" className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold px-8 py-6 text-lg btn-premium" data-testid="button-urgent-report">
                      <AlertTriangle className="w-5 h-5 mr-2" aria-hidden="true" />
                      Urgent Report
                    </Button>
                  </Link>
                  <Button size="lg" variant="outline" className="border-2 border-[#004182] text-[#004182] hover:bg-[#004182] hover:text-white font-bold px-8 py-6 text-lg transition-all" onClick={() => setContactForm({ ...contactForm })} data-testid="button-contact-support">
                    <Phone className="w-5 h-5 mr-2" aria-hidden="true" />
                    Contact Support
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-slate-900 text-white py-16 px-4" role="contentinfo">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-gradient-to-br from-[#004182] to-[#0066cc] rounded-xl flex items-center justify-center shadow-lg">
                  <Shield className="h-7 w-7 text-white" />
                </div>
                <div>
                  <span className="text-xl font-bold">IBCCF</span>
                  <p className="text-xs text-slate-400">International Blockchain Complaints Forum</p>
                </div>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed max-w-md mb-6">
                The world's leading platform for blockchain fraud prevention, platform verification, and comprehensive case management. Protecting digital assets since 2019.
              </p>
              <div className="flex gap-4">
                {[ShieldCheck, Award, Globe, Zap].map((Icon, i) => (
                  <div key={i} className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
                    <Icon className="w-5 h-5 text-slate-400" />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-bold text-lg mb-6">Quick Links</h4>
              <ul className="space-y-3 text-sm">
                <li><Link href="/" className="text-slate-400 hover:text-white transition-colors">Home</Link></li>
                <li><a href="#services" className="text-slate-400 hover:text-white transition-colors">Services</a></li>
                <li><a href="#how-it-works" className="text-slate-400 hover:text-white transition-colors">How It Works</a></li>
                <li><Link href="/community" className="text-slate-400 hover:text-white transition-colors">Community</Link></li>
                <li><a href="#faq" className="text-slate-400 hover:text-white transition-colors">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-lg mb-6">Contact</h4>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-3 text-slate-400">
                  <Mail className="w-4 h-4" />
                  support@ibccf.org
                </li>
                <li className="flex items-center gap-3 text-slate-400">
                  <Phone className="w-4 h-4" />
                  +1 (800) IBCCF-HELP
                </li>
                <li className="flex items-center gap-3 text-slate-400">
                  <Clock className="w-4 h-4" />
                  24/7 Support Available
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-slate-500 text-sm">
              &copy; {new Date().getFullYear()} IBCCF. All rights reserved.
            </p>
            <div className="flex gap-6 text-sm">
              <a href="#" className="text-slate-400 hover:text-white transition-colors">Privacy Policy</a>
              <a href="#" className="text-slate-400 hover:text-white transition-colors">Terms of Service</a>
              <a href="#" className="text-slate-400 hover:text-white transition-colors">Cookie Policy</a>
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
