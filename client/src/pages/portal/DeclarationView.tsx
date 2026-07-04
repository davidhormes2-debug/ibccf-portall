import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useTranslation, Trans } from "react-i18next";
import { useFormat } from "@/i18n/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";
import { LocalizedAmount } from "@/components/portal/LocalizedAmount";
import { PayoutWalletBlock } from "@/components/portal/PayoutWalletBlock";
import {
  Scale,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Lock,
  FileSignature,
  Banknote,
  ClipboardCheck,
  UserSquare,
  ArrowLeft,
  Loader2,
  Hourglass,
  Globe2,
  Copy,
  Upload,
  Plus,
  Trash2,
  FileCheck2,
  Paperclip,
  FileText,
} from "lucide-react";

const DOC_ACCEPT_ATTR = "application/pdf,image/png,image/jpeg,image/webp";
const DOC_MAX_BYTES = 10 * 1024 * 1024;
const DOC_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_SUPPORTING_DOCS = 3;

interface AttachmentSlot {
  // local id used as React key + testid
  uid: string;
  category: "proof_of_income" | "custom";
  label: string;
  file: File | null;
  fileData: string | null; // base64 data URL
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

const COUNTRIES = [
  "United States", "United Kingdom", "Canada", "Australia", "Germany",
  "France", "Italy", "Spain", "Netherlands", "Belgium", "Switzerland",
  "Sweden", "Norway", "Denmark", "Finland", "Ireland", "Portugal",
  "Austria", "Poland", "Czech Republic", "Greece", "Japan", "South Korea",
  "Singapore", "Hong Kong", "Taiwan", "United Arab Emirates", "Saudi Arabia",
  "Qatar", "Kuwait", "Bahrain", "Oman", "Israel", "Turkey", "South Africa",
  "Egypt", "Nigeria", "Kenya", "Ghana", "Morocco", "Brazil", "Mexico",
  "Argentina", "Chile", "Colombia", "Peru", "Uruguay", "India", "Pakistan",
  "Bangladesh", "Sri Lanka", "Thailand", "Malaysia", "Philippines",
  "Indonesia", "Vietnam", "New Zealand", "Other",
];

const SOURCE_OF_INCOME_OPTIONS: Array<{ value: string; key: string }> = [
  { value: "Salary / Employment Income", key: "salary" },
  { value: "Business / Self-Employment", key: "business" },
  { value: "Investment Returns (Stocks, Bonds, Funds)", key: "investment" },
  { value: "Cryptocurrency Trading / Investing", key: "crypto" },
  { value: "Real Estate / Property Income", key: "realEstate" },
  { value: "Inheritance / Family Gift", key: "inheritance" },
  { value: "Pension / Retirement Savings", key: "pension" },
  { value: "Sale of Personal Assets", key: "saleAssets" },
  { value: "Other (please specify)", key: "other" },
];


interface FormState {
  fullName: string;
  email: string;
  registeredUsername: string;
  accountId: string;
  countryOfResidence: string;
  dateOfBirth: string;
  accessCode: string;
  notSanctionedJurisdictions: boolean;
  noSanctionedTransactions: boolean;
  acknowledgeUsdtNotSupported: boolean;
  understandFalseInfoConsequences: boolean;
  preferredAsset: string;
  otherSupportedAsset: string;
  // Multi-select — users can pick more than one source of income.
  sourceOfIncomeList: string[];
  sourceOfIncomeOther: string;
  monthlyIncome: string;
  regulatoryAcknowledgment: boolean;
  internationalTermsAcknowledged: boolean;
  processingFeeTxHash: string;
  signatureFullName: string;
  signatureDate: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function DeclarationView() {
  const { t: tDecl } = useTranslation("declaration");
  const { currentCase, declaration, refreshDeclaration, setViewState } = usePortal();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [issuingCode, setIssuingCode] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  // Tracks whether the user attempted submit so inline field errors only
  // show after a failed validation pass — avoids screaming red on first paint.
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Inline declaration attachments — Proof of Source of Income (required)
  // plus up to 3 supporting financial documents. Persisted as
  // document_requests rows on the server in the 'submitted' state.
  const makeUid = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [attachments, setAttachments] = useState<AttachmentSlot[]>(() => [
    {
      uid: makeUid(),
      category: "proof_of_income",
      label: "Proof of Source of Income",
      file: null,
      fileData: null,
    },
  ]);
  // We keep the English label in state for backwards compatibility with the
  // server payload, but render it via t() in the UI.

  const updateAttachment = (
    uid: string,
    patch: Partial<AttachmentSlot>,
  ) =>
    setAttachments((prev) =>
      prev.map((a) => (a.uid === uid ? { ...a, ...patch } : a)),
    );

  const removeAttachment = (uid: string) =>
    setAttachments((prev) => prev.filter((a) => a.uid !== uid));

  const addSupportingSlot = () => {
    const supportingCount = attachments.filter(
      (a) => a.category === "custom",
    ).length;
    if (supportingCount >= MAX_SUPPORTING_DOCS) return;
    setAttachments((prev) => [
      ...prev,
      {
        uid: makeUid(),
        category: "custom",
        label: "",
        file: null,
        fileData: null,
      },
    ]);
  };

  const handleAttachmentFile = async (uid: string, file: File | null) => {
    if (!file) return;
    if (!DOC_ALLOWED_MIME.has(file.type)) {
      toast({
        title: tDecl("toast.unsupportedTypeTitle"),
        description: tDecl("toast.unsupportedTypeDesc"),
        variant: "destructive",
      });
      return;
    }
    if (file.size > DOC_MAX_BYTES) {
      toast({
        title: tDecl("toast.tooLargeTitle"),
        description: tDecl("toast.tooLargeDesc", { size: (file.size / 1024 / 1024).toFixed(1) }),
        variant: "destructive",
      });
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      updateAttachment(uid, { file, fileData: dataUrl });
    } catch {
      toast({
        title: tDecl("toast.couldNotReadTitle"),
        description: tDecl("toast.couldNotReadDesc"),
        variant: "destructive",
      });
    }
  };

  const [form, setForm] = useState<FormState>({
    fullName: currentCase?.userName ?? "",
    email: currentCase?.userEmail ?? "",
    registeredUsername: currentCase?.username ?? "",
    accountId: currentCase?.accessCode ?? "",
    countryOfResidence: "",
    dateOfBirth: "",
    accessCode: "",
    notSanctionedJurisdictions: false,
    noSanctionedTransactions: false,
    acknowledgeUsdtNotSupported: false,
    understandFalseInfoConsequences: false,
    preferredAsset: "USDC (Polygon)",
    otherSupportedAsset: "",
    sourceOfIncomeList: [],
    sourceOfIncomeOther: "",
    monthlyIncome: "",
    regulatoryAcknowledgment: false,
    internationalTermsAcknowledged: false,
    processingFeeTxHash: "",
    signatureFullName: "",
    signatureDate: todayIso(),
  });

  useEffect(() => {
    refreshDeclaration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Already submitted/approved/rejected → show status panel
  const status = declaration?.declarationStatus ?? currentCase?.declarationStatus ?? "not_requested";
  const latest = declaration?.latest ?? null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const allTogglesOn =
    form.notSanctionedJurisdictions &&
    form.noSanctionedTransactions &&
    form.acknowledgeUsdtNotSupported &&
    form.understandFalseInfoConsequences &&
    form.regulatoryAcknowledgment &&
    form.internationalTermsAcknowledged;

  const requiredText = () => {
    const missing: string[] = [];
    if (!form.fullName.trim()) missing.push(tDecl("missing.fullName"));
    if (!form.email.trim()) missing.push(tDecl("missing.email"));
    if (!form.countryOfResidence) missing.push(tDecl("missing.country"));
    if (!form.dateOfBirth) missing.push(tDecl("missing.dob"));
    if (!form.accessCode.trim()) missing.push(tDecl("missing.accessCode"));
    if (form.sourceOfIncomeList.length === 0) missing.push(tDecl("missing.sourceOfIncome"));
    if (form.sourceOfIncomeList.includes("Other (please specify)") && !form.sourceOfIncomeOther.trim()) {
      missing.push(tDecl("missing.sourceOfIncomeOther"));
    }
    if (!form.monthlyIncome) missing.push(tDecl("missing.monthlyIncome"));
    if (!form.processingFeeTxHash.trim() || form.processingFeeTxHash.trim().length < 10) {
      missing.push(tDecl("missing.txHash"));
    }
    if (!form.signatureFullName.trim()) missing.push(tDecl("missing.signature"));
    if (!form.signatureDate) missing.push(tDecl("missing.signatureDate"));
    if (!allTogglesOn) missing.push(tDecl("missing.allConfirmations"));
    const psoi = attachments.find((a) => a.category === "proof_of_income");
    if (!psoi || !psoi.fileData) missing.push(tDecl("missing.psoi"));
    for (const att of attachments) {
      if (att.category === "custom" && att.file && !att.label.trim()) {
        missing.push(tDecl("missing.supportingLabel"));
        break;
      }
    }
    return missing;
  };

  const submit = async () => {
    if (!currentCase) return;
    setSubmitAttempted(true);
    const missing = requiredText();
    if (missing.length > 0) {
      toast({
        title: tDecl("toast.completeTitle"),
        description: tDecl("toast.completeDesc", { missing: missing.join(", ") }),
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      // Server stores sourceOfIncome as a comma-joined string (multi-select
      // values are flattened on the wire to keep the schema simple).
      const declarationAttachments = attachments
        .filter((a) => !!a.fileData && !!a.file)
        .map((a) => ({
          category: a.category,
          label:
            a.category === "proof_of_income"
              ? "Proof of Source of Income"
              : a.label.trim() || "Supporting Document",
          fileName: a.file!.name,
          fileData: a.fileData!,
        }));
      const payload = {
        ...form,
        sourceOfIncome: form.sourceOfIncomeList.join(", "),
        declarationAttachments,
      };
      const res = await fetch(`/api/cases/${currentCase.id}/declaration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: tDecl("toast.submissionFailedTitle"),
          description: typeof data?.error === "string" ? data.error : tDecl("toast.submissionFailedDesc"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: tDecl("toast.submittedTitle"),
        description: tDecl("toast.submittedDesc"),
      });
      const failures: Array<{ fileName: string; error: string }> = Array.isArray(
        data?.attachmentFailures,
      )
        ? data.attachmentFailures
        : [];
      if (failures.length > 0) {
        toast({
          title: tDecl("toast.attachmentFailuresTitle"),
          description: tDecl("toast.attachmentFailuresDesc", {
            count: failures.length,
            names: failures.map((f) => f.fileName).join(", "),
          }),
          variant: "destructive",
        });
      }
      await refreshDeclaration();
    } catch (_e) {
      toast({
        title: tDecl("toast.networkErrorTitle"),
        description: tDecl("toast.networkErrorDesc"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Status panel for non-form states
  if (status !== "pending") {
    return (
      <div className="p-4 sm:p-8 max-w-3xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => setViewState("dashboard")}
          className="text-blue-300 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {tDecl("back")}
        </Button>
        <Card className="bg-slate-900/60 border-white/10 backdrop-blur-xl">
          <CardContent className="p-8 text-center">
            <StatusPanel status={status} latest={latest} attachments={declaration?.attachments ?? []} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <div className="max-w-4xl mx-auto p-4 sm:p-8">
        <Button
          variant="ghost"
          onClick={() => setViewState("dashboard")}
          className="text-blue-300 hover:text-white mb-4"
          data-testid="button-declaration-back"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {tDecl("back")}
        </Button>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl p-6 sm:p-10 mb-6 border border-white/10"
          style={{
            background: "linear-gradient(135deg, #061540 0%, #0a225a 60%, #0e2f7a 100%)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
        >
          <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="relative flex items-start gap-5">
            <div className="hidden sm:flex w-16 h-16 rounded-2xl items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, #fcd34d 0%, #f59e0b 100%)", boxShadow: "0 10px 30px rgba(245,158,11,0.35)" }}>
              <Scale className="w-8 h-8 text-slate-900" />
            </div>
            <div className="flex-1">
              <Badge className="mb-3 bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-widest text-[10px] font-bold">
                {tDecl("hero.badge")}
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                {tDecl("hero.title")}
              </h2>
              <p className="text-blue-200/80 text-sm mt-1">{tDecl("hero.subtitle")}</p>
              <p className="text-blue-100/85 text-sm sm:text-base mt-4 leading-relaxed max-w-2xl">
                {tDecl("hero.description")}
              </p>
              <p className="text-blue-300/70 text-xs mt-3 italic">
                {tDecl("hero.completeAll")}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Verified payout wallet — surfaced inside the declaration so
            the user reconfirms the destination address as part of the
            compliance acknowledgment. Display-only; IBCCF does not route
            funds. */}
        {currentCase && (
          <div className="mb-5" data-testid="declaration-payout-wallet">
            <PayoutWalletBlock currentCase={currentCase} />
          </div>
        )}

        <div className="space-y-5">
          {/* SECTION 1 */}
          <FormSection
            number={1}
            icon={<UserSquare className="w-5 h-5" />}
            title={tDecl("sections.personal.title")}
            subtitle={tDecl("sections.personal.subtitle")}
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={tDecl("fields.fullName")} required>
                <Input
                  value={form.fullName}
                  onChange={(e) => update("fullName", e.target.value)}
                  placeholder={tDecl("fields.fullNamePlaceholder")}
                  data-testid="input-decl-full-name"
                  className="bg-slate-950/70 border-white/10 text-white"
                />
              </Field>
              <Field label={tDecl("fields.email")} required>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  data-testid="input-decl-email"
                  className="bg-slate-950/70 border-white/10 text-white"
                />
              </Field>
              <Field label={tDecl("fields.registeredUsername")}>
                <Input
                  value={form.registeredUsername}
                  onChange={(e) => update("registeredUsername", e.target.value)}
                  data-testid="input-decl-username"
                  className="bg-slate-950/70 border-white/10 text-white"
                />
              </Field>
              <Field label={tDecl("fields.accountId")}>
                <Input
                  value={form.accountId}
                  onChange={(e) => update("accountId", e.target.value)}
                  data-testid="input-decl-account-id"
                  className="bg-slate-950/70 border-white/10 text-white"
                />
              </Field>
              <Field label={tDecl("fields.country")} required>
                <Select value={form.countryOfResidence} onValueChange={(v) => update("countryOfResidence", v)}>
                  <SelectTrigger className="bg-slate-950/70 border-white/10 text-white" data-testid="select-decl-country">
                    <SelectValue placeholder={tDecl("fields.selectCountry")} />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 max-h-72">
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c} value={c} className="text-white focus:bg-slate-800">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={tDecl("fields.dob")} required>
                <Input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => update("dateOfBirth", e.target.value)}
                  data-testid="input-decl-dob"
                  className="bg-slate-950/70 border-white/10 text-white"
                />
              </Field>
            </div>
          </FormSection>

          {/* SECTION 2 — Access Code */}
          <FormSection
            number={2}
            icon={<Lock className="w-5 h-5" />}
            title={tDecl("sections.accessCode.title")}
            subtitle={tDecl("sections.accessCode.subtitle")}
            accent="amber"
          >
            <Field label={tDecl("fields.accessCode")} required>
              <Input
                value={form.accessCode}
                onChange={(e) => update("accessCode", e.target.value)}
                placeholder={tDecl("fields.accessCodePlaceholder")}
                inputMode="numeric"
                maxLength={16}
                data-testid="input-decl-access-code"
                className="bg-slate-950/70 border-white/10 text-white font-mono tracking-[0.3em] text-center text-lg"
              />
              <p className="text-xs text-amber-300/80 mt-1.5">
                {tDecl("sections.accessCode.help")}
              </p>
            </Field>
          </FormSection>

          {/* SECTION 3 — Sanctions */}
          <FormSection
            number={3}
            icon={<ShieldCheck className="w-5 h-5" />}
            title={tDecl("sections.sanctions.title")}
            subtitle={tDecl("sections.sanctions.subtitle")}
          >
            <div className="space-y-3">
              <ToggleStatement
                label={tDecl("sections.sanctions.iran")}
                checked={form.notSanctionedJurisdictions}
                onChange={(v) => update("notSanctionedJurisdictions", v)}
                testid="toggle-decl-no-sanctioned-juris"
              />
              <ToggleStatement
                label={tDecl("sections.sanctions.noSanctioned")}
                checked={form.noSanctionedTransactions}
                onChange={(v) => update("noSanctionedTransactions", v)}
                testid="toggle-decl-no-sanctioned-tx"
              />
              <ToggleStatement
                label={tDecl("sections.sanctions.usdt")}
                checked={form.acknowledgeUsdtNotSupported}
                onChange={(v) => update("acknowledgeUsdtNotSupported", v)}
                testid="toggle-decl-usdt"
              />
              <ToggleStatement
                label={tDecl("sections.sanctions.falseInfo")}
                checked={form.understandFalseInfoConsequences}
                onChange={(v) => update("understandFalseInfoConsequences", v)}
                testid="toggle-decl-false-info"
              />
            </div>
          </FormSection>

          {/* SECTION 4 — Approved Asset */}
          <FormSection
            number={4}
            icon={<Banknote className="w-5 h-5" />}
            title={tDecl("sections.asset.title")}
            subtitle={tDecl("sections.asset.subtitle")}
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={tDecl("sections.asset.preferred")}>
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 font-bold text-xs">
                    {tDecl("sections.asset.usdcShort")}
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">{tDecl("sections.asset.usdcPolygon")}</p>
                    <p className="text-emerald-300/70 text-xs">{tDecl("sections.asset.recommended")}</p>
                  </div>
                </div>
              </Field>
              <Field label={tDecl("sections.asset.other")}>
                <Input
                  value={form.otherSupportedAsset}
                  onChange={(e) => update("otherSupportedAsset", e.target.value)}
                  placeholder={tDecl("sections.asset.otherPlaceholder")}
                  data-testid="input-decl-other-asset"
                  className="bg-slate-950/70 border-white/10 text-white"
                />
              </Field>
            </div>
          </FormSection>

          {/* SECTION 4b — Source of Income (admin-requested addition) */}
          <FormSection
            number={5}
            icon={<ClipboardCheck className="w-5 h-5" />}
            title={tDecl("sections.income.title")}
            subtitle={tDecl("sections.income.subtitle")}
          >
            <div className="space-y-4">
              <Field label={tDecl("sections.income.selectAll")} required>
                <p className="text-blue-300/60 text-[11px] mb-2">
                  {tDecl("sections.income.tap")}
                </p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {SOURCE_OF_INCOME_OPTIONS.map((s) => {
                    const checked = form.sourceOfIncomeList.includes(s.value);
                    return (
                      <button
                        type="button"
                        key={s.value}
                        onClick={() => {
                          const next = checked
                            ? form.sourceOfIncomeList.filter((x) => x !== s.value)
                            : [...form.sourceOfIncomeList, s.value];
                          update("sourceOfIncomeList", next);
                        }}
                        data-testid={`toggle-decl-source-${s.value.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
                        className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors ${
                          checked
                            ? "bg-emerald-500/15 border-emerald-400/50 text-emerald-100"
                            : "bg-slate-950/70 border-white/10 text-blue-100/80 hover:border-white/25"
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span
                            className={`inline-block w-4 h-4 rounded border ${
                              checked
                                ? "bg-emerald-400 border-emerald-300"
                                : "bg-slate-900 border-white/20"
                            }`}
                          />
                          {tDecl(`incomeOptions.${s.key}`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Field>
              {form.sourceOfIncomeList.includes("Other (please specify)") && (
                <Field label={tDecl("sections.income.otherLabel")} required>
                  <Input
                    value={form.sourceOfIncomeOther}
                    onChange={(e) => update("sourceOfIncomeOther", e.target.value)}
                    placeholder={tDecl("sections.income.otherPlaceholder")}
                    data-testid="input-decl-source-of-income-other"
                    className="bg-slate-950/70 border-white/10 text-white"
                  />
                </Field>
              )}
              {/* Inline document uploads — Proof of Source of Income (required)
                  + up to 3 supporting financial docs. Stored on the server as
                  document_requests rows in the 'submitted' state. */}
              {(() => {
                const psoi = attachments.find((a) => a.category === "proof_of_income");
                const psoiMissing = submitAttempted && (!psoi || !psoi.fileData);
                const missingLabelUid = submitAttempted
                  ? attachments.find(
                      (a) => a.category === "custom" && a.file && !a.label.trim(),
                    )?.uid ?? null
                  : null;
                return (
              <div
                className={`rounded-xl border p-4 space-y-3 ${
                  psoiMissing
                    ? "border-red-400/60 bg-red-500/10"
                    : "border-amber-400/25 bg-amber-500/5"
                }`}
                data-testid="declaration-attachments-section"
              >
                <div className="flex items-start gap-2">
                  <Paperclip className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-amber-200 text-xs font-bold uppercase tracking-widest">
                      {tDecl("attachments.title")}
                    </p>
                    <p className="text-blue-200/70 text-[11px] mt-1 leading-relaxed">
                      <Trans
                        i18nKey="attachments.description"
                        t={tDecl}
                        values={{ max: MAX_SUPPORTING_DOCS }}
                        components={[<strong className="text-amber-200" />]}
                      />
                    </p>
                  </div>
                </div>

                {psoiMissing && (
                  <p
                    className="text-red-200 text-xs font-semibold flex items-center gap-1.5"
                    data-testid="error-decl-psoi-missing"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {tDecl("attachments.psoiMissing")}
                  </p>
                )}

                <div className="space-y-2">
                  {attachments.map((att) => (
                    <AttachmentRow
                      key={att.uid}
                      slot={att}
                      showFileError={
                        att.category === "proof_of_income" && psoiMissing
                      }
                      showLabelError={att.uid === missingLabelUid}
                      onSelect={(f) => handleAttachmentFile(att.uid, f)}
                      onLabelChange={(v) => updateAttachment(att.uid, { label: v })}
                      onRemove={
                        att.category === "custom"
                          ? () => removeAttachment(att.uid)
                          : undefined
                      }
                    />
                  ))}
                </div>

                {attachments.filter((a) => a.category === "custom").length <
                  MAX_SUPPORTING_DOCS && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addSupportingSlot}
                    className="text-amber-200 hover:text-white hover:bg-amber-500/10"
                    data-testid="button-decl-add-supporting-doc"
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    {tDecl("attachments.addMore")}
                  </Button>
                )}
              </div>
                );
              })()}

              <Field label={tDecl("sections.income.monthly")} required>
                <Input
                  value={form.monthlyIncome}
                  onChange={(e) => update("monthlyIncome", e.target.value)}
                  placeholder={tDecl("sections.income.monthlyPlaceholder")}
                  data-testid="input-decl-monthly-income"
                  className="bg-slate-950/70 border-white/10 text-white"
                  inputMode="decimal"
                />
                <p className="text-blue-300/60 text-[11px] mt-1.5">
                  {tDecl("sections.income.monthlyHelp")}
                </p>
              </Field>
            </div>
          </FormSection>

          {/* SECTION 5 — Regulatory Acknowledgment */}
          <FormSection
            number={6}
            icon={<AlertTriangle className="w-5 h-5" />}
            title={tDecl("sections.regulatory.title")}
            subtitle={tDecl("sections.regulatory.subtitle")}
            accent="amber"
          >
            <ul className="space-y-2 mb-4 text-sm text-blue-100/85 leading-relaxed">
              {(["scrutiny", "frozen", "required", "future", "protect"] as const).map((bk) => (
                <li key={bk} className="flex gap-2">
                  <span className="text-amber-400 shrink-0 mt-1">•</span>
                  <span>{tDecl(`sections.regulatory.bullets.${bk}`)}</span>
                </li>
              ))}
            </ul>
            <ToggleStatement
              label={tDecl("sections.regulatory.agree")}
              checked={form.regulatoryAcknowledgment}
              onChange={(v) => update("regulatoryAcknowledgment", v)}
              testid="toggle-decl-regulatory-ack"
            />
          </FormSection>

          {/* SECTION 7 — International Regulatory Terms, Access Code & Refundable Fee */}
          <FormSection
            number={7}
            icon={<Globe2 className="w-5 h-5" />}
            title={tDecl("sections.terms.title")}
            subtitle={tDecl("sections.terms.subtitle")}
            accent="amber"
          >
            {/* Full T&C list — international regulatory + supplementary */}
            <div className="rounded-xl border border-amber-400/25 bg-amber-500/5 p-4 mb-4 text-sm text-blue-100/85 leading-relaxed space-y-3 max-h-80 overflow-y-auto">
              <div>
                <p className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-1.5">
                  {tDecl("sections.terms.groupA")}
                </p>
                <ul className="space-y-1.5">
                  <li>• {tDecl("sections.terms.a.fatf")}</li>
                  <li>• {tDecl("sections.terms.a.share")}</li>
                  <li>•{" "}
                    <Trans
                      i18nKey="sections.terms.a.breakdown"
                      t={tDecl}
                      components={[<strong />, <strong />]}
                    />
                  </li>
                  <li>• {tDecl("sections.terms.a.binding")}</li>
                  <li>• {tDecl("sections.terms.a.false")}</li>
                </ul>
              </div>

              <div>
                <p className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-1.5">
                  {tDecl("sections.terms.groupB")}
                </p>
                <ul className="space-y-1.5">
                  <li>• {tDecl("sections.terms.b.true")}</li>
                  <li>• {tDecl("sections.terms.b.notify")}</li>
                  <li>• {tDecl("sections.terms.b.kyc")}</li>
                  <li>• {tDecl("sections.terms.b.thirdParty")}</li>
                </ul>
              </div>

              <div>
                <p className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-1.5">
                  {tDecl("sections.terms.groupC")}
                </p>
                <ul className="space-y-1.5">
                  <li>• {tDecl("sections.terms.c.tax")}</li>
                  <li>• {tDecl("sections.terms.c.fatca")}</li>
                  <li>• {tDecl("sections.terms.c.tin")}</li>
                </ul>
              </div>

              <div>
                <p className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-1.5">
                  {tDecl("sections.terms.groupD")}
                </p>
                <ul className="space-y-1.5">
                  <li>• {tDecl("sections.terms.d.retain")}</li>
                  <li>• {tDecl("sections.terms.d.process")}</li>
                  <li>• {tDecl("sections.terms.d.dispute")}</li>
                  <li>• {tDecl("sections.terms.d.update")}</li>
                </ul>
              </div>
            </div>

            {/* Fee breakdown card */}
            <div className="rounded-xl border border-blue-400/20 bg-slate-950/60 p-4 mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-blue-200 text-xs font-bold uppercase tracking-widest">
                  {tDecl("sections.terms.fee.totalDeposit")}
                </span>
                <span className="text-amber-300 font-bold text-lg">
                  1,500 USDT
                  <LocalizedAmount value="1500" estimateClassName="text-sm font-normal text-amber-200/80 ml-1" estimateOnly />
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-400/25 p-3">
                  <p className="text-emerald-300 text-[10px] uppercase tracking-widest font-bold">{tDecl("sections.terms.fee.refundableLabel")}</p>
                  <p className="text-emerald-100 font-bold text-base mt-0.5">
                    1,000 USDT
                    <LocalizedAmount value="1000" estimateClassName="text-xs font-normal text-emerald-200/80 ml-1" estimateOnly />
                  </p>
                  <p className="text-emerald-200/70 text-[11px] mt-1">{tDecl("sections.terms.fee.refundableNote")}</p>
                </div>
                <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3">
                  <p className="text-slate-300 text-[10px] uppercase tracking-widest font-bold">{tDecl("sections.terms.fee.processingLabel")}</p>
                  <p className="text-slate-100 font-bold text-base mt-0.5">
                    500 USDT
                    <LocalizedAmount value="500" estimateClassName="text-xs font-normal text-slate-300 ml-1" estimateOnly />
                  </p>
                  <p className="text-slate-400 text-[11px] mt-1">{tDecl("sections.terms.fee.processingNote")}</p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-blue-200 text-xs font-bold uppercase tracking-widest">
                  {tDecl("sections.terms.fee.network")}
                </span>
                <span className="text-white font-mono text-sm">{tDecl("sections.terms.fee.networkValue")}</span>
              </div>
              <div>
                <span className="text-blue-200 text-xs font-bold uppercase tracking-widest block mb-1.5">
                  {tDecl("sections.terms.fee.depositAddress")}
                </span>
                {currentCase?.depositAddress ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-2 text-xs text-amber-200 font-mono break-all" data-testid="text-decl-deposit-address">
                      {currentCase.depositAddress}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-blue-300 hover:text-white shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(currentCase.depositAddress ?? "");
                        toast({ title: tDecl("toast.copyTitle"), description: tDecl("toast.copyDeposit") });
                      }}
                      data-testid="button-decl-copy-address"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-amber-200/90 text-xs italic">
                    {tDecl("sections.terms.fee.noAddress")}
                  </p>
                )}
              </div>
            </div>

            <Field label={tDecl("sections.terms.fee.txHash")} required>
              <Input
                value={form.processingFeeTxHash}
                onChange={(e) => update("processingFeeTxHash", e.target.value)}
                placeholder={tDecl("sections.terms.fee.txHashPlaceholder")}
                data-testid="input-decl-tx-hash"
                className="bg-slate-950/70 border-white/10 text-white font-mono text-sm"
              />
              <p className="text-blue-300/60 text-[11px] mt-1.5">
                {tDecl("sections.terms.fee.txHashHelp")}
              </p>
            </Field>

            {/* Acceptance + Access Code Authenticator */}
            <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-500/5 p-4 space-y-3">
              <ToggleStatement
                label={tDecl("sections.terms.acceptToggle")}
                checked={form.internationalTermsAcknowledged}
                onChange={(v) => {
                  update("internationalTermsAcknowledged", v);
                  if (!v) {
                    setIssuedCode(null);
                  }
                }}
                testid="toggle-decl-international-terms"
              />

              {!issuedCode ? (
                <div>
                  <Button
                    type="button"
                    disabled={!form.internationalTermsAcknowledged || issuingCode || !currentCase?.id}
                    onClick={async () => {
                      if (!currentCase?.id) return;
                      setIssuingCode(true);
                      try {
                        const { getPortalToken } = await import("@/lib/portalSession");
                        const portalToken = getPortalToken();
                        const res = await fetch(
                          `/api/cases/${currentCase.id}/declaration-access-code/issue`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              ...(portalToken ? { "x-portal-session-token": portalToken } : {}),
                            },
                            body: JSON.stringify({ termsAccepted: true }),
                          },
                        );
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          toast({
                            title: tDecl("toast.issueFailedTitle"),
                            description: data?.error ?? tDecl("toast.issueFailedDesc"),
                            variant: "destructive",
                          });
                          return;
                        }
                        const code = data?.accessCode as string | undefined;
                        if (!code) {
                          toast({
                            title: tDecl("toast.noCodeTitle"),
                            description: tDecl("toast.noCodeDesc"),
                            variant: "destructive",
                          });
                          return;
                        }
                        setIssuedCode(code);
                        update("accessCode", code);
                        toast({
                          title: tDecl("toast.codeIssuedTitle"),
                          description: tDecl("toast.codeIssuedDesc"),
                        });
                      } catch {
                        toast({ title: tDecl("toast.networkShortTitle"), variant: "destructive" });
                      } finally {
                        setIssuingCode(false);
                      }
                    }}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                    data-testid="button-decl-issue-access-code"
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    {issuingCode ? tDecl("sections.terms.issuingButton") : tDecl("sections.terms.issueButton")}
                  </Button>
                  <p className="text-blue-300/60 text-[11px] mt-2 text-center">
                    {tDecl("sections.terms.issueHelp")}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-400/40 p-4">
                  <p className="text-emerald-300 text-[10px] uppercase tracking-widest font-bold mb-2">
                    {tDecl("sections.terms.issuedTitle")}
                  </p>
                  <div className="flex items-center gap-2">
                    <code
                      className="flex-1 bg-slate-950 border border-emerald-400/30 rounded px-3 py-2 text-emerald-200 font-mono tracking-[0.4em] text-xl text-center"
                      data-testid="text-decl-issued-code"
                    >
                      {issuedCode}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-emerald-200 hover:text-white shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(issuedCode);
                        toast({ title: tDecl("toast.copyTitle"), description: tDecl("toast.copyAccessCode") });
                      }}
                      data-testid="button-decl-copy-issued-code"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-emerald-200/80 text-[11px] mt-2">
                    {tDecl("sections.terms.issuedHelp")}
                  </p>
                </div>
              )}
            </div>
          </FormSection>

          {/* SECTION 8 — Signature */}
          <FormSection
            number={8}
            icon={<FileSignature className="w-5 h-5" />}
            title={tDecl("sections.signature.title")}
            subtitle={tDecl("sections.signature.subtitle")}
          >
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <Field label={tDecl("sections.signature.fullName")} required>
                <Input
                  value={form.signatureFullName}
                  onChange={(e) => update("signatureFullName", e.target.value)}
                  placeholder={tDecl("sections.signature.fullNamePlaceholder")}
                  data-testid="input-decl-signature"
                  className="bg-slate-950/70 border-white/10 text-white font-serif italic text-lg"
                />
              </Field>
              <Field label={tDecl("sections.signature.date")} required>
                <Input
                  type="date"
                  value={form.signatureDate}
                  onChange={(e) => update("signatureDate", e.target.value)}
                  data-testid="input-decl-signature-date"
                  className="bg-slate-950/70 border-white/10 text-white"
                />
              </Field>
            </div>

            {/* Submission confirmation summary box */}
            <div className="rounded-xl border border-blue-400/20 bg-blue-500/5 p-4 mt-2">
              <p className="text-blue-200 text-xs font-bold uppercase tracking-widest mb-2">
                {tDecl("sections.signature.afterSubmission")}
              </p>
              <ul className="text-blue-100/80 text-xs space-y-1 leading-relaxed">
                {(["review", "confirm", "continue", "future"] as const).map((bk) => (
                  <li key={bk}>• {tDecl(`sections.signature.afterBullets.${bk}`)}</li>
                ))}
              </ul>
            </div>

            <Button
              onClick={submit}
              disabled={submitting}
              className="w-full mt-5 h-12 text-base font-bold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-900 shadow-lg shadow-amber-500/20"
              data-testid="button-decl-submit"
            >
              {submitting ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> {tDecl("sections.signature.submitting")}</>
              ) : (
                <><FileSignature className="w-5 h-5 mr-2" /> {tDecl("sections.signature.submit")}</>
              )}
            </Button>
            <p className="text-center text-blue-300/60 text-[11px] mt-3">
              {tDecl("sections.signature.footer")}
            </p>
          </FormSection>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function FormSection({
  number,
  icon,
  title,
  subtitle,
  accent = "blue",
  children,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  accent?: "blue" | "amber";
  children: React.ReactNode;
}) {
  const { t: tDecl } = useTranslation("declaration");
  const accentBg = accent === "amber" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-blue-500/15 text-blue-300 border-blue-500/30";
  return (
    <Card className="bg-slate-900/60 border-white/10 backdrop-blur-xl overflow-hidden">
      <CardContent className="p-5 sm:p-7">
        <div className="flex items-start gap-4 mb-5">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center border ${accentBg} shrink-0`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400/70">
              {tDecl("sectionLabel", { number })}
            </p>
            <h2 className="text-lg sm:text-xl font-bold text-white mt-0.5 leading-tight">
              {title}
            </h2>
            {subtitle && (
              <p className="text-blue-200/70 text-sm mt-1 leading-relaxed">{subtitle}</p>
            )}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-blue-200 text-xs font-semibold uppercase tracking-wider">
        {label} {required && <span className="text-amber-400">*</span>}
      </Label>
      {children}
    </div>
  );
}

function ToggleStatement({
  label,
  checked,
  onChange,
  testid,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testid?: string;
}) {
  const { t: tDecl } = useTranslation("declaration");
  return (
    <div
      className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
        checked
          ? "bg-emerald-500/10 border-emerald-400/40"
          : "bg-slate-950/40 border-white/10 hover:border-white/20"
      }`}
      onClick={() => onChange(!checked)}
    >
      <div className="pt-0.5">
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          data-testid={testid}
          className="data-[state=checked]:bg-emerald-500"
        />
      </div>
      <p className={`text-sm leading-relaxed flex-1 ${checked ? "text-emerald-50" : "text-blue-100/80"}`}>
        {label}
      </p>
      <Badge
        className={`shrink-0 text-[10px] font-bold uppercase tracking-wider ${
          checked
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
            : "bg-slate-800 text-slate-400 border border-slate-700"
        }`}
      >
        {checked ? tDecl("yes") : tDecl("no")}
      </Badge>
    </div>
  );
}

function AttachmentRow({
  slot,
  showFileError,
  showLabelError,
  onSelect,
  onLabelChange,
  onRemove,
}: {
  slot: AttachmentSlot;
  showFileError?: boolean;
  showLabelError?: boolean;
  onSelect: (file: File | null) => void;
  onLabelChange: (value: string) => void;
  onRemove?: () => void;
}) {
  const { t: tDecl } = useTranslation("declaration");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isPsoi = slot.category === "proof_of_income";
  const testidSuffix = isPsoi ? "psoi" : `supporting-${slot.uid.slice(-6)}`;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${
      showFileError || showLabelError
        ? "border-red-400/50 bg-red-500/5"
        : "border-white/10 bg-slate-950/50"
    }`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isPsoi ? (
            <Banknote className="w-4 h-4 text-emerald-300 shrink-0" />
          ) : (
            <FileText className="w-4 h-4 text-blue-300 shrink-0" />
          )}
          {isPsoi ? (
            <span className="text-sm font-semibold text-amber-100 truncate">
              {tDecl("attachments.psoiLabel")} <span className="text-amber-400">*</span>
            </span>
          ) : (
            <Input
              value={slot.label}
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder={tDecl("attachments.supportingPlaceholder")}
              data-testid={`input-decl-attachment-label-${testidSuffix}`}
              className={`bg-slate-950/70 text-white text-sm h-8 max-w-xs ${
                showLabelError ? "border-red-400/60" : "border-white/10"
              }`}
              maxLength={120}
              aria-invalid={showLabelError ? true : undefined}
            />
          )}
        </div>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="text-red-300 hover:text-red-100 hover:bg-red-500/10 h-8 px-2 shrink-0"
            data-testid={`button-decl-remove-attachment-${testidSuffix}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={DOC_ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
          data-testid={`input-decl-attachment-file-${testidSuffix}`}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          className="border-white/15 bg-slate-900/60 hover:bg-slate-800 text-blue-100"
          data-testid={`button-decl-attachment-select-${testidSuffix}`}
        >
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          {slot.file ? tDecl("attachments.replaceFile") : tDecl("attachments.chooseFile")}
        </Button>
        <div className="flex-1 min-w-0 text-xs">
          {slot.file ? (
            <div className="flex items-center gap-1.5 text-emerald-200">
              <FileCheck2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate" data-testid={`text-decl-attachment-filename-${testidSuffix}`}>
                {slot.file.name}
              </span>
              <span className="text-emerald-300/70 shrink-0">
                · {(slot.file.size / 1024).toFixed(0)} KB
              </span>
            </div>
          ) : (
            <span className="text-slate-400 italic">{tDecl("attachments.noFileSelected")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPanel({
  status,
  latest,
  attachments = [],
}: {
  status: string;
  latest: { id: number; status: string; submittedAt: string; reviewerNotes?: string | null } | null;
  attachments?: Array<{
    id: number;
    documentType: string;
    category: 'proof_of_income' | 'custom';
    submittedFileName: string | null;
    status: string;
  }>;
}) {
  const { t: tDecl } = useTranslation("declaration");
  const { formatDateTime } = useFormat();
  const attachmentSummary = attachments.length > 0 ? (
    <div className="text-left max-w-md mx-auto rounded-xl border border-white/10 bg-slate-950/40 p-4 mt-4" data-testid="declaration-attachments-summary">
      <p className="text-blue-200 text-[10px] uppercase tracking-widest font-bold mb-2">
        {tDecl("status.attachmentsTitle", { count: attachments.length })}
      </p>
      <ul className="space-y-1.5">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <FileCheck2 className="w-3.5 h-3.5 text-blue-300 shrink-0" />
              <span className="truncate text-blue-100">
                {a.documentType.replace(/^Declaration: /, "")}
              </span>
              {a.submittedFileName && (
                <span className="text-slate-400 truncate">— {a.submittedFileName}</span>
              )}
            </div>
            <Badge
              className={`text-[10px] shrink-0 border ${
                a.status === "approved"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
                  : a.status === "rejected"
                    ? "bg-red-500/15 text-red-300 border-red-400/30"
                    : "bg-blue-500/15 text-blue-300 border-blue-400/30"
              }`}
            >
              {a.status}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  if (status === "submitted") {
    return (
      <div className="space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-500/15 border border-blue-400/30 flex items-center justify-center">
          <Hourglass className="w-8 h-8 text-blue-300" />
        </div>
        <h2 className="text-2xl font-bold text-white">{tDecl("status.submittedTitle")}</h2>
        <p className="text-blue-200/80 max-w-md mx-auto leading-relaxed">
          {tDecl("status.submittedDesc")}
        </p>
        {latest && (
          <p className="text-blue-300/60 text-xs">
            {tDecl("status.submittedOn", { date: formatDateTime(latest.submittedAt) })}
          </p>
        )}
        {attachmentSummary}
      </div>
    );
  }
  if (status === "approved") {
    return (
      <div className="space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-300" />
        </div>
        <h2 className="text-2xl font-bold text-white">{tDecl("status.approvedTitle")}</h2>
        <p className="text-emerald-100/85 max-w-md mx-auto leading-relaxed">
          {tDecl("status.approvedDesc")}
        </p>
        {attachmentSummary}
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div className="space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/15 border border-red-400/30 flex items-center justify-center">
          <XCircle className="w-8 h-8 text-red-300" />
        </div>
        <h2 className="text-2xl font-bold text-white">{tDecl("status.rejectedTitle")}</h2>
        <p className="text-red-100/85 max-w-md mx-auto leading-relaxed">
          {tDecl("status.rejectedDesc")}
        </p>
        {latest?.reviewerNotes && (
          <div className="text-left bg-red-500/10 border border-red-400/20 rounded-xl p-4 max-w-md mx-auto">
            <p className="text-red-200 text-xs font-bold uppercase tracking-widest mb-1">{tDecl("status.rejectedNotes")}</p>
            <p className="text-red-50 text-sm">{latest.reviewerNotes}</p>
          </div>
        )}
        {attachmentSummary}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-700/40 border border-white/10 flex items-center justify-center">
        <ShieldCheck className="w-8 h-8 text-blue-300" />
      </div>
      <h2 className="text-2xl font-bold text-white">{tDecl("status.noneTitle")}</h2>
      <p className="text-blue-200/80 max-w-md mx-auto leading-relaxed">
        {tDecl("status.noneDesc")}
      </p>
    </div>
  );
}
