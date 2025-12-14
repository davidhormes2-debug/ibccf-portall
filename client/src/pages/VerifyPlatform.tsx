import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Shield, Lock, ArrowLeft, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function VerifyPlatform() {
  const [accessCode, setAccessCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const res = await fetch(`/api/cases/access/${accessCode}`);
      if (res.ok) {
        const data = await res.json();
        sessionStorage.setItem("caseAccessCode", accessCode);
        sessionStorage.setItem("caseId", data.id);
        setLocation("/dashboard");
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
                <Shield className="h-8 w-8 text-[#004182]" />
              </div>
              <h1 className="text-2xl font-bold text-[#0F172B] font-['Merriweather',serif] mb-2">
                Secure Verification Portal
              </h1>
              <p className="text-slate-600">
                Enter your unique verification code to access your case dashboard and official documentation.
              </p>
            </div>

            <form onSubmit={handleVerify} className="space-y-6">
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

            <div className="mt-8 pt-6 border-t border-slate-200">
              <div className="flex items-start gap-3 text-sm text-slate-600">
                <Lock className="h-4 w-4 mt-0.5 text-[#004182]" />
                <p>
                  Your verification code was provided by an authorized IBCCF representative. If you don't have a code, please contact your assigned representative.
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
