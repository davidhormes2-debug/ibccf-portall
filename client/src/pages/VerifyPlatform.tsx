import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Shield, Lock, ArrowLeft, CheckCircle, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function VerifyPlatform() {
  const [accessCode, setAccessCode] = useState("");
  const [pinAccessCode, setPinAccessCode] = useState("");
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<"code" | "pin">("code");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

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
            // PIN not set - redirect to dashboard for registration (which includes PIN setup)
            sessionStorage.setItem("caseAccessCode", accessCode);
            sessionStorage.setItem("caseId", verifyData.caseId);
            sessionStorage.setItem("requiresPinSetup", "true");
            // Do NOT set pinVerified - they must set up PIN first
            toast({
              title: "Verification Successful",
              description: "Please set up your security PIN to continue.",
            });
            setLocation("/dashboard");
          } else {
            // PIN already set - they should use PIN login
            toast({
              title: "PIN Required",
              description: "Please enter your PIN to access your account.",
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
          sessionStorage.setItem("pinVerified", "true");
          // Clear any pending PIN setup flag
          sessionStorage.removeItem("requiresPinSetup");
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
    setLoginMode(prev => prev === "code" ? "pin" : "code");
    setAccessCode("");
    setPinAccessCode("");
    setPin("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#004182] to-[#002d5a] font-['Public_Sans',sans-serif]">
      {/* Header */}
      <header className="bg-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <Link href="/" className="flex items-center gap-1 sm:gap-2 text-white hover:opacity-80 transition-opacity">
              <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
              <span className="font-medium text-sm sm:text-base hidden sm:inline">Back to Home</span>
              <span className="font-medium text-sm sm:hidden">Back</span>
            </Link>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              <span className="text-lg sm:text-xl font-bold text-white font-['Merriweather',serif]">IBCCF</span>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle className="text-white" />
              <div className="hidden sm:flex items-center gap-2 text-sm text-white/80">
                <Lock className="h-4 w-4" />
                <span>Secure Access</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex items-center justify-center px-4 py-10 sm:py-20">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-[#004182]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                {loginMode === "code" ? (
                  <Shield className="h-8 w-8 text-[#004182]" />
                ) : (
                  <Key className="h-8 w-8 text-[#004182]" />
                )}
              </div>
              <h1 className="text-2xl font-bold text-[#0F172B] font-['Merriweather',serif] mb-2">
                Secure Verification Portal
              </h1>
              <p className="text-slate-600">
                {loginMode === "code" 
                  ? "Enter your unique verification code to access your case dashboard and official documentation."
                  : "Enter your 6-digit PIN to securely access your case dashboard."
                }
              </p>
            </div>

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

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={toggleLoginMode}
                className="text-sm text-[#004AB3] hover:text-[#003d99] hover:underline font-medium"
                data-testid="button-toggle-login-mode"
              >
                {loginMode === "code" 
                  ? "Login with PIN instead" 
                  : "Login with Verification Code instead"
                }
              </button>
            </div>

            <div className="mt-6 text-center">
              <Link href="/request-access">
                <Button variant="outline" className="w-full border-[#004182]/30 text-[#004182] hover:bg-[#004182]/5" data-testid="button-request-access">
                  <Key className="w-4 h-4 mr-2" />
                  Don't have a code? Request Access
                </Button>
              </Link>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="flex items-start gap-3 text-sm text-slate-600">
                <Lock className="h-4 w-4 mt-0.5 text-[#004182]" />
                <p>
                  {loginMode === "code"
                    ? "Your verification code was provided by an authorized IBCCF representative. If you don't have a code, you can request access above."
                    : "Your PIN was created when you first accessed your account. If you've forgotten your PIN, please contact your assigned representative."
                  }
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
