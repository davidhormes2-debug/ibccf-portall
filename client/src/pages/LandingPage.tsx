import { Link } from "wouter";
import { Shield, FileText, AlertTriangle, CheckCircle, Lock, ArrowRight, Search, MessageCircle, HelpCircle, ChevronRight, Phone, Mail, Clock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { motion } from "framer-motion";

import fraudPreventionImg from "@assets/stock_images/professional_busines_04dbc0cc.jpg";
import supportImg from "@assets/stock_images/customer_support_hel_5992ddae.jpg";
import verificationImg from "@assets/stock_images/digital_verification_c77d4aa6.jpg";
import caseManagementImg from "@assets/stock_images/document_filing_case_067f3224.jpg";

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
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

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 font-['Public_Sans',sans-serif]">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-[#004182] to-[#004AB3] rounded-lg flex items-center justify-center">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold text-[#004182] dark:text-blue-400 font-['Merriweather',serif]">IBCCF</span>
                <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">International Blockchain Community Complaints Forum</p>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-6">
              <Link href="/" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm" data-testid="link-home">Home</Link>
              <Link href="/verify" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm" data-testid="link-services">Services</Link>
              <Link href="/verify" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm" data-testid="link-about">About Us</Link>
              <Link href="/verify" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium text-sm" data-testid="link-contact">Contact</Link>
            </nav>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <Link href="/verify">
                <Button size="sm" className="bg-[#004182] hover:bg-[#003366] text-white" data-testid="button-login">
                  Access Portal
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section - Reception Welcome */}
      <section className="relative overflow-hidden">
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
              <Shield className="h-5 w-5 text-white" />
              <span className="text-sm font-medium text-white">Welcome to IBCCF</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white font-['Merriweather',serif] leading-tight mb-6">
              How Can We Help You Today?
            </h1>
            
            <p className="text-lg md:text-xl text-white/80 mb-4 max-w-3xl mx-auto">
              The International Blockchain Community Complaints Forum is your trusted partner for fraud prevention, platform verification, and blockchain security.
            </p>
            
            <p className="text-base text-white/60 mb-12 max-w-2xl mx-auto">
              Select a service below to get started with your request.
            </p>
          </motion.div>
        </div>

        {/* Wave decoration */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
            <path d="M0 120L60 105C120 90 240 60 360 52.5C480 45 600 60 720 67.5C840 75 960 75 1080 67.5C1200 60 1320 45 1380 37.5L1440 30V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0Z" className="fill-slate-50 dark:fill-slate-900"/>
          </svg>
        </div>
      </section>

      {/* Services Grid - Main Reception Area */}
      <section className="py-16 px-4 -mt-8 relative z-10">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeIn}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif] mb-4">
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
                          alt={service.title}
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                        <div className={`absolute inset-0 bg-gradient-to-r ${service.color} opacity-60`} />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                            <service.icon className="w-8 h-8 text-white" />
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
                          <ChevronRight className="w-5 h-5 ml-1 transition-transform group-hover:translate-x-2" />
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

      {/* Trust Features */}
      <section className="py-16 px-4 bg-white dark:bg-slate-800">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeIn}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif] mb-4">
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
                className="text-center p-6"
              >
                <div className="w-14 h-14 bg-gradient-to-br from-[#004182] to-[#004AB3] rounded-xl flex items-center justify-center mx-auto mb-4">
                  <feature.icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{feature.title}</h3>
                <p className="text-slate-600 dark:text-slate-400 text-sm">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Quick Actions Bar */}
      <section className="py-12 px-4 bg-gradient-to-r from-[#004182] to-[#004AB3]">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h3 className="text-2xl font-bold text-white font-['Merriweather',serif] mb-2">
                Need Immediate Assistance?
              </h3>
              <p className="text-white/80">
                Our team is ready to help you with urgent security concerns.
              </p>
            </div>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link href="/verify">
                <Button size="lg" className="bg-white text-[#004182] hover:bg-slate-100 font-semibold" data-testid="button-urgent-report">
                  <AlertTriangle className="w-5 h-5 mr-2" />
                  Urgent Report
                </Button>
              </Link>
              <Link href="/verify">
                <Button size="lg" variant="outline" className="border-white text-white hover:bg-white/10" data-testid="button-contact-support">
                  <Phone className="w-5 h-5 mr-2" />
                  Contact Support
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-[#004182] to-[#004AB3] rounded-lg flex items-center justify-center">
                  <Shield className="h-6 w-6 text-white" />
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
                <li><Link href="/verify" className="hover:text-white transition-colors">FAQs</Link></li>
                <li><Link href="/verify" className="hover:text-white transition-colors">Blog</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Contact</h4>
              <ul className="space-y-3 text-slate-400 text-sm">
                <li className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  <span>support@ibccf.org</span>
                </li>
                <li className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
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
              <Lock className="w-4 h-4" />
              <span>Secure & Encrypted</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
