import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Printer, ShieldCheck, Globe, Lock } from "lucide-react";
import ibcLogo from "@assets/generated_images/professional_corporate_logo_for_international_blockchain_community.png";

export default function LetterPage() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 print:bg-white print:p-0">
      {/* Control Bar - Hidden on Print */}
      <div className="max-w-[210mm] mx-auto mb-6 flex justify-end print:hidden">
        <Button onClick={handlePrint} className="gap-2 shadow-sm">
          <Printer className="h-4 w-4" />
          Print / Save PDF
        </Button>
      </div>

      {/* A4 Letter Container */}
      <div className="max-w-[210mm] mx-auto bg-white shadow-2xl min-h-[297mm] relative print:shadow-none print:w-full">
        {/* Watermark Background */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-[0.02] overflow-hidden">
          <img src={ibcLogo} alt="" className="w-[150%] h-[150%] object-contain grayscale" />
        </div>

        <div className="relative z-10 p-12 md:p-16 flex flex-col h-full justify-between">
          
          {/* Header */}
          <header className="mb-12">
            <div className="flex items-start justify-between mb-8">
              <div className="flex items-center gap-4">
                <img src={ibcLogo} alt="IBC Logo" className="h-20 w-20 object-contain" />
                <div>
                  <h1 className="font-serif text-2xl font-bold text-primary tracking-tight">
                    INTERNATIONAL<br />BLOCKCHAIN<br />COMMUNITY
                  </h1>
                </div>
              </div>
              <div className="text-right text-sm text-muted-foreground space-y-1 font-medium">
                <p className="text-primary font-bold uppercase tracking-wide text-xs">Restricted Correspondence</p>
                <p>Ref: IBC-AML-CC-774982</p>
                <p>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
            </div>
            
            <div className="border-t-2 border-primary/10 pt-4">
              <h2 className="text-sm font-bold text-primary uppercase tracking-wider">
                Account Integrity & Security Operations Division (ISO-D)
              </h2>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
                Global Compliance Secretariat
              </p>
            </div>
          </header>

          {/* Body Content */}
          <main className="flex-grow space-y-6 text-[10.5pt] leading-relaxed text-slate-800 font-sans">
            
            <div className="mb-8">
              <p className="font-bold text-lg font-serif text-primary mb-4">Dear Luzmila Chavez,</p>
              <p>
                We acknowledge the successful completion of your re-authentication procedure. In accordance with 
                IBC cross-border withdrawal regulations and AML/CTF operational standards, please review the 
                finalised withdrawal options and the required Phrase Key structure necessary to activate your 
                withdrawal schedule.
              </p>
            </div>

            {/* Options Section */}
            <section className="space-y-6">
              <h3 className="font-serif text-lg font-bold text-primary border-b border-primary/20 pb-2 mb-4">
                WITHDRAWAL OPTIONS & EXECUTION SCHEDULE
              </h3>

              <div className="grid md:grid-cols-2 gap-6">
                {/* Option A */}
                <div className="bg-slate-50 p-6 rounded-sm border border-slate-200 relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                  <h4 className="font-bold text-primary mb-3 flex items-center gap-2">
                    <span className="bg-primary text-white text-xs px-2 py-0.5 rounded-sm">OPTION A</span>
                    Accelerated Release
                  </h4>
                  <ul className="space-y-2 text-sm">
                    <li className="flex justify-between"><span className="text-muted-foreground">Schedule:</span> <span className="font-semibold">50,000 USDT / 12 hrs</span></li>
                    <li className="flex justify-between"><span className="text-muted-foreground">Total Transfers:</span> <span className="font-semibold">10</span></li>
                    <li className="flex justify-between"><span className="text-muted-foreground">Keys Required:</span> <span className="font-semibold">1 per withdrawal</span></li>
                    <li className="pt-2 border-t border-dashed border-slate-200 mt-2 flex justify-between items-center">
                      <span className="text-muted-foreground">Key Cost:</span>
                      <span className="font-mono font-bold">260.996 USDT</span>
                    </li>
                    <li className="flex justify-between items-center text-primary">
                      <span className="font-bold text-xs uppercase">Total Requirement:</span>
                      <span className="font-mono font-bold text-lg">2,609.96 USDT</span>
                    </li>
                  </ul>
                  <p className="text-xs text-muted-foreground mt-3 italic bg-white p-2 rounded border border-slate-100">
                    Recommended for fast, uninterrupted clearance.
                  </p>
                </div>

                {/* Option B */}
                <div className="bg-slate-50 p-6 rounded-sm border border-slate-200 relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-1 h-full bg-slate-300"></div>
                  <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <span className="bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-sm">OPTION B</span>
                    Standard Release
                  </h4>
                  <ul className="space-y-2 text-sm">
                    <li className="flex justify-between"><span className="text-muted-foreground">Schedule:</span> <span className="font-semibold">25,000 USDT / 12 hrs</span></li>
                    <li className="flex justify-between"><span className="text-muted-foreground">Total Transfers:</span> <span className="font-semibold">20</span></li>
                    <li className="flex justify-between"><span className="text-muted-foreground">Keys Required:</span> <span className="font-semibold">1 per withdrawal</span></li>
                    <li className="pt-2 border-t border-dashed border-slate-200 mt-2 flex justify-between items-center">
                      <span className="text-muted-foreground">Key Cost:</span>
                      <span className="font-mono font-bold">521.993 USDT</span>
                    </li>
                     <li className="flex justify-between items-center text-slate-700">
                      <span className="font-bold text-xs uppercase">Total Requirement:</span>
                      <span className="font-mono font-bold text-lg">5,219.92 USDT</span>
                    </li>
                  </ul>
                  <p className="text-xs text-muted-foreground mt-3 italic bg-white p-2 rounded border border-slate-100">
                    Ideal for smaller release amounts.
                  </p>
                </div>
              </div>
            </section>

            {/* Requirements Section */}
            <section className="mt-8 bg-primary/5 p-6 rounded-sm border border-primary/10">
              <h3 className="font-serif font-bold text-primary mb-3 flex items-center gap-2">
                <Lock className="h-4 w-4" />
                MANDATORY PHRASE KEY REQUIREMENTS
              </h3>
              <p className="text-sm mb-4">Phrase Keys are required to:</p>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 bg-primary rounded-full"></div>
                  Authenticate each high-value withdrawal
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 bg-primary rounded-full"></div>
                  Ensure uninterrupted cross-border access
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 bg-primary rounded-full"></div>
                  Maintain AML/CTF compliance
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 bg-primary rounded-full"></div>
                  Allow approval through Global Monitoring Network
                </li>
              </ul>
              <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded text-amber-800 text-xs font-medium flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Important: Withdrawals initiated without updated Phrase Keys may trigger a 48–96 hour AML review delay.
                </span>
              </div>
            </section>

            {/* Next Action */}
            <section className="mt-8">
              <h3 className="font-serif text-lg font-bold text-primary border-b border-primary/20 pb-2 mb-4">
                NEXT ACTION REQUIRED
              </h3>
              <div className="pl-4 border-l-2 border-primary">
                <p className="mb-4 font-medium">Please confirm your preferred withdrawal option:</p>
                <div className="flex gap-8 mb-6 font-bold text-primary">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border-2 border-primary"></div>
                    Option A
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border-2 border-slate-300"></div>
                    Option B
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Once your choice and the required deposit are received, we will immediately issue your Phrase Keys and finalise your release authorisation.
                </p>
              </div>
              
               <div className="mt-6 text-sm font-medium text-slate-600">
                Compliance Clearance Reference: <span className="font-mono font-bold text-primary">IBC-AML-CC-774982</span>
              </div>
            </section>

          </main>

          {/* Footer */}
          <footer className="mt-16 pt-8 border-t border-slate-200 text-[8pt] text-slate-500 leading-tight">
            <div className="grid grid-cols-3 gap-8">
              <div className="col-span-2 space-y-2">
                <p className="font-bold text-primary uppercase tracking-wider">International Blockchain Community (IBC)</p>
                <p>Authority: Account Integrity & Security Operations Division (ISO-D)</p>
                <p>
                  This communication is confidential and intended solely for the verified account holder. 
                  Unauthorised sharing is prohibited under the International Digital Assets Law (IDC-47/2023).
                </p>
              </div>
              <div className="text-right space-y-2">
                <div className="flex items-center justify-end gap-2 text-primary/80">
                  <Globe className="h-3 w-3" />
                  <span className="font-bold">Global Compliance Verified</span>
                </div>
                <p>IBC adheres to AML/CTF guidelines, FATF standards, and international digital-asset compliance regulations.</p>
                <p className="font-mono">Ref: IBC-AML-CC-774982</p>
              </div>
            </div>
            <div className="mt-8 text-center opacity-50 text-[7pt] uppercase tracking-[0.2em]">
              Official Correspondence • Secure Document • Do Not Distribute
            </div>
          </footer>

        </div>
      </div>
    </div>
  );
}
