import { Lock, ShieldCheck, FileCheck2 } from "lucide-react";
import { BuildStampLine } from "@/components/BuildStampLine";

interface ComplianceStripProps {
  /** Visual variant — `dark` for the deep navy admin/portal frames,
   *  `light` for the lighter content surfaces. */
  variant?: "dark" | "light";
  className?: string;
}

/**
 * Bank-grade compliance strip — shows the regulator IDs, encryption
 * level, and AML reference. Designed to sit directly under primary
 * headers as a continuous assurance bar across the application.
 */
export function ComplianceStrip({ variant = "dark", className = "" }: ComplianceStripProps) {
  const isDark = variant === "dark";
  return (
    <div
      role="contentinfo"
      aria-label="Regulatory compliance status"
      data-testid="compliance-strip"
      className={`w-full border-y ${
        isDark ? "border-slate-800/60" : "border-slate-200/80"
      } ${className}`}
      style={{
        background: isDark
          ? "linear-gradient(180deg, rgba(2,9,20,0.92), rgba(8,15,35,0.7))"
          : "linear-gradient(180deg, rgba(248,250,252,0.95), rgba(241,245,249,0.85))",
        boxShadow: isDark
          ? "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.4)"
          : "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 0 rgba(15,23,42,0.06)",
      }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 py-1.5 flex items-center justify-between gap-3 flex-wrap text-[10.5px] tracking-wide uppercase">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 ${isDark ? "text-emerald-300" : "text-emerald-700"}`}>
            <span
              className={`h-1.5 w-1.5 rounded-full ${isDark ? "bg-emerald-400" : "bg-emerald-500"}`}
              style={{
                boxShadow: isDark
                  ? "0 0 6px rgba(52,211,153,0.7)"
                  : "0 0 6px rgba(16,185,129,0.5)",
              }}
            />
            Secure Channel · TLS 1.3
          </span>
          <span className={isDark ? "text-slate-700 hidden sm:inline" : "text-slate-300 hidden sm:inline"}>|</span>
          <span className={`inline-flex items-center gap-1.5 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
            <Lock className="w-3 h-3" /> AES-256 at rest
          </span>
          <span className={isDark ? "text-slate-700 hidden sm:inline" : "text-slate-300 hidden sm:inline"}>|</span>
          <span className={`hidden md:inline-flex items-center gap-1.5 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
            <FileCheck2 className="w-3 h-3" /> AML / KYC Sec. 7.3
          </span>
        </div>
        <div className={`inline-flex items-center gap-3 sm:gap-4 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          <span className="hidden lg:inline">ISO/IEC 27001 · SOC 2 Type II</span>
          <span className={isDark ? "text-slate-700 hidden lg:inline" : "text-slate-300 hidden lg:inline"}>|</span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className={`w-3 h-3 ${isDark ? "text-sky-300" : "text-sky-600"}`} />
            Reg. IBCCF-2024-AML-7831
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Bank-grade footer — sits at the bottom of standalone pages with a
 * full disclosure summary and audit-trail assurance. Composes with the
 * ComplianceStrip when both are needed (gateway / request-access page).
 */
export function ComplianceFooter({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const isDark = variant === "dark";
  return (
    <footer
      className={`relative border-t ${
        isDark ? "border-slate-800/80 bg-slate-950/60" : "border-slate-200 bg-slate-50/80"
      } backdrop-blur`}
    >
      <div className={`max-w-6xl mx-auto px-6 py-5 text-[11px] leading-relaxed ${isDark ? "text-slate-500" : "text-slate-500"}`}>
        <div className="flex items-start gap-2.5">
          <Lock className={`w-3 h-3 mt-0.5 flex-none ${isDark ? "text-slate-500" : "text-slate-400"}`} />
          <p>
            All sessions are end-to-end encrypted and recorded to the
            tamper-evident audit ledger. IBCCF acts as a coordinating
            compliance agent for cross-border recovery; custodial
            balances remain in segregated fiduciary escrow pending
            verification under AML/KYC statute. This portal does not
            constitute legal or investment advice.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            &copy; {new Date().getFullYear()} IBCCF · International Banking
            Compliance &amp; Custody Framework
          </div>
          <div className="flex items-center gap-3 opacity-80">
            <span>Reg. No. IBCCF-2024-AML-7831</span>
            <span>·</span>
            <span>ISO/IEC 27001</span>
            <span>·</span>
            <span>SOC 2 Type II</span>
            <BuildStampLine className="before:content-['·'] before:mr-3" />
          </div>
        </div>
      </div>
    </footer>
  );
}
