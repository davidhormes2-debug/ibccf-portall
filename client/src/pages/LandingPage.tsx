import { Link } from "wouter";
import { Shield, FileText, AlertTriangle, CheckCircle, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-900 font-['Public_Sans',sans-serif]">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-[#004182] dark:text-blue-400" />
              <span className="text-xl font-bold text-[#004182] dark:text-blue-400 font-['Merriweather',serif]">IBCCF</span>
            </div>
            <nav className="hidden md:flex items-center gap-8">
              <Link href="/" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium" data-testid="link-home">Home</Link>
              <Link href="/verify" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium" data-testid="link-file-complaint">File Complaint</Link>
              <Link href="/verify" className="text-slate-700 dark:text-slate-200 hover:text-[#004182] dark:hover:text-blue-400 font-medium" data-testid="link-safety-guide">Case Status</Link>
            </nav>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <Lock className="h-4 w-4" />
                <span className="hidden sm:inline">Secure & Anonymous</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-[#004182] to-[#002d5a] text-white py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 mb-8">
            <Shield className="h-4 w-4" />
            <span className="text-sm font-medium">Official Complaint Documentation Assistant</span>
          </div>
          
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold font-['Merriweather',serif] leading-tight mb-6">
            Report Suspicious Activity & Verify Platforms Safely
          </h1>
          
          <p className="text-lg md:text-xl text-white/80 mb-10 max-w-2xl mx-auto">
            Believe you've been contacted by a fake agent? We help you document the incident, understand the risks, and find the right next steps without judgment.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/verify">
              <Button size="lg" className="bg-[#004AB3] hover:bg-[#003d99] text-white font-semibold px-8 py-6 text-lg shadow-lg" data-testid="button-start-report">
                Start New Report <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/verify">
              <Button size="lg" variant="outline" className="bg-white text-[#0F1729] border-[#0F1729] hover:bg-slate-100 font-semibold px-8 py-6 text-lg" data-testid="button-verify-platform">
                Verify a Platform
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* 3-Step Process */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white rounded-lg p-8 shadow-sm border border-slate-200" data-testid="card-step-1">
              <div className="w-12 h-12 bg-[#004182]/10 rounded-lg flex items-center justify-center mb-6">
                <FileText className="h-6 w-6 text-[#004182]" />
              </div>
              <h3 className="text-xl font-bold text-[#0F172B] font-['Merriweather',serif] mb-4">1. Document Details</h3>
              <p className="text-slate-600 leading-relaxed">
                Record key information about how you were contacted, what information was exchanged, and any suspicious patterns.
              </p>
            </div>
            
            <div className="bg-white rounded-lg p-8 shadow-sm border border-slate-200" data-testid="card-step-2">
              <div className="w-12 h-12 bg-[#004182]/10 rounded-lg flex items-center justify-center mb-6">
                <AlertTriangle className="h-6 w-6 text-[#004182]" />
              </div>
              <h3 className="text-xl font-bold text-[#0F172B] font-['Merriweather',serif] mb-4">2. Assess Risks</h3>
              <p className="text-slate-600 leading-relaxed">
                Identify red flags such as unusual requests for payments or impersonation tactics used by potential fraudsters.
              </p>
            </div>
            
            <div className="bg-white rounded-lg p-8 shadow-sm border border-slate-200" data-testid="card-step-3">
              <div className="w-12 h-12 bg-[#004182]/10 rounded-lg flex items-center justify-center mb-6">
                <CheckCircle className="h-6 w-6 text-[#004182]" />
              </div>
              <h3 className="text-xl font-bold text-[#0F172B] font-['Merriweather',serif] mb-4">3. Get Actionable Steps</h3>
              <p className="text-slate-600 leading-relaxed">
                Receive tailored guidance on how to report to official authorities and protect yourself from further harm.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Privacy Section */}
      <section className="bg-[#002d5a] text-white py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold font-['Merriweather',serif] mb-6">
            Your Privacy comes First
          </h2>
          <p className="text-lg text-white/80 max-w-2xl mx-auto">
            We never ask for passwords, full credit card numbers, or sensitive government IDs. This tool is designed to help you organize your claim safely.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0F172B] text-white py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Shield className="h-6 w-6" />
                <span className="text-xl font-bold font-['Merriweather',serif]">IBCCF</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                The International Blockchain Community Complaints Forum helps users document suspicious activity and provides neutral, safety-focused guidance.
              </p>
            </div>
            
            <div>
              <h4 className="font-bold mb-4">Resources</h4>
              <ul className="space-y-3 text-slate-400">
                <li><Link href="/verify" className="hover:text-white transition-colors">Fraud Prevention</Link></li>
                <li><Link href="/verify" className="hover:text-white transition-colors">Verify a Platform</Link></li>
                <li><Link href="/verify" className="hover:text-white transition-colors">Consumer Rights</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold mb-4">Disclaimer</h4>
              <p className="text-slate-400 text-sm leading-relaxed">
                We do not provide legal advice or recover funds. We assist in documenting incidents and directing you to official channels.
              </p>
            </div>
          </div>
          
          <div className="border-t border-slate-800 mt-12 pt-8 text-center text-slate-500 text-sm">
            © 2025 IBCCF. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
