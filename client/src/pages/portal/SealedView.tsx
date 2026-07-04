import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ShieldCheck,
  Lock,
  Download,
  Loader2,
  AlertTriangle,
  FileCheck2,
  Fingerprint,
} from "lucide-react";
import { PortalSkeleton } from "@/components/portal/PortalSkeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";
import { StampDutyView } from "./StampDutyView";
import { getPortalToken } from "@/lib/portalSession";
import {
  NDA_DEFAULT_LOCALE,
  NDA_SIGNING_LOCALES_DEFAULT,
  NDA_SUPPORTED_LOCALES,
  NDA_TRANSLATIONS_REVIEWED,
  effectiveSigningLocale,
  isSigningLocaleAllowed,
  normalizeNdaLocale,
  type NdaLocale,
  type NdaRendered,
} from "@shared/ndaTemplate";
import { useLocale } from "@/i18n/useLocale";
import { SUPPORTED_LOCALES } from "@/i18n";
import { Trans, useTranslation } from "react-i18next";

// Short note displayed (in the user's portal locale) when the live
// signing allowlist is English-only, explaining why the picker is
// locked to English. Inlined here so the flag can ship without
// coordinating translation-JSON updates across all six locales — the
// rest of the portal continues to render in the user's chosen language.
const ENGLISH_ONLY_NOTE: Record<string, string> = {
  en: "Signing is temporarily English-only while the translated versions of this document are under legal review. The rest of your portal stays in your chosen language.",
  es: "La firma está temporalmente disponible sólo en inglés mientras las traducciones de este documento se encuentran en revisión legal. El resto de su portal permanece en el idioma que ha elegido.",
  fr: "La signature est temporairement disponible uniquement en anglais, le temps que les traductions de ce document soient validées par le service juridique. Le reste de votre portail reste dans la langue de votre choix.",
  de: "Die Unterzeichnung ist vorübergehend nur auf Englisch möglich, solange die Übersetzungen dieses Dokuments rechtlich geprüft werden. Der übrige Teil Ihres Portals bleibt in Ihrer gewählten Sprache.",
  pt: "A assinatura está temporariamente disponível apenas em inglês enquanto as traduções deste documento estão em análise jurídica. O restante do seu portal permanece no idioma que você escolheu.",
  zh: "在该文件的译文接受法律审核期间，签署暂时仅以英文进行。门户的其余部分仍以您所选择的语言显示。",
};

// Same idea, but for the case where SOME additional locales are
// approved but not all six. Shown under the picker so signers know
// the missing languages are still in legal review.
const PARTIAL_LOCALES_NOTE: Record<string, string> = {
  en: "Only the languages listed here have completed legal review. The remaining translations of this document are still under review.",
  es: "Sólo los idiomas indicados aquí han completado la revisión legal. Las demás traducciones de este documento siguen en revisión.",
  fr: "Seules les langues indiquées ici ont terminé la revue juridique. Les autres traductions de ce document sont encore en cours de revue.",
  de: "Nur die hier aufgeführten Sprachen haben die rechtliche Prüfung abgeschlossen. Die übrigen Übersetzungen dieses Dokuments werden noch geprüft.",
  pt: "Apenas os idiomas listados aqui concluíram a análise jurídica. As demais traduções deste documento ainda estão em análise.",
  zh: "仅此处列出的语言已完成法律审核，该文件的其他译文仍在审核中。",
};

// Per-document signing language picker. Defaults to the user's active
// portal locale (clamped to the set of locales the NDA template ships
// translations for) but is intentionally independent of the global
// LanguageSwitcher: a bilingual recipient can browse the portal in one
// language and sign the legal document in another without changing
// cases.preferred_locale (which still drives portal chrome + emails).
const DOC_LOCALE_LABELS: Record<NdaLocale, string> = (() => {
  const out = {} as Record<NdaLocale, string>;
  for (const code of NDA_SUPPORTED_LOCALES) {
    const meta = SUPPORTED_LOCALES.find((l) => l.code === code);
    out[code] = meta ? `${meta.nativeLabel} (${meta.label})` : code;
  }
  return out;
})();

interface NdaState {
  eligible: boolean;
  signed: boolean;
  sealed: boolean;
  // True when the admin has flipped `cases.nda_enabled` to false for
  // this case — the server short-circuits before rendering the NDA
  // body, so `rendered` is omitted and the portal shows a bypass card
  // instead of the typed-signature flow.
  ndaSkipped?: boolean;
  templateVersion?: string;
  // Live signing-locale allowlist returned by the server (Task #88,
  // the sole source of truth for which languages may be signed in).
  // Omitted on signed-snapshot responses since the picker is hidden
  // after sealing — we treat `undefined` as "fall back to the compile-
  // time default" rather than re-deriving it for sealed cases.
  signingLocales?: NdaLocale[];
  contentHash?: string;
  signedAt?: string;
  signedName?: string;
  rendered?: NdaRendered;
}

export function SealedView() {
  const { currentCase } = usePortal();
  const { toast } = useToast();
  const { t } = useTranslation("portal");
  const { locale: portalLocale } = useLocale();
  const portalLocaleCode = portalLocale.code;
  const [state, setState] = useState<NdaState | null>(null);
  const [loading, setLoading] = useState(true);
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Per-document locale, defaulting to the active portal locale clamped
  // to a language the NDA template actually ships translations for AND
  // that is currently on the signing allowlist. We seed against the
  // compile-time default allowlist and then reconcile against the live
  // `signingLocales` returned by the server on the first NDA fetch
  // (Task #88 — runtime-tunable per-language allowlist) so the picker
  // never shows a stale value, even if a freshly-signed-in user lands
  // on this screen before the allowlist is re-fetched.
  const [docLocale, setDocLocale] = useState<NdaLocale>(() => {
    const portalGuess = normalizeNdaLocale(portalLocaleCode);
    return isSigningLocaleAllowed(portalGuess, NDA_SIGNING_LOCALES_DEFAULT)
      ? portalGuess
      : NDA_DEFAULT_LOCALE;
  });

  // Live signing-locale allowlist — reconciled against whatever the
  // server returned on the most recent NDA fetch (Task #88). Falls back
  // to the compile-time default while the first response is in flight.
  const signingLocales = useMemo<NdaLocale[]>(() => {
    const list = state?.signingLocales;
    if (Array.isArray(list) && list.length > 0) return list;
    return [...NDA_SIGNING_LOCALES_DEFAULT];
  }, [state?.signingLocales]);
  const englishOnly =
    signingLocales.length === 1 && signingLocales[0] === NDA_DEFAULT_LOCALE;

  // If the live allowlist excludes whatever the picker is currently
  // showing (e.g. because the admin just narrowed the list, or a stale
  // mount started with a portal-locale guess the server later rejected),
  // collapse to English so the user never signs in an unapproved
  // language. English is always permitted by the server-side resolver.
  useEffect(() => {
    if (!isSigningLocaleAllowed(docLocale, signingLocales)) {
      setDocLocale(NDA_DEFAULT_LOCALE);
    }
  }, [signingLocales, docLocale]);

  const caseId = currentCase?.id;
  const authHeaders = useMemo(() => {
    const tok = getPortalToken();
    return tok
      ? ({ "x-portal-session-token": tok } as Record<string, string>)
      : ({} as Record<string, string>);
  }, []);

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    (async () => {
      // Only show the full-page spinner on the first fetch; subsequent
      // refetches triggered by the locale picker re-render in place
      // without flashing the loader.
      if (!state) setLoading(true);
      try {
        // Once the case is sealed the server always serves the
        // signed-snapshot locale verbatim, so the ?locale= override is
        // a no-op there and we omit it to keep the URL clean.
        const url = state?.signed
          ? `/api/cases/${caseId}/nda`
          : `/api/cases/${caseId}/nda?locale=${encodeURIComponent(docLocale)}`;
        const res = await fetch(url, { headers: authHeaders });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as NdaState;
        if (!cancelled) setState(data);
      } catch (e) {
        if (!cancelled) {
          toast({
            title: t("sealed.loadFailedTitle"),
            description: e instanceof Error ? e.message : t("sealed.unknownError"),
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // We intentionally depend on docLocale so changing the picker
    // refetches the rendered preview. state.signed is read inside but
    // does not need to retrigger — once signed, the snapshot is fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, authHeaders, toast, docLocale]);

  const handleDownload = async () => {
    if (!caseId) return;
    try {
      // Honour the picker for unsigned previews; once signed, omit the
      // override so the server returns the stored snapshot bytes
      // verbatim (any query string would be ignored anyway, but this
      // keeps the URL truthful).
      const pdfUrl = state?.signed
        ? `/api/cases/${caseId}/nda/pdf`
        : `/api/cases/${caseId}/nda/pdf?locale=${encodeURIComponent(docLocale)}`;
      const res = await fetch(pdfUrl, { headers: authHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = state?.signed
        ? `IBCCF-Sealed-Settlement-${caseId}.pdf`
        : `IBCCF-Settlement-Preview-${caseId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: t("sealed.downloadFailedTitle"),
        description: e instanceof Error ? e.message : t("sealed.unknownError"),
        variant: "destructive",
      });
    }
  };

  const handleSign = async () => {
    if (!caseId) return;
    if (!agreed || typedName.trim().length < 2) {
      toast({
        title: t("sealed.toasts.completeTitle"),
        description: t("sealed.toasts.completeDesc"),
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/nda/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          typedName: typedName.trim(),
          agreed: true,
          // Persist the per-document language into the snapshot so any
          // future re-render hashes identically to the bytes signed.
          locale: docLocale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast({
        title: data.alreadySigned ? t("sealed.toasts.alreadyTitle") : t("sealed.toasts.sealedTitle"),
        description: data.alreadySigned
          ? t("sealed.toasts.alreadyDesc")
          : t("sealed.toasts.sealedDesc"),
      });
      // Reload state to show success view + sealed banner everywhere.
      const refresh = await fetch(`/api/cases/${caseId}/nda`, { headers: authHeaders });
      if (refresh.ok) setState(await refresh.json());
    } catch (e) {
      toast({
        title: t("sealed.toasts.failedTitle"),
        description: e instanceof Error ? e.message : t("sealed.unknownError"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <PortalSkeleton variant="list" count={3} />;
  }

  // Admin has disabled the NDA requirement for this case. Render a
  // clear bypass notice instead of the typed-signature flow.
  if (state?.ndaSkipped) {
    return (
      <Card
        className="border-indigo-500/40 bg-indigo-500/5"
        data-testid="nda-skipped-card"
      >
        <CardContent className="flex items-start gap-3 p-6">
          <ShieldCheck className="h-6 w-6 shrink-0 text-indigo-300" />
          <div>
            <h2 className="text-lg font-semibold">
              {t("sealed.skippedTitle")}
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              {t("sealed.skippedBody")}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!state?.eligible) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 p-6">
          <AlertTriangle className="h-6 w-6 shrink-0 text-amber-400" />
          <div>
            <h2 className="text-lg font-semibold">{t("sealed.notYetTitle")}</h2>
            <p className="mt-1 text-sm text-slate-300">
              {t("sealed.notYetBody")}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Task #72 — Stamp Duty Deposit gate. The NDA cannot be signed until
  // an admin approves a stamp-duty receipt. Intercept here, AFTER the
  // eligibility check (so pre-stage-14 cases still see "not yet"), but
  // BEFORE the signing form so a stale client can't try to POST. The
  // server enforces the same condition in /:id/nda/sign — this is the
  // friendly UX surface, not the security boundary.
  // We intercept only when stamp duty is *explicitly* enabled on the
  // case (the schema default is true, the access-code allowlist
  // propagates it, so real cases will always have a definitive value).
  // Treating `undefined` as "not blocking" keeps legacy fixtures and
  // any future opt-in path safe; the server-side gate in POST
  // /:id/nda/sign remains the actual security boundary.
  const stampDutyBlocking =
    !state.signed &&
    currentCase?.stampDutyEnabled === true &&
    (currentCase.stampDutyStatus ?? "awaiting_upload") !== "approved";
  if (stampDutyBlocking) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" />
            <div className="text-sm text-slate-200">
              <div className="font-semibold text-amber-100">
                {t("sealed.stampDutyGateTitle")}
              </div>
              <p className="mt-1 text-slate-300">
                {t("sealed.stampDutyGateBody")}
              </p>
            </div>
          </CardContent>
        </Card>
        <StampDutyView embedded />
      </div>
    );
  }

  // Safe non-null assertion: the only code paths that produce a state
  // without `rendered` are the `!eligible` and `ndaSkipped` branches
  // above, both of which return before we reach this line.
  const r = state.rendered!;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {state.signed && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5"
        >
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-emerald-200">
                {t("sealed.sealedTitle")}
              </h2>
              <p className="mt-1 text-sm text-emerald-100/80">
                <Trans
                  i18nKey="sealed.signedBy"
                  ns="portal"
                  values={{
                    name: state.signedName ?? "",
                    date: state.signedAt ? new Date(state.signedAt).toUTCString() : "",
                  }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <div className="mt-3 rounded-lg border border-emerald-500/30 bg-black/30 p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-300/80">
                  {t("sealed.integrityHash")}
                </div>
                <div className="mt-1 break-all font-mono text-xs text-emerald-100">
                  {state.contentHash}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <Card className="overflow-hidden border-indigo-500/30 bg-gradient-to-br from-slate-900 to-slate-950">
        <div className="border-b border-indigo-500/20 bg-indigo-500/5 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Lock className="h-5 w-5 text-indigo-300" />
              <div>
                <h1 className="text-base font-semibold">{r.title}</h1>
                <p className="text-xs text-slate-400">
                  {t("sealed.templateMeta", { subtitle: r.subtitle, version: state.templateVersion })}
                </p>
              </div>
            </div>
            <Badge variant="secondary" className="font-mono text-[10px]">
              {r.effectiveDateLabel}
            </Badge>
          </div>
        </div>

        <CardContent className="space-y-6 px-6 py-6 text-sm leading-relaxed text-slate-200">
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-indigo-300">
              {t("sealed.partiesHeading")}
            </h3>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[200px_1fr]">
              {r.partyBlock.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-slate-400">{row.label}</dt>
                  <dd className="font-medium text-slate-100">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="space-y-2 border-l-2 border-indigo-500/40 pl-4 italic text-slate-300">
            {r.recitals.map((p, i) => (<p key={i}>{p}</p>))}
          </section>

          {r.sections.map((sec) => (
            <section key={sec.heading}>
              <h3 className="mb-2 font-semibold text-indigo-200">{sec.heading}</h3>
              {sec.paragraphs.map((p, i) => (
                <p key={i} className="mb-2 text-slate-300">{p}</p>
              ))}
            </section>
          ))}

          <section className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4">
            <div className="flex items-start gap-3">
              <Fingerprint className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" />
              <p className="text-sm text-indigo-100">{r.acknowledgement}</p>
            </div>
          </section>
        </CardContent>
      </Card>

      {!state.signed ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="space-y-4 p-6">
            {!NDA_TRANSLATIONS_REVIEWED && !englishOnly && docLocale !== "en" && (
              <div
                role="note"
                data-testid="nda-translation-disclaimer"
                className="flex items-start gap-3 rounded-lg border border-amber-400/60 bg-amber-500/10 p-4"
              >
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div className="text-sm">
                  <div className="font-semibold text-amber-100">
                    {t("nda.translationDisclaimer.title")}
                  </div>
                  <p className="mt-1 text-amber-100/90">
                    {t("nda.translationDisclaimer.body")}
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-amber-300" />
              <h2 className="text-base font-semibold">{t("sealed.signToSeal")}</h2>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nda-doc-locale">{t("sealed.documentLanguage")}</Label>
              <Select
                value={
                  isSigningLocaleAllowed(docLocale, signingLocales)
                    ? docLocale
                    : NDA_DEFAULT_LOCALE
                }
                onValueChange={(v) =>
                  setDocLocale(
                    effectiveSigningLocale(v, signingLocales) ??
                      normalizeNdaLocale(v),
                  )
                }
                disabled={submitting || englishOnly}
              >
                <SelectTrigger id="nda-doc-locale" className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NDA_SUPPORTED_LOCALES.filter((code) =>
                    isSigningLocaleAllowed(code, signingLocales),
                  ).map((code) => (
                    <SelectItem key={code} value={code}>
                      {DOC_LOCALE_LABELS[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {englishOnly ? (
                <p className="text-xs text-amber-300/90">
                  {ENGLISH_ONLY_NOTE[portalLocaleCode] ?? ENGLISH_ONLY_NOTE.en}
                </p>
              ) : signingLocales.length < NDA_SUPPORTED_LOCALES.length ? (
                <p className="text-xs text-amber-300/90">
                  {PARTIAL_LOCALES_NOTE[portalLocaleCode] ??
                    PARTIAL_LOCALES_NOTE.en}
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  {t("sealed.documentLanguageNote")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="nda-typed-name">{r.signatureBlockLabels.typedName}</Label>
              <Input
                id="nda-typed-name"
                placeholder={t("sealed.typedNamePlaceholder")}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                disabled={submitting}
                maxLength={120}
              />
              <p className="text-xs text-slate-400">
                {t("sealed.typedNameHint")}
              </p>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                disabled={submitting}
              />
              <span className="text-slate-200">
                {t("sealed.agreeBody")}
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleSign} disabled={submitting || !agreed || typedName.trim().length < 2}>
                {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("sealed.sealing")}</>)
                            : t("sealed.signAndSeal")}
              </Button>
              <Button variant="outline" onClick={handleDownload} disabled={submitting}>
                <Download className="mr-2 h-4 w-4" />
                {t("sealed.previewPdf")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            {t("sealed.downloadSigned")}
          </Button>
        </div>
      )}
    </div>
  );
}
