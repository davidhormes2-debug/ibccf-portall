import { Link } from "wouter";
import { Shield, ArrowLeft, Lock, FileText, Eye, Database, Mail, Globe, UserCheck, AlertCircle, RefreshCw, Clock } from "lucide-react";
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
  { id: "overview", icon: Eye, titleKey: "sections.overview.title" },
  { id: "data-collected", icon: Database, titleKey: "sections.dataCollected.title" },
  { id: "how-we-use", icon: FileText, titleKey: "sections.howWeUse.title" },
  { id: "legal-basis", icon: UserCheck, titleKey: "sections.legalBasis.title" },
  { id: "sharing", icon: Globe, titleKey: "sections.sharing.title" },
  { id: "retention", icon: Clock, titleKey: "sections.retention.title" },
  { id: "security", icon: Lock, titleKey: "sections.security.title" },
  { id: "rights", icon: UserCheck, titleKey: "sections.rights.title" },
  { id: "international", icon: Globe, titleKey: "sections.international.title" },
  { id: "contact", icon: Mail, titleKey: "sections.contact.title" },
  { id: "updates", icon: RefreshCw, titleKey: "sections.updates.title" },
];

export default function PrivacyPolicyPage() {
  const { t } = useTranslation("privacy");
  const { formatDate } = useFormat();

  const dataCollectedItems = t("sections.dataCollected.items", { returnObjects: true }) as Array<{ label: string; detail: string }>;
  const howWeUseItems = t("sections.howWeUse.items", { returnObjects: true }) as string[];
  const legalBasisItems = t("sections.legalBasis.items", { returnObjects: true }) as Array<{ basis: string; detail: string }>;
  const sharingItems = t("sections.sharing.items", { returnObjects: true }) as string[];
  const retentionItems = t("sections.retention.items", { returnObjects: true }) as string[];
  const securityItems = t("sections.security.items", { returnObjects: true }) as string[];
  const rightsItems = t("sections.rights.items", { returnObjects: true }) as Array<{ right: string; detail: string }>;

  const sectionContent: Record<string, React.ReactNode> = {
    overview: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>
          {t("sections.overview.p1Pre")}
          <strong className="text-white">{t("sections.overview.p1Brand")}</strong>
          {t("sections.overview.p1Post")}
        </p>
        <p>{t("sections.overview.p2")}</p>
        <p className="text-amber-400/80 text-sm border border-amber-500/20 bg-amber-500/5 rounded p-3">
          <AlertCircle className="inline w-4 h-4 mr-1.5 align-text-bottom" />
          <strong>{t("reviewerNote.label")}</strong> {t("reviewerNote.text")}
        </p>
      </div>
    ),
    "data-collected": (
      <div className="space-y-4 text-slate-300 leading-relaxed">
        <p>{t("sections.dataCollected.intro")}</p>
        <ul className="space-y-3">
          {dataCollectedItems.map(({ label, detail }) => (
            <li key={label} className="flex gap-3">
              <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
              <span>
                <strong className="text-white">{label}:</strong> {detail}
              </span>
            </li>
          ))}
        </ul>
      </div>
    ),
    "how-we-use": (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.howWeUse.intro")}</p>
        <ul className="space-y-2">
          {howWeUseItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
    "legal-basis": (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.legalBasis.intro")}</p>
        <ul className="space-y-2">
          {legalBasisItems.map(({ basis, detail }) => (
            <li key={basis} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-violet-500 mt-2" />
              <span>
                <strong className="text-white">{basis}:</strong> {detail}
              </span>
            </li>
          ))}
        </ul>
      </div>
    ),
    sharing: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.sharing.intro")}</p>
        <ul className="space-y-2">
          {sharingItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
    retention: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.retention.intro")}</p>
        <ul className="space-y-2">
          {retentionItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
    security: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.security.intro")}</p>
        <ul className="space-y-2">
          {securityItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 mt-2" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>{t("sections.security.outro")}</p>
      </div>
    ),
    rights: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.rights.intro")}</p>
        <ul className="space-y-2">
          {rightsItems.map(({ right, detail }) => (
            <li key={right} className="flex gap-3">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-violet-500 mt-2" />
              <span>
                <strong className="text-white">{right}:</strong> {detail}
              </span>
            </li>
          ))}
        </ul>
        <p>{t("sections.rights.outro")}</p>
      </div>
    ),
    international: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.international.p1")}</p>
        <p>
          {t("sections.international.p2Pre")}{" "}
          <Link href="/legal-resources" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">
            {t("sections.international.p2LinkText")}
          </Link>{" "}
          {t("sections.international.p2Post")}
        </p>
      </div>
    ),
    contact: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.contact.p1")}</p>
        <p>{t("sections.contact.p2")}</p>
      </div>
    ),
    updates: (
      <div className="space-y-3 text-slate-300 leading-relaxed">
        <p>{t("sections.updates.p1")}</p>
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
              <div className="shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-blue-600/30 to-violet-600/20 border border-blue-500/30 flex items-center justify-center shadow-[0_0_30px_rgba(37,99,235,0.2)]">
                <Eye className="w-7 h-7 text-blue-400" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-2">{t("legalDoc")}</p>
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
                  className="text-xs text-slate-400 hover:text-blue-400 transition-colors font-mono"
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
                  <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                    <Icon className="w-4.5 h-4.5 text-blue-400" />
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
              <Link href="/terms-of-use" className="hover:text-slate-400 transition-colors">{t("termsLink")}</Link>
              <Link href="/legal-resources" className="hover:text-slate-400 transition-colors">{t("legalResourcesLink")}</Link>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
