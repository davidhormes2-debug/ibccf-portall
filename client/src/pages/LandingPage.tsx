import { Link, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Shield, FileText, AlertTriangle, CheckCircle, Lock, Search, MessageCircle, ChevronRight, Phone, Mail, Clock, Users, Menu, X, ChevronUp, Star, ShieldCheck, Award, Zap, Globe, ArrowRight, Quote, Send, Plus, Minus, TrendingUp, Eye, Bell, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

import fraudPreventionImg from "@assets/stock_images/professional_busines_04dbc0cc.jpg";
import supportImg from "@assets/stock_images/customer_support_hel_5992ddae.jpg";
import verificationImg from "@assets/stock_images/digital_verification_c77d4aa6.jpg";
import caseManagementImg from "@assets/stock_images/document_filing_case_067f3224.jpg";

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

const slideIn = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 }
};

const services = [
  {
    id: "report",
    title: "Report Suspicious Activity",
    description: "Document and report potential fraud, scams, or suspicious blockchain-related incidents for investigation.",
    icon: AlertTriangle,
    image: fraudPreventionImg,
    href: "/verify",
    color: "from-red-500 to-orange-500",
    bgColor: "bg-red-50 dark:bg-red-950/30"
  },
  {
    id: "verify",
    title: "Verify Platform",
    description: "Check if a cryptocurrency platform, exchange, or service is legitimate and registered with authorities.",
    icon: Search,
    image: verificationImg,
    href: "/verify",
    color: "from-blue-500 to-cyan-500",
    bgColor: "bg-blue-50 dark:bg-blue-950/30"
  },
  {
    id: "case-status",
    title: "Check Case Status",
    description: "Access your existing case dashboard using your unique verification code to track progress.",
    icon: FileText,
    image: caseManagementImg,
    href: "/verify",
    color: "from-green-500 to-emerald-500",
    bgColor: "bg-green-50 dark:bg-green-950/30"
  },
  {
    id: "support",
    title: "Get Support",
    description: "Connect with our support team for assistance with your case or general inquiries about our services.",
    icon: MessageCircle,
    image: supportImg,
    href: "/verify",
    color: "from-purple-500 to-pink-500",
    bgColor: "bg-purple-50 dark:bg-purple-950/30"
  }
];

const features = [
  { icon: Lock, title: "100% Confidential", description: "Your identity and information are fully protected" },
  { icon: Clock, title: "24/7 Available", description: "Submit reports and access your case anytime" },
  { icon: Users, title: "Expert Team", description: "Trained professionals handle every case" },
  { icon: CheckCircle, title: "Verified Process", description: "Industry-standard investigation procedures" }
];

const trustBadges = [
  { icon: ShieldCheck, label: "256-bit SSL Encrypted", color: "text-green-500" },
  { icon: Award, label: "Certified Secure", color: "text-blue-500" },
  { icon: Globe, label: "Global Coverage", color: "text-purple-500" },
  { icon: Zap, label: "Instant Response", color: "text-orange-500" }
];

const processSteps = [
  { step: 1, title: "Submit Report", description: "Fill out our secure form with details about the incident", icon: FileText },
  { step: 2, title: "Verification", description: "Our team reviews and verifies your submission", icon: Search },
  { step: 3, title: "Investigation", description: "Expert analysis of the reported activity", icon: Shield },
  { step: 4, title: "Resolution", description: "Receive updates and resolution of your case", icon: CheckCircle }
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
      setCount(Math.floor(progress * endValue));
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }, [isVisible, endValue, duration]);

  return { count, ref };
}

function StatCounter({ value, label, suffix = "" }: { value: number; label: string; suffix?: string }) {
  const { count, ref } = useAnimatedCounter(value, 2000);
  return (
    <div ref={ref} className="text-center">
      <div className="text-4xl md:text-5xl font-bold text-white mb-2">
        {count.toLocaleString()}{suffix}
      </div>
      <div className="text-white/70 text-sm">{label}</div>
    </div>
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
    critical: "bg-red-600",
    high: "bg-orange-500",
    medium: "bg-yellow-500",
    low: "bg-blue-500"
  };

  return (
    <div className="bg-slate-900 border-b border-slate-700 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <Bell className="w-4 h-4 text-red-400 animate-pulse" />
            <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">Alert</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 overflow-hidden"
            >
              <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${severityColors[currentAlert.severity] || 'bg-gray-500'}`}>
                {currentAlert.severity?.toUpperCase()}
              </span>
              <span className="text-white/80 text-sm truncate">{currentAlert.title}</span>
              {currentAlert.platformName && (
                <span className="text-white/50 text-xs">- {currentAlert.platformName}</span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function LiveActivityIndicator() {
  const [viewers, setViewers] = useState(Math.floor(Math.random() * 50) + 120);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setViewers(prev => prev + Math.floor(Math.random() * 5) - 2);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed bottom-24 left-4 z-40 hidden lg:block">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-3 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Eye className="w-4 h-4 text-green-500" />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          </div>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-green-600 dark:text-green-400">{viewers}</span> viewing now
          </span>
        </div>
      </div>
    </div>
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
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-50 w-12 h-12 bg-[#004182] hover:bg-[#003366] text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
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
      className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-700 p-4"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-white/80 text-center sm:text-left">
          We use cookies to enhance your experience. By continuing, you agree to our privacy policy.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" className="border-white/20 text-white hover:bg-white/10" onClick={() => setShow(false)}>
            Decline
          </Button>
          <Button size="sm" className="bg-[#004182] hover:bg-[#003366]" onClick={accept} data-testid="button-accept-cookies">
            Accept
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "" });
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  // Generate Key dialog state
  const [generateKeyOpen, setGenerateKeyOpen] = useState(false);
  const [keyStep, setKeyStep] = useState<'verify' | 'setPin'>('verify');
  const [accessCodeInput, setAccessCodeInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [confirmPinInput, setConfirmPinInput] = useState("");
  const [verifiedCaseId, setVerifiedCaseId] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSettingPin, setIsSettingPin] = useState(false);

  const handleVerifyAccessCode = async () => {
    if (!accessCodeInput.trim()) {
      toast({ title: "Error", description: "Please enter your access code", variant: "destructive" });
      return;
    }
    setIsVerifying(true);
    try {
      const res = await fetch('/api/cases/verify-access-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: accessCodeInput })
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Invalid Code", description: data.error || "The access code is not valid", variant: "destructive" });
        return;
      }
      if (data.hasPinSet) {
        toast({ title: "PIN Already Set", description: "You have already set your PIN. Please use it to login.", variant: "destructive" });
        setGenerateKeyOpen(false);
        setLocation('/verify');
        return;
      }
      setVerifiedCaseId(data.caseId);
      setKeyStep('setPin');
      toast({ title: "Verified", description: "Please set your 6-digit PIN" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to verify access code", variant: "destructive" });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSetPin = async () => {
    if (pinInput.length !== 6 || !/^\d{6}$/.test(pinInput)) {
      toast({ title: "Error", description: "PIN must be exactly 6 digits", variant: "destructive" });
      return;
    }
    if (pinInput !== confirmPinInput) {
      toast({ title: "Error", description: "PINs do not match", variant: "destructive" });
      return;
    }
    setIsSettingPin(true);
    try {
      const res = await fetch('/api/cases/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: accessCodeInput, pin: pinInput })
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Failed to set PIN", variant: "destructive" });
        return;
      }
      toast({ title: "Success", description: "Your 6-digit PIN has been set! Use it to login." });
      setGenerateKeyOpen(false);
      resetGenerateKeyDialog();
      setLocation('/verify');
    } catch (error) {
      toast({ title: "Error", description: "Failed to set PIN", variant: "destructive" });
    } finally {
      setIsSettingPin(false);
    }
  };

  const resetGenerateKeyDialog = () => {
    setKeyStep('verify');
    setAccessCodeInput("");
    setPinInput("");
    setConfirmPinInput("");
    setVerifiedCaseId("");
  };

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
    { key: 'cases_resolved', label: 'Cases Resolved', value: '15847', suffix: '+' },
    { key: 'response_time', label: 'Avg Response Time', value: '24', suffix: 'h' },
    { key: 'recovery_rate', label: 'Recovery Rate', value: '89', suffix: '%' },
    { key: 'countries', label: 'Countries Served', value: '120', suffix: '+' }
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 font-['Public_Sans',sans-serif]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-[#004182] focus:text-white focus:px-4 focus:py-2 focus:rounded">
        Skip to main content
      </a>
      
      <ScamAlertsTicker />

      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-50" role="banner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-[#004182] to-[#004AB3] rounded-lg flex items-center justify-center">
                <Shield className="h-6 w-6 text-white" aria-hidden="true" />
              </div>
              <div>
                <span className="text-xl font-bold text-[#004182] dark:text-blue-400 font-['Merriweather',serif]">IBCCF</span>
                <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">International Blockchain Community Complaints Forum</p>
              </div>
            </div>
            
            <nav className="hidden md:flex items-center gap-6" role="navigation" aria-label="Main navigation">
              <Link href="/" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm" data-testid="link-home">Home</Link>
              <a href="#services" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm" data-testid="link-services">Services</a>
              <a href="#how-it-works" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm" data-testid="link-how-it-works">How It Works</a>
              <Link href="/community" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm" data-testid="link-community">Community</Link>
              <a href="#faq" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm" data-testid="link-faq">FAQ</a>
              <a href="#contact" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm" data-testid="link-contact">Contact</a>
            </nav>
            
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <Link href="/verify">
                <Button size="sm" className="bg-[#004182] hover:bg-[#003366] text-white hidden sm:inline-flex" data-testid="button-login">
                  Access Portal
                </Button>
              </Link>
              <button
                className="md:hidden p-2 text-slate-600 dark:text-slate-300"
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

        {/* Mobile Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700"
            >
              <nav className="px-4 py-4 space-y-3" role="navigation" aria-label="Mobile navigation">
                <Link href="/" className="block text-slate-700 dark:text-slate-200 hover:text-[#004182] font-medium py-2" onClick={() => setMobileMenuOpen(false)}>Home</Link>
                <a href="#services" className="block text-slate-700 dark:text-slate-200 hover:text-[#004182] font-medium py-2" onClick={() => setMobileMenuOpen(false)}>Services</a>
                <a href="#how-it-works" className="block text-slate-700 dark:text-slate-200 hover:text-[#004182] font-medium py-2" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
                <Link href="/community" className="block text-slate-700 dark:text-slate-200 hover:text-[#004182] font-medium py-2" onClick={() => setMobileMenuOpen(false)}>Community</Link>
                <a href="#faq" className="block text-slate-700 dark:text-slate-200 hover:text-[#004182] font-medium py-2" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
                <a href="#contact" className="block text-slate-700 dark:text-slate-200 hover:text-[#004182] font-medium py-2" onClick={() => setMobileMenuOpen(false)}>Contact</a>
                <Link href="/verify" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full bg-[#004182] hover:bg-[#003366] text-white mt-2">Access Portal</Button>
                </Link>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main id="main-content" role="main">
        {/* Hero Section */}
        <section className="relative overflow-hidden" aria-labelledby="hero-heading">
          <div className="absolute inset-0 bg-gradient-to-br from-[#004182] via-[#003366] to-[#002244]" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%23ffffff%22%20fill-opacity%3D%220.03%22%3E%3Cpath%20d%3D%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E')] opacity-50" />
          
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
            <motion.div 
              initial="hidden"
              animate="visible"
              variants={fadeIn}
              transition={{ duration: 0.6 }}
              className="text-center"
            >
              <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-5 py-2.5 mb-8">
                <Shield className="h-5 w-5 text-white" aria-hidden="true" />
                <span className="text-sm font-medium text-white">Welcome to IBCCF</span>
              </div>
              
              <h1 id="hero-heading" className="text-4xl md:text-5xl lg:text-6xl font-bold text-white font-['Merriweather',serif] leading-tight mb-6">
                How Can We Help You Today?
              </h1>
              
              <p className="text-lg md:text-xl text-white/80 mb-4 max-w-3xl mx-auto">
                The International Blockchain Community Complaints Forum is your trusted partner for fraud prevention, platform verification, and blockchain security.
              </p>
              
              <p className="text-base text-white/60 mb-12 max-w-2xl mx-auto">
                Select a service below to get started with your request.
              </p>

              {/* Action Buttons */}
              <div className="flex flex-wrap justify-center gap-4 mb-8">
                <Link href="/request-access">
                  <Button 
                    size="lg" 
                    className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-semibold px-8 py-3 shadow-lg"
                    data-testid="button-generate-key"
                  >
                    <Key className="w-5 h-5 mr-2" />
                    Generate Key
                  </Button>
                </Link>
                <Link href="/verify">
                  <Button 
                    size="lg" 
                    variant="outline"
                    className="bg-white/10 border-white/30 text-white hover:bg-white/20 font-semibold px-8 py-3"
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
                    className="bg-white/10 border-white/30 text-white hover:bg-white/20 font-semibold px-8 py-3"
                    data-testid="button-community-hero"
                  >
                    <Users className="w-5 h-5 mr-2" />
                    Community Forum
                  </Button>
                </Link>
              </div>

              {/* Trust Badges */}
              <div className="flex flex-wrap justify-center gap-6 mb-8">
                {trustBadges.map((badge) => (
                  <div key={badge.label} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2">
                    <badge.icon className={`w-4 h-4 ${badge.color}`} aria-hidden="true" />
                    <span className="text-xs font-medium text-white">{badge.label}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          <div className="absolute bottom-0 left-0 right-0">
            <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" aria-hidden="true">
              <path d="M0 120L60 105C120 90 240 60 360 52.5C480 45 600 60 720 67.5C840 75 960 75 1080 67.5C1200 60 1320 45 1380 37.5L1440 30V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0Z" className="fill-slate-50 dark:fill-slate-900"/>
            </svg>
          </div>
        </section>

        {/* Statistics Section */}
        <section className="py-12 px-4 bg-gradient-to-r from-[#004182] to-[#004AB3] -mt-1" aria-labelledby="stats-heading">
          <div className="max-w-7xl mx-auto">
            <h2 id="stats-heading" className="sr-only">Our Statistics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {displayStats.map((stat: any) => {
                const numericValue = parseInt(stat.value) || 0;
                const suffix = stat.suffix || stat.value.toString().replace(/[\d,]/g, '').trim() || "";
                return (
                  <StatCounter
                    key={`${stat.key}-${numericValue}`}
                    value={numericValue}
                    label={stat.label}
                    suffix={suffix}
                  />
                );
              })}
            </div>
          </div>
        </section>

        {/* Services Grid */}
        <section id="services" className="py-16 px-4 relative z-10 scroll-mt-20" aria-labelledby="services-heading">
          <div className="max-w-7xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-12"
            >
              <h2 id="services-heading" className="text-3xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif] mb-4">
                Our Services
              </h2>
              <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
                Choose from our range of services designed to protect you and the blockchain community.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
              {services.map((service, index) => (
                <motion.div
                  key={service.id}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={fadeIn}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  <Link href={service.href}>
                    <Card 
                      className={`group overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border-0 ${service.bgColor}`}
                      data-testid={`service-card-${service.id}`}
                    >
                      <div className="flex flex-col md:flex-row">
                        <div className="md:w-2/5 h-48 md:h-auto relative overflow-hidden">
                          <img 
                            src={service.image} 
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            loading="lazy"
                          />
                          <div className={`absolute inset-0 bg-gradient-to-r ${service.color} opacity-60`} />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                              <service.icon className="w-8 h-8 text-white" aria-hidden="true" />
                            </div>
                          </div>
                        </div>
                        <CardContent className="md:w-3/5 p-6 flex flex-col justify-center">
                          <h3 className="text-xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif] mb-3 group-hover:text-[#004182] dark:group-hover:text-blue-400 transition-colors">
                            {service.title}
                          </h3>
                          <p className="text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
                            {service.description}
                          </p>
                          <div className="flex items-center text-[#004182] dark:text-blue-400 font-medium">
                            <span>Get Started</span>
                            <ChevronRight className="w-5 h-5 ml-1 transition-transform group-hover:translate-x-2" aria-hidden="true" />
                          </div>
                        </CardContent>
                      </div>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-16 px-4 bg-white dark:bg-slate-800 scroll-mt-20" aria-labelledby="process-heading">
          <div className="max-w-7xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-12"
            >
              <h2 id="process-heading" className="text-3xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif] mb-4">
                How It Works
              </h2>
              <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
                Our simple 4-step process ensures your case is handled efficiently and professionally.
              </p>
            </motion.div>

            <div className="relative">
              <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-[#004182] to-[#004AB3] transform -translate-y-1/2" aria-hidden="true" />
              
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                {processSteps.map((step, index) => (
                  <motion.div
                    key={step.step}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={slideIn}
                    transition={{ duration: 0.5, delay: index * 0.15 }}
                    className="relative"
                  >
                    <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-6 text-center relative z-10">
                      <div className="w-16 h-16 bg-gradient-to-br from-[#004182] to-[#004AB3] rounded-full flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold">
                        {step.step}
                      </div>
                      <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{step.title}</h3>
                      <p className="text-slate-600 dark:text-slate-400 text-sm">{step.description}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Trust Features */}
        <section className="py-16 px-4" aria-labelledby="features-heading">
          <div className="max-w-7xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-12"
            >
              <h2 id="features-heading" className="text-3xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif] mb-4">
                Why Choose IBCCF?
              </h2>
              <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
                Trusted by thousands of users worldwide for blockchain security and fraud prevention.
              </p>
            </motion.div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={fadeIn}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="text-center p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm"
                >
                  <div className="w-14 h-14 bg-gradient-to-br from-[#004182] to-[#004AB3] rounded-xl flex items-center justify-center mx-auto mb-4">
                    <feature.icon className="w-7 h-7 text-white" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{feature.title}</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm">{feature.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        {testimonials.length > 0 && (
          <section className="py-16 px-4 bg-slate-100 dark:bg-slate-800/50" aria-labelledby="testimonials-heading">
            <div className="max-w-7xl mx-auto">
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeIn}
                transition={{ duration: 0.5 }}
                className="text-center mb-12"
              >
                <h2 id="testimonials-heading" className="text-3xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif] mb-4">
                  What Our Users Say
                </h2>
                <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
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
                    variants={fadeIn}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                  >
                    <Card className="h-full bg-white dark:bg-slate-800 border-0 shadow-lg">
                      <CardContent className="p-6">
                        <Quote className="w-8 h-8 text-[#004182]/20 mb-4" aria-hidden="true" />
                        <p className="text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
                          "{testimonial.content}"
                        </p>
                        <div className="flex items-center gap-1 mb-3">
                          {[...Array(parseInt(testimonial.rating) || 5)].map((_, i) => (
                            <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" aria-hidden="true" />
                          ))}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#004182] to-[#004AB3] flex items-center justify-center text-white font-bold">
                            {testimonial.authorName?.[0] || 'A'}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-800 dark:text-white text-sm">{testimonial.authorName}</p>
                            {testimonial.authorLocation && (
                              <p className="text-slate-500 dark:text-slate-400 text-xs">{testimonial.authorLocation}</p>
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

        {/* FAQ Section */}
        <section id="faq" className="py-16 px-4 scroll-mt-20" aria-labelledby="faq-heading">
          <div className="max-w-3xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-12"
            >
              <h2 id="faq-heading" className="text-3xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif] mb-4">
                Frequently Asked Questions
              </h2>
              <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
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
                  <AccordionItem value={`item-${index}`} className="bg-white dark:bg-slate-800 rounded-lg border-0 shadow-sm px-6">
                    <AccordionTrigger className="text-left font-semibold text-slate-800 dark:text-white hover:no-underline py-4" data-testid={`faq-trigger-${index}`}>
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-slate-600 dark:text-slate-300 pb-4">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                </motion.div>
              ))}
            </Accordion>
          </div>
        </section>

        {/* Newsletter Section */}
        <section className="py-16 px-4 bg-gradient-to-r from-[#004182] to-[#004AB3]" aria-labelledby="newsletter-heading">
          <div className="max-w-3xl mx-auto text-center">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
            >
              <Mail className="w-12 h-12 text-white/80 mx-auto mb-4" aria-hidden="true" />
              <h2 id="newsletter-heading" className="text-2xl md:text-3xl font-bold text-white font-['Merriweather',serif] mb-4">
                Stay Informed About Fraud Alerts
              </h2>
              <p className="text-white/80 mb-8">
                Subscribe to receive important security updates and fraud prevention tips.
              </p>
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newsletterEmail) newsletterMutation.mutate(newsletterEmail);
                }}
                className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
              >
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={newsletterEmail}
                  onChange={(e) => setNewsletterEmail(e.target.value)}
                  className="flex-1 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white"
                  required
                  aria-label="Email address for newsletter"
                  data-testid="input-newsletter-email"
                />
                <Button
                  type="submit"
                  disabled={newsletterMutation.isPending}
                  className="bg-white text-[#004182] hover:bg-slate-100 font-semibold"
                  data-testid="button-subscribe"
                >
                  {newsletterMutation.isPending ? "Subscribing..." : "Subscribe"}
                </Button>
              </form>
            </motion.div>
          </div>
        </section>

        {/* Quick Actions Bar */}
        <section className="py-12 px-4 bg-white dark:bg-slate-800" aria-labelledby="cta-heading">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-center md:text-left">
                <h2 id="cta-heading" className="text-2xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif] mb-2">
                  Need Immediate Assistance?
                </h2>
                <p className="text-slate-600 dark:text-slate-300">
                  Our team is ready to help you with urgent security concerns.
                </p>
              </div>
              <div className="flex flex-wrap gap-4 justify-center">
                <Link href="/verify">
                  <Button size="lg" className="bg-[#004182] hover:bg-[#003366] text-white font-semibold" data-testid="button-urgent-report">
                    <AlertTriangle className="w-5 h-5 mr-2" aria-hidden="true" />
                    Urgent Report
                  </Button>
                </Link>
                <a href="#contact">
                  <Button size="lg" variant="outline" className="border-[#004182] text-[#004182] hover:bg-[#004182]/10" data-testid="button-contact-support">
                    <Phone className="w-5 h-5 mr-2" aria-hidden="true" />
                    Contact Support
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Form */}
        <section id="contact" className="py-16 px-4 bg-slate-50 dark:bg-slate-900 scroll-mt-20" aria-labelledby="contact-heading">
          <div className="max-w-3xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-center mb-12"
            >
              <h2 id="contact-heading" className="text-3xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif] mb-4">
                Contact Us
              </h2>
              <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
                Have questions? Send us a message and we'll get back to you promptly.
              </p>
            </motion.div>

            <Card className="bg-white dark:bg-slate-800 border-0 shadow-xl">
              <CardContent className="p-8">
                <form onSubmit={(e) => {
                  e.preventDefault();
                  contactMutation.mutate(contactForm);
                }} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label htmlFor="contact-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Name</label>
                      <Input
                        id="contact-name"
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                        placeholder="Your name"
                        required
                        data-testid="input-contact-name"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Email</label>
                      <Input
                        id="contact-email"
                        type="email"
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                        placeholder="your@email.com"
                        required
                        data-testid="input-contact-email"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="contact-subject" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Subject</label>
                    <Input
                      id="contact-subject"
                      value={contactForm.subject}
                      onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                      placeholder="What is this about?"
                      data-testid="input-contact-subject"
                    />
                  </div>
                  <div>
                    <label htmlFor="contact-message" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Message</label>
                    <Textarea
                      id="contact-message"
                      value={contactForm.message}
                      onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                      placeholder="Tell us how we can help..."
                      rows={5}
                      required
                      data-testid="input-contact-message"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={contactMutation.isPending}
                    className="w-full bg-[#004182] hover:bg-[#003366] text-white font-semibold"
                    data-testid="button-send-message"
                  >
                    {contactMutation.isPending ? "Sending..." : (
                      <>
                        <Send className="w-4 h-4 mr-2" aria-hidden="true" />
                        Send Message
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12 px-4" role="contentinfo">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-[#004182] to-[#004AB3] rounded-lg flex items-center justify-center">
                  <Shield className="h-6 w-6 text-white" aria-hidden="true" />
                </div>
                <span className="text-xl font-bold font-['Merriweather',serif]">IBCCF</span>
              </div>
              <p className="text-slate-400 text-sm">
                Protecting the blockchain community through education, verification, and swift action against fraud.
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Services</h4>
              <ul className="space-y-2 text-slate-400 text-sm">
                <li><Link href="/verify" className="hover:text-white transition-colors">Report Fraud</Link></li>
                <li><Link href="/verify" className="hover:text-white transition-colors">Verify Platform</Link></li>
                <li><Link href="/verify" className="hover:text-white transition-colors">Case Management</Link></li>
                <li><Link href="/verify" className="hover:text-white transition-colors">Support</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Resources</h4>
              <ul className="space-y-2 text-slate-400 text-sm">
                <li><Link href="/verify" className="hover:text-white transition-colors">Help Center</Link></li>
                <li><Link href="/verify" className="hover:text-white transition-colors">Safety Guide</Link></li>
                <li><a href="#faq" className="hover:text-white transition-colors">FAQs</a></li>
                <li><Link href="/verify" className="hover:text-white transition-colors">Blog</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Contact</h4>
              <ul className="space-y-3 text-slate-400 text-sm">
                <li className="flex items-center gap-2">
                  <Mail className="w-4 h-4" aria-hidden="true" />
                  <span>support@ibccf.org</span>
                </li>
                <li className="flex items-center gap-2">
                  <Clock className="w-4 h-4" aria-hidden="true" />
                  <span>24/7 Support Available</span>
                </li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-slate-500 text-sm">
              © 2025 International Blockchain Community Complaints Forum. All rights reserved.
            </p>
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Lock className="w-4 h-4" aria-hidden="true" />
              <span>Secure & Encrypted</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Fixed Elements */}
      <LiveActivityIndicator />
      <BackToTop />
      <CookieConsent />

      {/* Generate Key Dialog */}
      <Dialog open={generateKeyOpen} onOpenChange={(open) => { setGenerateKeyOpen(open); if (!open) resetGenerateKeyDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#004182]">
              <Key className="w-5 h-5" />
              {keyStep === 'verify' ? 'Generate Your Key' : 'Set Your PIN'}
            </DialogTitle>
            <DialogDescription>
              {keyStep === 'verify' 
                ? 'Enter the access code provided by admin to verify your account.' 
                : 'Create a 6-digit PIN that you will use to login in the future.'}
            </DialogDescription>
          </DialogHeader>
          
          {keyStep === 'verify' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Access Code
                </label>
                <Input
                  type="text"
                  value={accessCodeInput}
                  onChange={(e) => setAccessCodeInput(e.target.value)}
                  placeholder="Enter your access code"
                  className="text-center text-lg tracking-widest font-mono"
                  maxLength={10}
                  data-testid="input-access-code-verify"
                />
              </div>
              <Button 
                onClick={handleVerifyAccessCode} 
                disabled={isVerifying}
                className="w-full bg-[#004182] hover:bg-[#003366]"
                data-testid="button-verify-access-code"
              >
                {isVerifying ? 'Verifying...' : 'Verify Code'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Create 6-Digit PIN
                </label>
                <Input
                  type="password"
                  inputMode="numeric"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit PIN"
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                  maxLength={6}
                  data-testid="input-pin"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Confirm PIN
                </label>
                <Input
                  type="password"
                  inputMode="numeric"
                  value={confirmPinInput}
                  onChange={(e) => setConfirmPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Confirm 6-digit PIN"
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                  maxLength={6}
                  data-testid="input-pin-confirm"
                />
              </div>
              <p className="text-xs text-slate-500 text-center">
                This PIN will be your permanent login credential. Keep it safe!
              </p>
              <Button 
                onClick={handleSetPin} 
                disabled={isSettingPin || pinInput.length !== 6}
                className="w-full bg-emerald-500 hover:bg-emerald-600"
                data-testid="button-set-pin"
              >
                {isSettingPin ? 'Setting PIN...' : 'Set My PIN'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
