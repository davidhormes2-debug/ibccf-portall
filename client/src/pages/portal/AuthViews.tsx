import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Lock, Key, User, Mail, Phone, Shield, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { usePortal, Case, ViewState } from "./PortalContext";

export function LoginView() {
  const { setCurrentCase, setAccessCode, setViewState } = usePortal();
  const [localAccessCode, setLocalAccessCode] = useState("");
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch(`/api/cases/access/${localAccessCode}`);
      
      if (response.ok) {
        const foundCase: Case = await response.json();
        setCurrentCase(foundCase);
        setAccessCode(localAccessCode);
        
        const landingPage = (foundCase.landingPage || 'dashboard') as ViewState;
        if (foundCase.status === 'active') setViewState(landingPage);
        else if (foundCase.status === 'syncing') setViewState('sync');
        else if (foundCase.status === 'completed') setViewState(landingPage);
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
          description: "Invalid clearance code provided.",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to verify credentials.",
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#004182]/20 flex items-center justify-center" data-testid="img-logo">
            <Shield className="h-10 w-10 text-[#004182]" />
          </div>
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
                    value={localAccessCode}
                    onChange={(e) => setLocalAccessCode(e.target.value)}
                    data-testid="input-access-code"
                  />
                </div>
              </div>
              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-login">
                Verify Identity
              </Button>
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

export function RegisterView() {
  const { currentCase, setCurrentCase, setViewState, accessCode: contextAccessCode } = usePortal();
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regMobile, setRegMobile] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [syncProgress, setSyncProgress] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  
  // Use context accessCode or fall back to sessionStorage
  const accessCode = contextAccessCode || sessionStorage.getItem("caseAccessCode") || "";
  
  // Show loading state while waiting for case data
  if (!currentCase) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin"></div>
          <p className="text-slate-400 text-sm">Loading your profile...</p>
        </motion.div>
      </div>
    );
  }

  const startSyncSimulation = async (caseData: { id: string; userName: string; userEmail: string; userMobile: string }) => {
    const steps = [
      { progress: 15, text: "Initializing secure handshake..." },
      { progress: 30, text: "Verifying identity certificates..." },
      { progress: 45, text: "Synchronizing with compliance database..." },
      { progress: 60, text: "Validating account integrity..." },
      { progress: 75, text: "Establishing secure session..." },
      { progress: 90, text: "Finalizing synchronization..." },
      { progress: 100, text: "Complete!" },
    ];
    
    let index = 0;
    const interval = setInterval(async () => {
      if (index < steps.length) {
        setSyncProgress(steps[index].progress);
        index++;
      } else {
        clearInterval(interval);
        // Complete sync - update case status and transition to dashboard
        try {
          await fetch(`/api/cases/${caseData.id}/register`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              userName: caseData.userName,
              userEmail: caseData.userEmail,
              userMobile: caseData.userMobile,
              status: 'active' 
            })
          });
        } catch {}
        setViewState('dashboard');
      }
    }, 1200);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    // Validate access code is available
    if (!accessCode) {
      toast({
        variant: "destructive",
        title: "Session Error",
        description: "Please start over from the verification page.",
      });
      setIsSubmitting(false);
      return;
    }

    // Validate PIN
    if (!newPin || newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      toast({
        variant: "destructive",
        title: "Invalid PIN",
        description: "Please enter a 6-digit numeric PIN.",
      });
      setIsSubmitting(false);
      return;
    }

    if (newPin !== confirmPin) {
      toast({
        variant: "destructive",
        title: "PIN Mismatch",
        description: "The PINs you entered do not match. Please try again.",
      });
      setIsSubmitting(false);
      return;
    }

    try {
      // First, set the PIN
      const pinResponse = await fetch('/api/cases/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessCode: accessCode,
          pin: newPin
        })
      });

      if (!pinResponse.ok) {
        const pinError = await pinResponse.json();
        toast({
          variant: "destructive",
          title: "PIN Setup Failed",
          description: pinError.error || "Unable to set your PIN.",
        });
        setIsSubmitting(false);
        return;
      }

      // Then register the user details
      const response = await fetch(`/api/cases/${currentCase.id}/register`, {
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
        startSyncSimulation({
          id: updatedCase.id,
          userName: regName,
          userEmail: regEmail,
          userMobile: regMobile
        });
      } else {
        toast({
          variant: "destructive",
          title: "Registration Failed",
          description: "Unable to complete registration.",
        });
        setIsSubmitting(false);
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to save registration.",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="max-w-md w-full">
        <Card className="bg-slate-950 border-slate-800 shadow-2xl">
          <CardHeader>
            <CardTitle className="text-white">Identity Verification</CardTitle>
            <p className="text-slate-400 text-sm mt-1">Please confirm your contact details for the secure ledger.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400 uppercase">Full Legal Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <Input 
                    required 
                    value={regName} 
                    onChange={e => setRegName(e.target.value)} 
                    className="pl-9 bg-slate-900 border-slate-800 text-white" 
                    placeholder="Your full legal name" 
                    data-testid="input-name" 
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400 uppercase">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <Input 
                    required 
                    type="email" 
                    value={regEmail} 
                    onChange={e => setRegEmail(e.target.value)} 
                    className="pl-9 bg-slate-900 border-slate-800 text-white" 
                    placeholder="name@example.com" 
                    data-testid="input-email" 
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400 uppercase">Mobile Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <Input 
                    required 
                    type="tel" 
                    value={regMobile} 
                    onChange={e => setRegMobile(e.target.value)} 
                    className="pl-9 bg-slate-900 border-slate-800 text-white" 
                    placeholder="Your contact number" 
                    data-testid="input-mobile" 
                  />
                </div>
              </div>
              
              <div className="pt-4 border-t border-slate-800">
                <p className="text-xs text-slate-400 mb-4">Create a secure 6-digit PIN for future logins</p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400 uppercase">Create 6-Digit PIN</label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <Input 
                        required 
                        type="password" 
                        value={newPin} 
                        onChange={e => {
                          const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setNewPin(value);
                        }} 
                        className="pl-9 bg-slate-900 border-slate-800 text-white text-center tracking-widest font-mono" 
                        placeholder="••••••" 
                        maxLength={6}
                        data-testid="input-new-pin" 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400 uppercase">Confirm PIN</label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <Input 
                        required 
                        type="password" 
                        value={confirmPin} 
                        onChange={e => {
                          const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setConfirmPin(value);
                        }} 
                        className="pl-9 bg-slate-900 border-slate-800 text-white text-center tracking-widest font-mono" 
                        placeholder="••••••" 
                        maxLength={6}
                        data-testid="input-confirm-pin" 
                      />
                    </div>
                  </div>
                </div>
              </div>
              
              <Button 
                type="submit" 
                className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-4" 
                data-testid="button-register"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing...
                  </span>
                ) : (
                  "Proceed to Secure Synchronization"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

interface SyncViewProps {
  syncProgress?: number;
  syncStatusText?: string;
}

export function SyncView({ syncProgress = 75, syncStatusText = "Establishing secure connection..." }: SyncViewProps) {
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
