import { Link } from "wouter";
import { Shield, ArrowLeft, Lock, FileText, AlertTriangle, Scale, Ban, RefreshCw, Mail, CheckCircle2, AlertCircle, Gavel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BuildStampLine } from "@/components/BuildStampLine";
import { useTranslation } from "react-i18next";
import { useFormat } from "@/i18n/format";
import { LEGAL_LAST_UPDATED } from "@/lib/legalDates";

interface SectionDef {
  id: string;
  icon: React.ElementType;
  titleKey: string;
}

const SECTION_DEFS: SectionDef[] = [
  { id: "acceptance", icon: CheckCircle2, titleKey: "sections.acceptance.title" },
  { id: "services", icon: FileText, titleKey: "sections.services.title" },
  { id: "eligibility", icon: CheckCircle2, titleKey: "sections.eligibility.title" },
  { id: "conduct", icon: Scale, titleKey: "sections.conduct.title" },
  { id: "uploads", icon: FileText, titleKey: "sections.uploads.title" },
  { id: "financial", icon: AlertTriangle, titleKey: "sections.financial.title" },
  { id: "ip", icon: Shield, titleKey: "sections.ip.title" },
  { id: "disclaimer", icon: AlertTriangle, titleKey: "sections.disclaimer.title" },
  { id: "liability", icon: Ban, titleKey: "sections.liability.title" },
  { id: "termination", icon: Ban, titleKey: "sections.termination.title" },
  { id: "governing-law", icon: Gavel, titleKey: "sections.governingLaw.title" },
  { id: "changes", icon: RefreshCw, titleKey: "sections.changes.title" },
  { id: "contact", icon: Mail, titleKey: "sections.contact.title" },
];

export default function TermsOfUsePage() {
  const { t } = useTranslation("terms");
  const { formatDate } = useFormat();

  const servicesItems = t("sections.services.items", { returnObjects: true }) as string[];
  const eligibilityItems = t("sections.eligibility.items", { returnObjects: true }) as string[];
  const conductItems = t("sections.conduct.items", { returnObjects: true }) as string[];
  const uploadsItems = t("sections.uploads.items", { returnObjects: true }) as string[];
  const financialItems = t("sections.financial.items", { returnObjects: true }) as string[];
  const disclaimerItems = t("sections.disclaimer.items", { returnObjects: true }) as string[];

  const sectionContent: Record<string, React.ReactNode> = {
    acceptance: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>
          {t("sections.acceptance.p1Pre")}
          <strong className="text-white">{t("sections.acceptance.p1Brand")}</strong>
          {t("sections.acceptance.p1Mid")}
          <strong className="text-white">{t("sections.acceptance.p1Terms")}</strong>
          {t("sections.acceptance.p1Post")}
        </p>
        <p>{t("sections.acceptance.p2")}</p>
        <p className="text-amber-400/80 text-sm border border-amber-500/20 bg-amber-500/5 rounded p-3">
          <AlertCircle className="inline w-4 h-4 mr-1.5 align-text-bottom" />
          <strong>{t("reviewerNote.label")}</strong> {t("reviewerNote.text")}
        </p>
      </div>
    ),
    services: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.services.p1")}</p>
        <ul className="space-y-2">
          {servicesItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>{t("sections.services.p2")}</p>
      </div>
    ),
    eligibility: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.eligibility.intro")}</p>
        <ul className="space-y-2">
          {eligibilityItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>{t("sections.eligibility.outro")}</p>
      </div>
    ),
    conduct: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.conduct.intro")}</p>
        <ul className="space-y-2">
          {conductItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-red-500/70 mt-2" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>{t("sections.conduct.outro")}</p>
      </div>
    ),
    uploads: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.uploads.intro")}</p>
        <ul className="space-y-2">
          {uploadsItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>{t("sections.uploads.outro")}</p>
      </div>
    ),
    financial: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.financial.p1")}</p>
        <p>{t("sections.financial.p2")}</p>
        <ul className="space-y-2">
          {financialItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500 mt-2" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
    ip: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.ip.p1")}</p>
        <p>{t("sections.ip.p2")}</p>
      </div>
    ),
    disclaimer: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>
          {t("sections.disclaimer.introPreAsIs")}
          <strong className="text-white">{t("sections.disclaimer.introAsIs")}</strong>
          {t("sections.disclaimer.introMid")}
          <strong className="text-white">{t("sections.disclaimer.introAsAvailable")}</strong>
          {t("sections.disclaimer.introPost")}
        </p>
        <ul className="space-y-2">
          {disclaimerItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-slate-500 mt-2" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>{t("sections.disclaimer.outro")}</p>
      </div>
    ),
    liability: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.liability.p1")}</p>
        <p>{t("sections.liability.p2")}</p>
      </div>
    ),
    termination: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.termination.p1")}</p>
        <p>{t("sections.termination.p2")}</p>
      </div>
    ),
    "governing-law": (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.governingLaw.p1")}</p>
        <p>
          {t("sections.governingLaw.p2Pre")}{" "}
          <Link href="/legal-resources" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">
            {t("sections.governingLaw.p2LinkText")}
          </Link>{" "}
          {t("sections.governingLaw.p2Post")}
        </p>
      </div>
    ),
    changes: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.changes.p1")}</p>
      </div>
    ),
    contact: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.contact.p1")}</p>
      </div>
    ),
  };

  return (
    <div className="min-h-screen bg-[#020817] font-sans text-white selection:bg-blue-500/30 selection:text-blue-200">

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-[#020817]/90 backdrop-blur-xl">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-blue-900 rounded border border-blue-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.3)]">
                <Shield className="h-4 w-4 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-white tracking-wider leading-none">IBCCF</span>
                <span className="text-[8px] text-slate-400 uppercase tracking-widest">International Blockchain Complaints Forum</span>
              </div>
            </Link>

            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white hover:bg-slate-800 text-xs uppercase tracking-wider font-bold">
                  <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                  {t("back")}
                </Button>
              </Link>
              <div className="w-px h-4 bg-slate-800" />
              <Link href="/verify">
                <Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white rounded text-xs uppercase tracking-wider font-bold shadow-[0_0_15px_rgba(37,99,235,0.3)] border border-blue-500">
                  <Lock className="w-3 h-3 mr-1.5" />
                  {t("accessPortal")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>

        {/* Hero */}
        <div className="border-b border-slate-800 bg-gradient-to-b from-[#040d21] to-[#020817]">
          <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
            <div className="flex items-start gap-5">
              <div className="shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-violet-600/30 to-blue-600/20 border border-violet-500/30 flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.2)]">
                <Scale className="w-7 h-7 text-violet-400" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-violet-400 mb-2">{t("legalDoc")}</p>
                <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-4">{t("title")}</h1>
                <p className="text-slate-400 text-lg max-w-2xl leading-relaxed">{t("subtitle")}</p>
                <p className="mt-4 text-xs text-slate-500 font-mono uppercase tracking-widest">
                  {t("lastUpdated")} {formatDate(new Date(LEGAL_LAST_UPDATED), { dateStyle: "long", timeZone: "UTC" })}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Table of Contents */}
        <div className="border-b border-slate-800 bg-slate-900/40">
          <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">{t("contents")}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1.5">
              {SECTION_DEFS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="text-xs text-slate-400 hover:text-violet-400 transition-colors font-mono"
                >
                  {t(s.titleKey)}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
          {SECTION_DEFS.map((s) => {
            const Icon = s.icon;
            return (
              <section
                key={s.id}
                id={s.id}
                className="scroll-mt-20 border border-slate-800/60 rounded-xl bg-slate-900/30 p-6 md:p-8 backdrop-blur-sm"
              >
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                    <Icon className="w-4.5 h-4.5 text-violet-400" />
                  </div>
                  <h2 className="text-lg font-bold text-white tracking-tight">{t(s.titleKey)}</h2>
                </div>
                {sectionContent[s.id]}
              </section>
            );
          })}
        </div>

        {/* Footer bar */}
        <div className="border-t border-slate-800 bg-slate-900/40">
          <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row justify-between items-center gap-3 text-xs text-slate-600 font-mono uppercase tracking-widest">
            <BuildStampLine className="text-slate-600" />
            <div className="flex gap-6">
              <Link href="/privacy-policy" className="hover:text-slate-400 transition-colors">{t("privacyLink")}</Link>
              <Link href="/legal-resources" className="hover:text-slate-400 transition-colors">{t("legalResourcesLink")}</Link>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
