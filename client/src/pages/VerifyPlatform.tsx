import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Shield, Lock, ArrowLeft, Key, Fingerprint, Sparkles, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BuildStampLine } from "@/components/BuildStampLine";
import { motion, AnimatePresence } from "framer-motion";
import { setPortalToken } from "@/lib/portalSession";
import { useTranslation } from "react-i18next";

export default function VerifyPlatform() {
  const { t } = useTranslation("landing");
  const tv = (k: string) => t(`verify.${k}`);
  const tt = (k: string) => t(`verify.toast.${k}`);
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
          title: tt("errorTitle"),
          description: tt("missingCode"),
        });
        return;
      }

      setIsLoading(true);
      try {
        const verifyRes = await fetch("/api/cases/verify-access-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCode: accessCode.trim() }),
        });
        
        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          
          if (!verifyData.hasPinSet) {
            sessionStorage.setItem("caseAccessCode", accessCode);
            sessionStorage.setItem("caseId", verifyData.caseId);
            sessionStorage.setItem("requiresPinSetup", "true");
            toast({
              title: tt("verifySuccessTitle"),
              description: tt("verifySuccessDesc"),
            });
            setLocation("/dashboard");
          } else {
            toast({
              title: tt("pinRequiredTitle"),
              description: tt("pinRequiredDesc"),
            });
            setLoginMode("pin");
            setPinAccessCode(accessCode);
          }
        } else {
          toast({
            variant: "destructive",
            title: tt("invalidCodeTitle"),
            description: tt("invalidCodeDesc"),
          });
        }
      } catch (_e) {
        toast({
          variant: "destructive",
          title: tt("connectionTitle"),
          description: tt("connectionDesc"),
        });
      } finally {
        setIsLoading(false);
      }
    } else if (loginMode === "pin") {
      if (!pinAccessCode.trim()) {
        toast({
          variant: "destructive",
          title: tt("errorTitle"),
          description: tt("missingAccess"),
        });
        return;
      }
      if (!pin.trim() || pin.length !== 6) {
        toast({
          variant: "destructive",
          title: tt("errorTitle"),
          description: tt("missingPin"),
        });
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch("/api/cases/login-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCode: pinAccessCode.trim(), pin }),
        });
        
        if (res.ok) {
          const data = await res.json();
          sessionStorage.setItem("caseAccessCode", data.accessCode);
          sessionStorage.setItem("caseId", data.id);
          sessionStorage.setItem("pinVerified", "true");
          sessionStorage.removeItem("requiresPinSetup");
          if (data.sessionToken) {
            setPortalToken(data.sessionToken);
          }
          const params = new URLSearchParams(window.location.search);
          const redirectTo = params.get("redirect");
          setLocation(redirectTo || "/dashboard");
        } else {
          const errorData = await res.json();
          toast({
            variant: "destructive",
            title: tt("invalidPinTitle"),
            description: errorData.error || tt("invalidPinDesc"),
          });
        }
      } catch (_e) {
        toast({
          variant: "destructive",
          title: tt("connectionTitle"),
          description: tt("connectionDesc"),
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
    { icon: ShieldCheck, text: tv("feature256") },
    { icon: Fingerprint, text: tv("featureBio") },
    { icon: Lock, text: tv("featureSession") },
  ];

  return (
    <div className="min-h-screen verification-bg font-['Public_Sans',sans-serif] relative overflow-hidden">
      {/* ── HDR 3D Background System ─────────────────────────────────────────── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:block hidden">

        {/* Atmospheric depth hazes */}
        <div style={{
          position: "absolute", top: "-35%", left: "-15%", width: "75%", height: "75%",
          background: "radial-gradient(ellipse, rgba(0,90,230,0.38) 0%, rgba(0,50,160,0.15) 45%, transparent 70%)",
          filter: "blur(90px)", animation: "orb-drift-1 20s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", bottom: "-25%", right: "-10%", width: "65%", height: "65%",
          background: "radial-gradient(ellipse, rgba(80,20,240,0.28) 0%, rgba(60,0,180,0.1) 45%, transparent 70%)",
          filter: "blur(110px)", animation: "orb-drift-2 25s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", top: "30%", right: "-5%", width: "50%", height: "60%",
          background: "radial-gradient(ellipse, rgba(0,170,220,0.18) 0%, transparent 65%)",
          filter: "blur(80px)", animation: "orb-drift-3 17s ease-in-out infinite 3s",
        }} />

        {/* Aurora bands */}
        <div style={{
          position: "absolute", top: "8%", left: "-10%", right: "-10%", height: "260px",
          background: "linear-gradient(180deg, transparent, rgba(0,120,255,0.14) 40%, rgba(0,80,200,0.08) 70%, transparent)",
          filter: "blur(32px)", transform: "rotate(-3deg)",
          animation: "aurora-shift 14s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", bottom: "12%", left: "-10%", right: "-10%", height: "200px",
          background: "linear-gradient(180deg, transparent, rgba(100,40,255,0.12) 40%, rgba(60,0,200,0.07) 70%, transparent)",
          filter: "blur(28px)", transform: "rotate(2deg)",
          animation: "aurora-shift-2 18s ease-in-out infinite 2s",
        }} />

        {/* HDR neon focal points */}
        <div style={{
          position: "absolute", top: "12%", left: "58%", width: "280px", height: "280px",
          background: "radial-gradient(circle, rgba(0,160,255,0.55) 0%, rgba(0,100,220,0.2) 40%, transparent 68%)",
          filter: "blur(38px)", animation: "orb-drift-3 8s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", top: "55%", left: "15%", width: "200px", height: "200px",
          background: "radial-gradient(circle, rgba(80,210,255,0.45) 0%, rgba(0,160,230,0.15) 45%, transparent 68%)",
          filter: "blur(28px)", animation: "orb-drift-1 10s ease-in-out infinite 1s",
        }} />
        <div style={{
          position: "absolute", bottom: "20%", right: "20%", width: "160px", height: "160px",
          background: "radial-gradient(circle, rgba(140,80,255,0.4) 0%, transparent 65%)",
          filter: "blur(22px)", animation: "orb-drift-2 11s ease-in-out infinite 2.5s",
        }} />

        {/* Depth grid */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: [
            "linear-gradient(rgba(255,255,255,0.032) 1px, transparent 1px)",
            "linear-gradient(90deg, rgba(255,255,255,0.032) 1px, transparent 1px)",
          ].join(","),
          backgroundSize: "52px 52px",
          animation: "grid-breathe 7s ease-in-out infinite",
        }} />

        {/* HDR scan line */}
        <div style={{
          position: "absolute", left: 0, right: 0, height: "1px",
          background: "linear-gradient(90deg, transparent 5%, rgba(0,180,255,0.65) 35%, rgba(120,220,255,0.8) 50%, rgba(0,180,255,0.65) 65%, transparent 95%)",
          boxShadow: "0 0 12px 3px rgba(0,160,255,0.3)",
          animation: "hdr-scan 10s ease-in-out infinite",
        }} />

        {/* Star field */}
        {([
          { top: "7%",  left: "10%",  delay: "0s",    size: 1.5 },
          { top: "14%", left: "71%",  delay: "0.7s",  size: 1 },
          { top: "23%", left: "42%",  delay: "1.4s",  size: 2 },
          { top: "34%", left: "87%",  delay: "2.1s",  size: 1 },
          { top: "43%", left: "5%",   delay: "0.3s",  size: 1.5 },
          { top: "59%", left: "54%",  delay: "1.8s",  size: 1 },
          { top: "66%", left: "29%",  delay: "0.9s",  size: 2 },
          { top: "73%", left: "79%",  delay: "2.4s",  size: 1 },
          { top: "83%", left: "17%",  delay: "1.1s",  size: 1.5 },
          { top: "89%", left: "61%",  delay: "0.5s",  size: 1 },
          { top: "4%",  left: "91%",  delay: "1.6s",  size: 1 },
          { top: "49%", left: "96%",  delay: "2.8s",  size: 1.5 },
        ] as const).map((s, i) => (
          <div key={i} style={{
            position: "absolute", top: s.top, left: s.left,
            width: `${s.size}px`, height: `${s.size}px`,
            borderRadius: "50%", background: "rgba(180,220,255,0.9)",
            boxShadow: `0 0 ${s.size * 3}px rgba(100,180,255,0.7)`,
            animation: `star-twinkle ${2.5 + i * 0.3}s ease-in-out infinite`,
            animationDelay: s.delay,
          }} />
        ))}

        {/* Radial vignette */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at 50% 50%, transparent 38%, rgba(2,9,18,0.55) 80%, rgba(2,9,18,0.85) 100%)",
        }} />

        {/* Top edge light bleed */}
        <div style={{
          position: "absolute", top: 0, left: "15%", right: "15%", height: "3px",
          background: "linear-gradient(90deg, transparent, rgba(0,140,255,0.7) 30%, rgba(100,200,255,1) 50%, rgba(0,140,255,0.7) 70%, transparent)",
          boxShadow: "0 0 30px 8px rgba(0,120,255,0.35)",
        }} />
      </div>

      {/* Light mode subtle blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
      </div>

      <header className="relative z-10 bg-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <Link href="/" className="flex items-center gap-1 sm:gap-2 text-slate-700 dark:text-white hover:opacity-80 transition-opacity group">
              <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5 group-hover:-translate-x-1 transition-transform" />
              <span className="font-medium text-sm sm:text-base hidden sm:inline">{tv("back")}</span>
              <span className="font-medium text-sm sm:hidden">{tv("backShort")}</span>
            </Link>
            <motion.div 
              className="flex items-center gap-2"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg sm:text-xl font-bold text-slate-800 dark:text-white font-['Merriweather',serif]">IBCCF</span>
            </motion.div>
            <div className="flex items-center gap-2">
              <ThemeToggle className="text-slate-600 dark:text-white" />
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="relative z-10 flex items-center justify-center px-4 py-10 sm:py-16">
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
                    {loginMode === "code" ? tv("titleCode") : tv("titlePin")}
                  </h1>
                  <p className="text-slate-600 dark:text-slate-400 text-sm">
                    {loginMode === "code" ? tv("subtitleCode") : tv("subtitlePin")}
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
                        {tv("labelCode")}
                      </label>
                      <div className="relative">
                        <Input
                          id="accessCode"
                          type="text"
                          value={accessCode}
                          onChange={(e) => setAccessCode(e.target.value)}
                          placeholder={tv("placeholderCode")}
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
                        {tv("labelPin")}
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
                        {tv("submitting")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5" />
                        {tv("submit")}
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
                      {tv("switchToPin")}
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4" />
                      {tv("switchToCode")}
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
                    {tv("requestAccess")}
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
            className="text-center text-slate-500 dark:text-white/60 text-sm mt-6 flex items-center justify-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <Lock className="w-4 h-4" />
            {tv("encrypted")}
          </motion.p>
        </motion.div>
      </main>

      <footer className="relative z-10 py-6">
        <div className="max-w-7xl mx-auto px-4 text-center flex flex-col items-center gap-2">
          <p className="text-slate-400 dark:text-white/40 text-xs">
            {t("footer.fullName")}
          </p>
          <BuildStampLine className="text-slate-400 dark:text-white/40" />
        </div>
      </footer>
    </div>
  );
}
