import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Shield, Lock, ArrowLeft, CheckCircle, Key, Fingerprint, Sparkles, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { motion, AnimatePresence } from "framer-motion";

export default function VerifyPlatform() {
  const [accessCode, setAccessCode] = useState("");
  const [pinAccessCode, setPinAccessCode] = useState("");
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<"code" | "pin">("code");
  const [showPin, setShowPin] = useState(false);
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
        const verifyRes = await fetch("/api/cases/verify-access-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCode }),
        });
        
        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          
          if (!verifyData.hasPinSet) {
            sessionStorage.setItem("caseAccessCode", accessCode);
            sessionStorage.setItem("caseId", verifyData.caseId);
            sessionStorage.setItem("requiresPinSetup", "true");
            toast({
              title: "Verification Successful",
              description: "Please set up your security PIN to continue.",
            });
            setLocation("/dashboard");
          } else {
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

  const securityFeatures = [
    { icon: ShieldCheck, text: "256-bit encryption" },
    { icon: Fingerprint, text: "Biometric ready" },
    { icon: Lock, text: "Secure sessions" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#001a3d] via-[#002d5a] to-[#004182] font-['Public_Sans',sans-serif] relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-radial from-blue-400/5 to-transparent rounded-full" />
      </div>

      <header className="relative z-10 bg-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <Link href="/" className="flex items-center gap-1 sm:gap-2 text-white hover:opacity-80 transition-opacity group">
              <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5 group-hover:-translate-x-1 transition-transform" />
              <span className="font-medium text-sm sm:text-base hidden sm:inline">Back to Home</span>
              <span className="font-medium text-sm sm:hidden">Back</span>
            </Link>
            <motion.div 
              className="flex items-center gap-2"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg sm:text-xl font-bold text-white font-['Merriweather',serif]">IBCCF</span>
            </motion.div>
            <div className="flex items-center gap-2">
              <ThemeToggle className="text-white" />
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex items-center justify-center px-4 py-10 sm:py-16">
        <motion.div 
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-3xl blur-xl" />
            
            <div className="relative bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-3xl shadow-2xl p-6 sm:p-8 border border-white/20">
              <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                <motion.div 
                  className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl"
                  whileHover={{ scale: 1.05, rotate: 5 }}
                  transition={{ type: "spring", stiffness: 300 }}
                >
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={loginMode}
                      initial={{ opacity: 0, scale: 0.5, rotate: -180 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      exit={{ opacity: 0, scale: 0.5, rotate: 180 }}
                      transition={{ duration: 0.3 }}
                    >
                      {loginMode === "code" ? (
                        <Shield className="h-8 w-8 text-white" />
                      ) : (
                        <Fingerprint className="h-8 w-8 text-white" />
                      )}
                    </motion.div>
                  </AnimatePresence>
                </motion.div>
              </div>

              <div className="text-center mt-6 mb-8">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-['Merriweather',serif] mb-2">
                    {loginMode === "code" ? "Secure Verification" : "PIN Authentication"}
                  </h1>
                  <p className="text-slate-600 dark:text-slate-400 text-sm">
                    {loginMode === "code" 
                      ? "Enter your unique verification code to access your case."
                      : "Enter your 6-digit PIN to continue."
                    }
                  </p>
                </motion.div>
              </div>

              <form onSubmit={handleVerify} className="space-y-5">
                <AnimatePresence mode="wait">
                  {loginMode === "code" ? (
                    <motion.div
                      key="code-input"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.2 }}
                    >
                      <label htmlFor="accessCode" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Verification Code
                      </label>
                      <div className="relative">
                        <Input
                          id="accessCode"
                          type="text"
                          value={accessCode}
                          onChange={(e) => setAccessCode(e.target.value)}
                          placeholder="Enter your code"
                          className="w-full h-14 text-center text-xl tracking-[0.5em] font-mono bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 rounded-xl transition-all"
                          maxLength={10}
                          data-testid="input-access-code"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                          <Key className="w-5 h-5" />
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="pin-input"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                    >
                      <label htmlFor="pin" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        6-Digit PIN
                      </label>
                      <div className="relative">
                        <Input
                          id="pin"
                          type={showPin ? "text" : "password"}
                          value={pin}
                          onChange={(e) => {
                            const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                            setPin(value);
                          }}
                          placeholder="••••••"
                          className="w-full h-14 text-center text-2xl tracking-[0.8em] font-mono bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 rounded-xl transition-all pr-12"
                          maxLength={6}
                          data-testid="input-pin-login"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPin(!showPin)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                      <div className="flex justify-center gap-2 mt-3">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                          <motion.div
                            key={i}
                            className={`w-3 h-3 rounded-full transition-all ${
                              i < pin.length 
                                ? 'bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg' 
                                : 'bg-slate-200 dark:bg-slate-700'
                            }`}
                            animate={{ scale: i === pin.length - 1 && pin.length > 0 ? [1, 1.3, 1] : 1 }}
                            transition={{ duration: 0.2 }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
                  <Button
                    type="submit"
                    className="w-full h-14 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-lg rounded-xl shadow-lg shadow-blue-500/25 transition-all"
                    disabled={isLoading}
                    data-testid="button-verify"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-3">
                        <motion.div 
                          className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                        />
                        Verifying...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5" />
                        Access My Case
                      </span>
                    )}
                  </Button>
                </motion.div>
              </form>

              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={toggleLoginMode}
                  className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium transition-colors"
                  data-testid="button-toggle-login-mode"
                >
                  {loginMode === "code" ? (
                    <>
                      <Fingerprint className="w-4 h-4" />
                      Login with PIN instead
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4" />
                      Login with Verification Code instead
                    </>
                  )}
                </button>
              </div>

              <div className="mt-6">
                <Link href="/request-access">
                  <Button 
                    variant="outline" 
                    className="w-full h-12 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-all" 
                    data-testid="button-request-access"
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Don't have a code? Request Access
                  </Button>
                </Link>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                <div className="flex justify-center gap-6">
                  {securityFeatures.map((feature, idx) => (
                    <motion.div 
                      key={idx}
                      className="flex flex-col items-center gap-1 text-center"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 + idx * 0.1 }}
                    >
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center">
                        <feature.icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{feature.text}</span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <motion.p 
            className="text-center text-white/60 text-sm mt-6 flex items-center justify-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <Lock className="w-4 h-4" />
            Protected by enterprise-grade encryption
          </motion.p>
        </motion.div>
      </main>

      <footer className="relative z-10 py-6">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-white/40 text-xs">
            International Blockchain Community Complaints Forum. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
