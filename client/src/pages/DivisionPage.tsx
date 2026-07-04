import { useParams, Link } from "wouter";
import { motion } from "framer-motion";
import {
  ShieldCheck, Network, Database, Scale, Activity, HeartHandshake,
  ArrowLeft, Mail, Phone, Clock, CheckCircle, ChevronRight,
  FileSearch, AlertTriangle, Globe, Landmark, Search, Users,
  Lock, TrendingUp, FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";

import { ThemeToggle } from "@/components/ThemeToggle";
import { BuildStampLine } from "@/components/BuildStampLine";
import { useTranslation } from "react-i18next";

interface DivisionData {
  id: string;
  title: string;
  subtitle: string;
  tagline: string;
  overview: string;
  image: string;
  color: string;
  accentColor: string;
  icon: React.ElementType;
  functions: { title: string; description: string; icon: React.ElementType }[];
  caseTypes: string[];
  process: { step: string; description: string }[];
  contact: {
    email: string;
    phone?: string;
    responseTime: string;
    hours: string;
  };
  badge: string;
}

const divisions: Record<string, DivisionData> = {
  aml: {
    id: "aml",
    title: "AML Division",
    subtitle: "Anti-Money Laundering",
    badge: "FATF · FinCEN · AMLD6",
    tagline: "Stopping illicit funds before they enter the financial system.",
    overview:
      "The AML Division is the frontline defense against money laundering operations targeting cryptocurrency and traditional financial infrastructure. Our team of certified AML specialists conducts in-depth transaction monitoring, builds suspicious activity profiles, and coordinates with global financial intelligence units to trace and report illicit fund flows in real time.",
    image: "/images/dept-aml.png",
    color: "from-blue-600 to-cyan-500",
    accentColor: "blue",
    icon: ShieldCheck,
    functions: [
      {
        title: "Transaction Monitoring",
        description:
          "Automated and manual review of high-volume blockchain transactions, flagging unusual patterns, structuring behaviors, and layering techniques used to obscure illicit origins.",
        icon: TrendingUp,
      },
      {
        title: "Suspicious Activity Reports (SAR)",
        description:
          "Filing and coordinating SARs with FinCEN, FCA, and other financial authorities when transactions meet the threshold for potential money laundering activity.",
        icon: FileText,
      },
      {
        title: "Know Your Customer (KYC) Auditing",
        description:
          "Reviewing onboarding processes at exchanges and custodians to identify KYC gaps that may allow bad actors to access the financial system undetected.",
        icon: Search,
      },
      {
        title: "OFAC & Sanctions Screening",
        description:
          "Cross-referencing wallet addresses and counterparties against OFAC SDN lists, EU sanctions databases, and INTERPOL's financial crime registries.",
        icon: Globe,
      },
      {
        title: "Typology Research",
        description:
          "Ongoing study and cataloging of emerging money laundering typologies in crypto, including NFT wash trading, DeFi exploit laundering, and mixer obfuscation techniques.",
        icon: FileSearch,
      },
    ],
    caseTypes: [
      "Cryptocurrency structuring and layering",
      "Exchange-facilitated laundering",
      "Mixer and tumbler fund obfuscation",
      "NFT and DeFi-based laundering",
      "Cross-border illicit fund transfers",
      "Shell company crypto transactions",
    ],
    process: [
      { step: "Submit Your Report", description: "Provide transaction IDs, wallet addresses, and any supporting evidence through our secure intake portal." },
      { step: "Initial Triage (24–48 hrs)", description: "An AML analyst reviews the submission, verifies transaction data on-chain, and assesses urgency level." },
      { step: "Investigation & SAR Filing", description: "Where thresholds are met, formal SARs are filed with the relevant financial intelligence units." },
      { step: "Coordination & Outcome", description: "You receive a case reference and regular updates as the investigation progresses through regulatory channels." },
    ],
    contact: {
      email: "aml@ibccf.org",
      responseTime: "24–48 hours",
      hours: "Monday–Friday, 08:00–18:00 UTC",
    },
  },

  cyber: {
    id: "cyber",
    title: "Cybercrime & Digital Forensics",
    subtitle: "Blockchain Trace Analysis",
    badge: "INTERPOL · Europol · CISA",
    tagline: "Following every byte — from blockchain to dark web and beyond.",
    overview:
      "The Cybercrime & Digital Forensics Division leverages cutting-edge blockchain analytics and open-source intelligence to trace fraudulent cryptocurrency flows, identify perpetrators operating on the dark web, and build evidentiary packages for law enforcement prosecution. Our forensic analysts are certified in leading blockchain tracing tools and collaborate directly with global cybercrime task forces.",
    image: "/images/dept-cyber.png",
    color: "from-purple-600 to-indigo-500",
    accentColor: "purple",
    icon: Network,
    functions: [
      {
        title: "Blockchain Forensics",
        description:
          "Full on-chain analysis of suspect wallets, tracing fund flows across multiple hops, bridges, and chains to identify ultimate beneficial ownership and cash-out points.",
        icon: Search,
      },
      {
        title: "Dark Web Intelligence",
        description:
          "Monitoring underground marketplaces, forums, and Telegram channels where crypto fraud schemes are advertised, sold, and coordinated.",
        icon: Globe,
      },
      {
        title: "Crypto-Tracing & Asset Mapping",
        description:
          "Building comprehensive asset maps showing exactly where stolen funds moved — across wallets, exchanges, mixers, and off-ramps — in a format suitable for court use.",
        icon: Network,
      },
      {
        title: "Exchange Cooperation & Subpoenas",
        description:
          "Coordinating with regulated exchanges to freeze suspect accounts and obtain KYC records through lawful process requests and mutual legal assistance treaties.",
        icon: Landmark,
      },
      {
        title: "Malware & Phishing Analysis",
        description:
          "Technical reverse-engineering of malware used in crypto theft campaigns and identification of phishing infrastructure to enable takedowns.",
        icon: AlertTriangle,
      },
    ],
    caseTypes: [
      "Crypto exchange hacks and theft",
      "Phishing and social engineering scams",
      "Ransomware payment tracing",
      "DeFi protocol exploits",
      "SIM-swap account takeover",
      "Investment fraud and rug pulls",
    ],
    process: [
      { step: "Evidence Submission", description: "Provide all wallet addresses, transaction hashes, communications, and any known details about the perpetrator." },
      { step: "Forensic Analysis (48–72 hrs)", description: "Our analysts run full on-chain traces and cross-reference against known fraud clusters and dark web activity." },
      { step: "Intelligence Package", description: "A forensic report is compiled detailing fund flows, likely perpetrators, and off-ramp exchanges." },
      { step: "Law Enforcement Referral", description: "Where sufficient evidence exists, the package is referred to Interpol, Europol, or national cybercrime units." },
    ],
    contact: {
      email: "cyber.forensics@ibccf.org",
      responseTime: "24–72 hours",
      hours: "24/7 for emergency escalations",
    },
  },

  recovery: {
    id: "recovery",
    title: "Asset Recovery Unit",
    subtitle: "Cross-Border Enforcement",
    badge: "Interpol · MLA · Civil Litigation",
    tagline: "Pursuing stolen assets across borders until recovery is achieved.",
    overview:
      "The Asset Recovery Unit specializes in the legal and logistical process of locating, freezing, and repatriating assets stolen through crypto fraud. Working in partnership with attorneys, international law enforcement agencies, and regulatory bodies across jurisdictions, our team navigates the complex multi-national legal frameworks required to recover assets from sophisticated fraudsters.",
    image: "/images/dept-recovery.png",
    color: "from-amber-600 to-yellow-500",
    accentColor: "amber",
    icon: Database,
    functions: [
      {
        title: "Asset Freeze & Restraint Orders",
        description:
          "Coordinating with courts and enforcement agencies to issue emergency freezing orders against identified wallets, exchange accounts, and bank accounts before assets are dissipated.",
        icon: Lock,
      },
      {
        title: "Civil Litigation Support",
        description:
          "Preparing forensic evidence packages, expert witness testimony, and case documentation to support victims pursuing civil recovery through the courts.",
        icon: Landmark,
      },
      {
        title: "International Asset Tracing",
        description:
          "Following assets as they move across multiple jurisdictions, engaging local counsel and authorities in each country to prevent dissipation.",
        icon: Globe,
      },
      {
        title: "Mutual Legal Assistance Treaties (MLAT)",
        description:
          "Navigating MLAT requests to obtain evidence, freeze orders, and cooperation from foreign jurisdictions where suspects or assets are located.",
        icon: FileText,
      },
      {
        title: "Victim Restitution Coordination",
        description:
          "Managing the distribution of recovered assets back to verified victims in accordance with court orders and compliance requirements.",
        icon: Users,
      },
    ],
    caseTypes: [
      "Large-scale investment fraud recovery",
      "Exchange insolvency claims",
      "Ponzi and pyramid scheme victims",
      "Romance scam asset recovery",
      "Fraudulent broker restitution",
      "Multi-jurisdictional crypto theft",
    ],
    process: [
      { step: "Case Assessment (2–3 days)", description: "Our team evaluates the viability of asset recovery based on the amount lost, evidence quality, and jurisdictions involved." },
      { step: "Asset Tracing", description: "Full blockchain and financial intelligence is deployed to locate and document assets currently held by perpetrators." },
      { step: "Legal Action Coordination", description: "We coordinate with partner attorneys and enforcement agencies to initiate freezing orders and litigation." },
      { step: "Recovery & Restitution", description: "Recovered assets are marshaled and distributed to verified victims through court-supervised processes." },
    ],
    contact: {
      email: "recovery@ibccf.org",
      responseTime: "2–3 business days",
      hours: "Monday–Friday, 09:00–17:00 UTC",
    },
  },

  compliance: {
    id: "compliance",
    title: "Compliance & Regulatory Affairs",
    subtitle: "FATF Alignment",
    badge: "FATF · VASP · Basel AML Index",
    tagline: "Aligning the global crypto ecosystem with regulatory best practice.",
    overview:
      "The Compliance & Regulatory Affairs Division ensures that IBCCF operations, partner exchanges, and reporting entities adhere to the highest international regulatory standards. Our compliance officers maintain up-to-date expertise across FATF recommendations, EU AMLD frameworks, FinCEN guidance, and national VASP regulations — translating complex requirements into actionable compliance programs.",
    image: "/images/dept-compliance.png",
    color: "from-slate-600 to-slate-400",
    accentColor: "slate",
    icon: Scale,
    functions: [
      {
        title: "FATF Jurisdictional Reporting",
        description:
          "Preparing and submitting formal reports to FATF and affiliated financial intelligence units on behalf of reporting entities, ensuring deadlines and format requirements are met.",
        icon: FileText,
      },
      {
        title: "Legal Framework Mapping",
        description:
          "Continuously tracking regulatory changes across 40+ jurisdictions to provide timely guidance on how new laws affect VASP operations, user obligations, and reporting requirements.",
        icon: Globe,
      },
      {
        title: "Regulatory Gap Analysis",
        description:
          "Auditing existing compliance programs at exchanges and custodians to identify vulnerabilities, outdated procedures, and gaps that could expose them to regulatory sanctions.",
        icon: FileSearch,
      },
      {
        title: "VASP Oversight & Guidance",
        description:
          "Supporting Virtual Asset Service Providers with licensing requirements, travel rule implementation, and ongoing compliance monitoring in their operating jurisdictions.",
        icon: Landmark,
      },
      {
        title: "Regulatory Coordination",
        description:
          "Acting as a liaison between IBCCF, national competent authorities, and international regulatory bodies to facilitate information sharing and coordinated enforcement.",
        icon: Users,
      },
    ],
    caseTypes: [
      "VASP licensing and compliance support",
      "Travel Rule implementation guidance",
      "SAR/STR filing assistance",
      "Regulatory sanction defense",
      "AML program audit and remediation",
      "FATF mutual evaluation preparation",
    ],
    process: [
      { step: "Initial Consultation (1–2 days)", description: "Our compliance officers review your situation, jurisdiction, and applicable regulatory framework." },
      { step: "Gap Analysis", description: "A thorough audit of existing compliance procedures is conducted and documented." },
      { step: "Remediation Plan", description: "A structured remediation roadmap is provided with prioritized actions and implementation timelines." },
      { step: "Ongoing Monitoring", description: "Optional ongoing compliance monitoring service to keep programs current with evolving regulations." },
    ],
    contact: {
      email: "compliance@ibccf.org",
      responseTime: "1–2 business days",
      hours: "Monday–Friday, 08:00–18:00 UTC",
    },
  },

  intelligence: {
    id: "intelligence",
    title: "Intelligence & Threat Analysis",
    subtitle: "Threat Actor Profiling",
    badge: "OSINT · SIGINT · Threat Intel",
    tagline: "Mapping scam networks before they claim their next victim.",
    overview:
      "The Intelligence & Threat Analysis Division operates as IBCCF's early warning center — proactively identifying, mapping, and neutralizing emerging crypto fraud threats before they reach scale. Our intelligence analysts combine open-source intelligence, threat actor profiling, and dark web monitoring to build comprehensive pictures of criminal organizations operating in the crypto space.",
    image: "/images/dept-intel.png",
    color: "from-red-600 to-rose-500",
    accentColor: "red",
    icon: Activity,
    functions: [
      {
        title: "Scam Network Mapping",
        description:
          "Building relationship graphs of fraudulent entities — wallets, websites, social accounts, and individuals — that together form coordinated scam operations.",
        icon: Network,
      },
      {
        title: "Threat Actor Profiling",
        description:
          "Creating detailed profiles of known and suspected crypto fraud operators, including their techniques, infrastructure, target demographics, and operational patterns.",
        icon: Search,
      },
      {
        title: "Early Warning System",
        description:
          "Monitoring social media, forums, and dark web channels to detect new scam campaigns in their infancy and issue alerts before they spread widely.",
        icon: AlertTriangle,
      },
      {
        title: "Intelligence Sharing",
        description:
          "Distributing sanitized threat intelligence reports to partner law enforcement agencies, exchanges, and financial institutions to enable coordinated defensive action.",
        icon: Globe,
      },
      {
        title: "Predictive Threat Modeling",
        description:
          "Using historical data and pattern analysis to forecast where and how the next wave of crypto fraud is likely to emerge, enabling proactive countermeasures.",
        icon: TrendingUp,
      },
    ],
    caseTypes: [
      "Pig butchering scam campaigns",
      "Fake exchange infrastructure",
      "Impersonation and deepfake fraud",
      "Celebrity endorsement scams",
      "Coordinated pump-and-dump schemes",
      "Cross-border fraud syndicate operations",
    ],
    process: [
      { step: "Threat Report Submission", description: "Submit details of the suspected scam, including URLs, wallets, communications, and any other evidence." },
      { step: "OSINT Analysis (48–72 hrs)", description: "Our intelligence team investigates the threat using open and closed-source intelligence methods." },
      { step: "Threat Profile Creation", description: "A comprehensive threat profile is compiled and added to our threat intelligence database." },
      { step: "Alert & Referral", description: "Relevant alerts are issued to partner agencies and, where appropriate, public warnings are published." },
    ],
    contact: {
      email: "intel@ibccf.org",
      responseTime: "48–72 hours",
      hours: "24/7 monitoring with daytime analyst response",
    },
  },

  support: {
    id: "support",
    title: "Victim Support Services",
    subtitle: "Case Intake & Advocacy",
    badge: "Victim Advocacy · Counseling · Legal Aid",
    tagline: "Standing with victims from first contact to final resolution.",
    overview:
      "The Victim Support Services Division provides a compassionate, confidential, and structured support pathway for individuals who have suffered financial and psychological harm through crypto fraud. Our case advocates work one-on-one with victims to document their experience, connect them with appropriate investigative and legal resources, and provide ongoing emotional and practical support throughout the recovery process.",
    image: "/images/dept-support.png",
    color: "from-emerald-600 to-teal-500",
    accentColor: "emerald",
    icon: HeartHandshake,
    functions: [
      {
        title: "Secure Case Intake",
        description:
          "Confidential, encrypted intake process that collects all relevant information about the fraud, the victim's circumstances, and any existing documentation or evidence.",
        icon: Lock,
      },
      {
        title: "Victim Advocacy",
        description:
          "Dedicated case advocates who represent the victim's interests throughout the investigation and legal process, ensuring their voice is heard and their rights are protected.",
        icon: Users,
      },
      {
        title: "Psychological Support Referrals",
        description:
          "Connections to vetted counselors and support groups specializing in the unique trauma of financial fraud — including the shame, isolation, and grief it often causes.",
        icon: HeartHandshake,
      },
      {
        title: "Legal Guidance & Referrals",
        description:
          "Guidance on victims' legal options, assistance preparing documentation for law enforcement complaints, and referrals to attorneys experienced in crypto fraud cases.",
        icon: Landmark,
      },
      {
        title: "Restitution Navigation",
        description:
          "Helping victims understand and navigate the restitution process, including filing victim impact statements and participating in asset recovery distributions.",
        icon: CheckCircle,
      },
    ],
    caseTypes: [
      "Romance scam victims",
      "Investment fraud survivors",
      "Elderly and vulnerable victim support",
      "Identity theft recovery assistance",
      "Family impact support",
      "Crisis intervention referrals",
    ],
    process: [
      { step: "Confidential Intake (Same Day)", description: "Contact us via the secure form or helpline. A case advocate will respond the same business day to begin your intake." },
      { step: "Case Assessment", description: "Your advocate reviews your situation and connects you with the appropriate investigative divisions and resources." },
      { step: "Ongoing Support", description: "Regular check-ins keep you informed of investigation progress while your advocate addresses any support needs that arise." },
      { step: "Resolution & Recovery", description: "Your advocate supports you through the final stages, including any legal proceedings, restitution, and post-case recovery planning." },
    ],
    contact: {
      email: "support@ibccf.org",
      phone: "+1-800-422-3427",
      responseTime: "Same business day",
      hours: "Monday–Friday, 08:00–20:00 UTC · Emergency line 24/7",
    },
  },
};

const accentClasses: Record<string, { text: string; border: string; bg: string; badge: string }> = {
  blue:    { text: "text-blue-400",    border: "border-blue-500/30",    bg: "bg-blue-500/10",    badge: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  purple:  { text: "text-purple-400",  border: "border-purple-500/30",  bg: "bg-purple-500/10",  badge: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  amber:   { text: "text-amber-400",   border: "border-amber-500/30",   bg: "bg-amber-500/10",   badge: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  slate:   { text: "text-slate-300",   border: "border-slate-500/30",   bg: "bg-slate-500/10",   badge: "bg-slate-500/20 text-slate-300 border-slate-500/30" },
  red:     { text: "text-red-400",     border: "border-red-500/30",     bg: "bg-red-500/10",     badge: "bg-red-500/20 text-red-300 border-red-500/30" },
  emerald: { text: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/10", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
};

export default function DivisionPage() {
  const { t } = useTranslation("division");
  const { id } = useParams<{ id: string }>();
  const division = id ? divisions[id] : null;
  const td = (suffix: string, fallback: string) =>
    division ? t(`divisions.${division.id}.${suffix}`, { defaultValue: fallback }) : fallback;

  if (!division) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-[#020817] flex flex-col items-center justify-center gap-6 text-white">
        <ShieldCheck className="w-16 h-16 text-slate-600" />
        <h1 className="text-2xl font-bold">{t("notFound.title")}</h1>
        <Link href="/#departments">
          <Button variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("notFound.back")}
          </Button>
        </Link>
      </main>
    );
  }

  const accent = accentClasses[division.accentColor] || accentClasses.blue;
  const Icon = division.icon;

  return (
    <div className="min-h-screen bg-[#020817] text-white">
      {/* Nav bar */}
      <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-[#020817]/90 backdrop-blur-xl">
        <div className="max-w-[1200px] mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <button className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">{t("back")} IBCCF</span>
              <span className="sm:hidden">{t("back")}</span>
            </button>
          </Link>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-mono uppercase tracking-widest ${accent.text}`}>{td("subtitle", division.subtitle)}</span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img src={division.image} alt={td("title", division.title)} className="w-full h-full object-cover opacity-20" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#020817]/60 via-[#020817]/80 to-[#020817]" />
          <div className={`absolute inset-0 bg-gradient-to-r from-[#020817] to-transparent`} />
        </div>
        <div className="max-w-[1200px] mx-auto px-4 py-24 sm:py-32 relative z-10">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="flex flex-wrap gap-2 mb-6">
              {division.badge.split(" · ").map(b => (
                <span key={b} className={`text-[11px] font-bold px-3 py-1 rounded-full border ${accent.badge}`}>{b}</span>
              ))}
            </div>
            <div className="flex items-center gap-4 mb-6">
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${division.color} flex items-center justify-center shadow-xl flex-shrink-0`}>
                <Icon className="w-7 h-7 text-white" />
              </div>
              <div>
                <p className={`text-xs font-mono uppercase tracking-widest ${accent.text} mb-1`}>{td("subtitle", division.subtitle)}</p>
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white">{td("title", division.title)}</h1>
              </div>
            </div>
            <p className={`text-xl sm:text-2xl font-medium ${accent.text} mb-6 max-w-2xl`}>{td("tagline", division.tagline)}</p>
            <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-3xl">{td("overview", division.overview)}</p>
          </motion.div>
        </div>
      </section>

      {/* Functions */}
      <section className="py-20 border-t border-slate-800/50">
        <div className="max-w-[1200px] mx-auto px-4">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="mb-12">
            <div className="flex items-center gap-3 mb-3">
              <div className={`h-px w-8 bg-gradient-to-r ${division.color}`} />
              <span className={`text-xs font-bold uppercase tracking-widest ${accent.text}`}>{t("sections.coreFunctions")}</span>
            </div>
            <h2 className="text-3xl font-bold text-white">{t("sections.whatWeDo")}</h2>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {division.functions.map((fn, i) => {
              const FnIcon = fn.icon;
              return (
                <motion.div
                  key={fn.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.08 }}
                  className={`rounded-2xl border ${accent.border} ${accent.bg} p-6`}
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${division.color} flex items-center justify-center mb-4 shadow-lg`}>
                    <FnIcon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="font-bold text-white text-base mb-2">{td(`functions.${i}.title`, fn.title)}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{td(`functions.${i}.description`, fn.description)}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Case types + Process */}
      <section className="py-20 border-t border-slate-800/50 bg-slate-900/30">
        <div className="max-w-[1200px] mx-auto px-4 grid lg:grid-cols-2 gap-16">
          {/* Case types */}
          <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`h-px w-8 bg-gradient-to-r ${division.color}`} />
              <span className={`text-xs font-bold uppercase tracking-widest ${accent.text}`}>{t("sections.caseTypes")}</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-6">{t("sections.casesWeHandle")}</h2>
            <ul className="space-y-3">
              {division.caseTypes.map((c, i) => (
                <li key={c} className="flex items-start gap-3">
                  <CheckCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${accent.text}`} />
                  <span className="text-slate-300 text-sm">{td(`caseTypes.${i}`, c)}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Process */}
          <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`h-px w-8 bg-gradient-to-r ${division.color}`} />
              <span className={`text-xs font-bold uppercase tracking-widest ${accent.text}`}>{t("sections.ourProcess")}</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-6">{t("sections.howItWorks")}</h2>
            <ol className="space-y-5">
              {division.process.map((p, i) => (
                <li key={p.step} className="flex gap-4">
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${division.color} flex items-center justify-center flex-shrink-0 text-xs font-bold text-white shadow-lg`}>
                    {i + 1}
                  </div>
                  <div>
                    <p className="font-semibold text-white text-sm mb-1">{td(`process.${i}.step`, p.step)}</p>
                    <p className="text-slate-400 text-sm leading-relaxed">{td(`process.${i}.description`, p.description)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </motion.div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-20 border-t border-slate-800/50">
        <div className="max-w-[1200px] mx-auto px-4">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="mb-10">
            <div className="flex items-center gap-3 mb-3">
              <div className={`h-px w-8 bg-gradient-to-r ${division.color}`} />
              <span className={`text-xs font-bold uppercase tracking-widest ${accent.text}`}>{t("sections.getInTouch")}</span>
            </div>
            <h2 className="text-3xl font-bold text-white">{t("sections.contact", { name: td("title", division.title) })}</h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Email */}
            <motion.a
              href={`mailto:${division.contact.email}`}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
              className={`group rounded-2xl border ${accent.border} ${accent.bg} p-6 flex flex-col gap-4 hover:border-opacity-60 transition-all`}
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${division.color} flex items-center justify-center shadow-lg`}>
                <Mail className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">{t("contact.email")}</p>
                <p className={`font-semibold text-sm ${accent.text} group-hover:underline break-all`}>{division.contact.email}</p>
              </div>
            </motion.a>

            {/* Phone (if available) */}
            {division.contact.phone && (
              <motion.a
                href={`tel:${division.contact.phone.replace(/\D/g, '')}`}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.08 }}
                className={`group rounded-2xl border ${accent.border} ${accent.bg} p-6 flex flex-col gap-4 hover:border-opacity-60 transition-all`}
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${division.color} flex items-center justify-center shadow-lg`}>
                  <Phone className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">{t("contact.helpline")}</p>
                  <p className={`font-semibold text-sm ${accent.text} group-hover:underline`}>{division.contact.phone}</p>
                </div>
              </motion.a>
            )}

            {/* Response time */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.12 }}
              className={`rounded-2xl border ${accent.border} ${accent.bg} p-6 flex flex-col gap-4`}
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${division.color} flex items-center justify-center shadow-lg`}>
                <Clock className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">{t("contact.responseTime")}</p>
                <p className="font-semibold text-white text-sm">{td("contact.responseTime", division.contact.responseTime)}</p>
                <p className="text-slate-400 text-xs mt-1">{td("contact.hours", division.contact.hours)}</p>
              </div>
            </motion.div>
          </div>

          {/* CTA row */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-10 flex flex-wrap gap-4"
          >
            <Link href="/request-access">
              <Button className={`bg-gradient-to-r ${division.color} hover:opacity-90 text-white font-semibold rounded-xl shadow-lg px-6`}>
                {t("cta.fileCase")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800 rounded-xl px-6">
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t("cta.allDivisions")}
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Other divisions footer */}
      <section className="py-16 border-t border-slate-800/50 bg-slate-900/20">
        <div className="max-w-[1200px] mx-auto px-4">
          <h2 className="text-xl font-bold text-white mb-8">{t("sections.otherDivisions")}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Object.values(divisions)
              .filter(d => d.id !== division.id)
              .map(d => {
                const DIcon = d.icon;
                return (
                  <Link key={d.id} href={`/divisions/${d.id}`}>
                    <motion.div
                      whileHover={{ y: -2 }}
                      className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 flex flex-col items-center gap-2 text-center cursor-pointer hover:border-slate-600 transition-all group"
                    >
                      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${d.color} flex items-center justify-center shadow`}>
                        <DIcon className="w-4 h-4 text-white" />
                      </div>
                      <p className="text-xs font-semibold text-slate-300 group-hover:text-white transition-colors leading-tight">{t(`divisions.${d.id}.title`, { defaultValue: d.title })}</p>
                    </motion.div>
                  </Link>
                );
              })}
          </div>
        </div>
        <div className="max-w-[1200px] mx-auto px-4 mt-8 flex justify-center">
          <BuildStampLine className="text-slate-500" />
        </div>
      </section>
      </main>
    </div>
  );
}
