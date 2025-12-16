import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Shield, Lock, ArrowLeft, CheckCircle, Key, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function VerifyPlatform() {
  const [accessCode, setAccessCode] = useState("");
  const [pinAccessCode, setPinAccessCode] = useState("");
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<"code" | "pin" | "setup-pin">("code");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [verifiedCaseId, setVerifiedCaseId] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSetupPin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newPin || newPin.length !== 6) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a 6-digit PIN.",
      });
      return;
    }
    
    if (newPin !== confirmPin) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "PINs do not match. Please try again.",
      });
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await fetch("/api/cases/set-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode, pin: newPin }),
      });
      
      if (res.ok) {
        toast({
          title: "PIN Created",
          description: "Your secure PIN has been set successfully. You can now access your dashboard.",
        });
        sessionStorage.setItem("caseAccessCode", accessCode);
        sessionStorage.setItem("caseId", verifiedCaseId);
        setLocation("/dashboard");
      } else {
        const errorData = await res.json();
        toast({
          variant: "destructive",
          title: "Error",
          description: errorData.error || "Failed to set PIN. Please try again.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to set PIN at this time. Please try again later.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (loginMode === "code") {
      if (!accessCode.trim()) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please enter your verification code.",
        });
        return;
      }

      setIsLoading(true);
      try {
        // First verify the access code and check if PIN is set
        const verifyRes = await fetch("/api/cases/verify-access-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCode }),
        });
        
        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          
          if (!verifyData.hasPinSet) {
            // PIN not set - redirect to PIN setup
            setVerifiedCaseId(verifyData.caseId);
            setLoginMode("setup-pin");
            toast({
              title: "Security Setup Required",
              description: "Please create a 6-digit PIN to secure your account.",
            });
          } else {
            // PIN already set - they should use PIN login
            toast({
              variant: "destructive",
              title: "PIN Required",
              description: "You have already set up your PIN. Please use 'Login with PIN' to access your account.",
            });
            setLoginMode("pin");
            setPinAccessCode(accessCode);
          }
        } else {
          toast({
            variant: "destructive",
            title: "Invalid Code",
            description: "The verification code entered is not valid. Please check and try again.",
          });
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Connection Error",
          description: "Unable to verify at this time. Please try again later.",
        });
      } finally {
        setIsLoading(false);
      }
    } else if (loginMode === "pin") {
      if (!pinAccessCode.trim()) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please enter your access code.",
        });
        return;
      }
      if (!pin.trim() || pin.length !== 6) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please enter your 6-digit PIN.",
        });
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch("/api/cases/login-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCode: pinAccessCode, pin }),
        });
        
        if (res.ok) {
          const data = await res.json();
          sessionStorage.setItem("caseAccessCode", data.accessCode);
          sessionStorage.setItem("caseId", data.id);
          setLocation("/dashboard");
        } else {
          const errorData = await res.json();
          toast({
            variant: "destructive",
            title: "Invalid PIN",
            description: errorData.error || "The PIN entered is not valid. Please check and try again.",
          });
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Connection Error",
          description: "Unable to verify at this time. Please try again later.",
        });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const toggleLoginMode = () => {
    if (loginMode === "setup-pin") {
      setLoginMode("code");
      setNewPin("");
      setConfirmPin("");
    } else {
      setLoginMode(prev => prev === "code" ? "pin" : "code");
    }
    setAccessCode("");
    setPinAccessCode("");
    setPin("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#004182] to-[#002d5a] font-['Public_Sans',sans-serif]">
      {/* Header */}
      <header className="bg-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2 text-white hover:opacity-80 transition-opacity">
              <ArrowLeft className="h-5 w-5" />
              <span className="font-medium">Back to Home</span>
            </Link>
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-white" />
              <span className="text-xl font-bold text-white font-['Merriweather',serif]">IBCCF</span>
            </div>
            <ThemeToggle className="text-white" />
            <div className="flex items-center gap-2 text-sm text-white/80">
              <Lock className="h-4 w-4" />
              <span>Secure Access</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex items-center justify-center px-4 py-20">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-[#004182]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                {loginMode === "code" && <Shield className="h-8 w-8 text-[#004182]" />}
                {loginMode === "pin" && <Key className="h-8 w-8 text-[#004182]" />}
                {loginMode === "setup-pin" && <KeyRound className="h-8 w-8 text-[#004182]" />}
              </div>
              <h1 className="text-2xl font-bold text-[#0F172B] font-['Merriweather',serif] mb-2">
                {loginMode === "setup-pin" ? "Create Your Secure PIN" : "Secure Verification Portal"}
              </h1>
              <p className="text-slate-600">
                {loginMode === "code" && "Enter your unique verification code to access your case dashboard and official documentation."}
                {loginMode === "pin" && "Enter your 6-digit PIN to securely access your case dashboard."}
                {loginMode === "setup-pin" && "Create a 6-digit PIN to secure your account. You'll use this PIN along with your access code for future logins."}
              </p>
            </div>

            {loginMode === "setup-pin" ? (
              <form onSubmit={handleSetupPin} className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <label htmlFor="newPin" className="block text-sm font-medium text-slate-700 mb-2">
                      Create 6-Digit PIN
                    </label>
                    <Input
                      id="newPin"
                      type="password"
                      value={newPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setNewPin(value);
                      }}
                      placeholder="••••••"
                      className="w-full h-12 text-center text-lg tracking-widest font-mono border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                      maxLength={6}
                      data-testid="input-new-pin"
                    />
                  </div>
                  <div>
                    <label htmlFor="confirmPin" className="block text-sm font-medium text-slate-700 mb-2">
                      Confirm PIN
                    </label>
                    <Input
                      id="confirmPin"
                      type="password"
                      value={confirmPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setConfirmPin(value);
                      }}
                      placeholder="••••••"
                      className="w-full h-12 text-center text-lg tracking-widest font-mono border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                      maxLength={6}
                      data-testid="input-confirm-pin"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-[#004AB3] hover:bg-[#003d99] text-white font-semibold text-lg shadow-lg"
                  disabled={isLoading}
                  data-testid="button-set-pin"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Setting PIN...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <KeyRound className="h-5 w-5" />
                      Create PIN & Continue
                    </span>
                  )}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerify} className="space-y-6">
                {loginMode === "code" ? (
                  <div>
                    <label htmlFor="accessCode" className="block text-sm font-medium text-slate-700 mb-2">
                      Verification Code
                    </label>
                    <Input
                      id="accessCode"
                      type="text"
                      value={accessCode}
                      onChange={(e) => setAccessCode(e.target.value)}
                      placeholder="Enter your 6-digit code"
                      className="w-full h-12 text-center text-lg tracking-widest font-mono border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                      maxLength={10}
                      data-testid="input-access-code"
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="pinAccessCode" className="block text-sm font-medium text-slate-700 mb-2">
                        Access Code
                      </label>
                      <Input
                        id="pinAccessCode"
                        type="text"
                        value={pinAccessCode}
                        onChange={(e) => setPinAccessCode(e.target.value)}
                        placeholder="Enter your access code"
                        className="w-full h-12 text-center text-lg tracking-widest font-mono border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                        maxLength={10}
                        data-testid="input-pin-access-code"
                      />
                    </div>
                    <div>
                      <label htmlFor="pin" className="block text-sm font-medium text-slate-700 mb-2">
                        6-Digit PIN
                      </label>
                      <Input
                        id="pin"
                        type="password"
                        value={pin}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setPin(value);
                        }}
                        placeholder="••••••"
                        className="w-full h-12 text-center text-lg tracking-widest font-mono border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                        maxLength={6}
                        data-testid="input-pin-login"
                      />
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-12 bg-[#004AB3] hover:bg-[#003d99] text-white font-semibold text-lg shadow-lg"
                  disabled={isLoading}
                  data-testid="button-verify"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Verifying...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5" />
                      Access My Case
                    </span>
                  )}
                </Button>
              </form>
            )}

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={toggleLoginMode}
                className="text-sm text-[#004AB3] hover:text-[#003d99] hover:underline font-medium"
                data-testid="button-toggle-login-mode"
              >
                {loginMode === "code" && "Login with PIN instead"}
                {loginMode === "pin" && "Login with Verification Code instead"}
                {loginMode === "setup-pin" && "Start over with a different code"}
              </button>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-200">
              <div className="flex items-start gap-3 text-sm text-slate-600">
                <Lock className="h-4 w-4 mt-0.5 text-[#004182]" />
                <p>
                  {loginMode === "code" && "Your verification code was provided by an authorized IBCCF representative. If you don't have a code, please contact your assigned representative."}
                  {loginMode === "pin" && "Your PIN was created when you first accessed your account. If you've forgotten your PIN, please contact your assigned representative."}
                  {loginMode === "setup-pin" && "Choose a PIN you'll remember. This PIN along with your access code will be required for all future logins."}
                </p>
              </div>
            </div>
          </div>

          <p className="text-center text-white/60 text-sm mt-6">
            Protected by enterprise-grade encryption
          </p>
        </div>
      </main>
    </div>
  );
}
