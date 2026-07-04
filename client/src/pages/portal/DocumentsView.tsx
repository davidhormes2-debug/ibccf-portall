import { useMemo, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Upload,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Download,
  Eye,
  FileCheck2,
  ScrollText,
  Banknote,
  Globe2,
  IdCard,
  RefreshCw,
  Lock,
  PlusCircle,
  FolderOpen,
} from "lucide-react";
import {
  DOCUMENT_REQUEST_STATUS_LABELS,
  type DocumentRequestStatus,
} from "@shared/constants";
import { usePortal, type DocumentRequest, type UserDocumentMeta } from "./PortalContext";
import { DocumentPreview } from "@/components/DocumentPreview";
import { useFormat } from "@/i18n/format";
import { getPortalToken } from "@/lib/portalSession";
import { useToast } from "@/hooks/use-toast";
import { PortalSkeleton } from "@/components/portal/PortalSkeleton";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";

const ACCEPT_ATTR = "application/pdf,image/png,image/jpeg,image/webp";

// Categories that ship with a downloadable, pre-filled offline template
// (Task #140). Mirrors FINANCIAL_SIGNATORY_CATEGORIES on the server. The
// match is loose so legacy / free-text documentType strings still
// resolve to the correct template via the same regex used in
// categoryFor() above.
const FINANCIAL_SIGNATORY_TEMPLATES: Array<{
  category: string;
  test: (s: string) => boolean;
}> = [
  { category: 'source_of_funds', test: (s) => /source.*funds|funds.*source/i.test(s) || s === 'source_of_funds' },
  { category: 'beneficial_ownership', test: (s) => /beneficial.*owner|ubo\b/i.test(s) || s === 'beneficial_ownership' },
  { category: 'fatca_crs', test: (s) => /fatca|crs/i.test(s) || s === 'fatca_crs' },
  { category: 'aml_screening', test: (s) => /\baml\b|anti.money|sanctions/i.test(s) || s === 'aml_screening' },
  { category: 'tax_residency_declaration', test: (s) => /tax.*residen/i.test(s) || s === 'tax_residency_declaration' },
  { category: 'settlement_authorization', test: (s) => /settlement.*auth|disbursement.*auth/i.test(s) || s === 'settlement_authorization' },
  { category: 'power_of_attorney', test: (s) => /power.*attorney|\bpoa\b/i.test(s) || s === 'power_of_attorney' },
];

function financialSignatoryCategory(documentType: string): string | null {
  for (const entry of FINANCIAL_SIGNATORY_TEMPLATES) {
    if (entry.test(documentType)) return entry.category;
  }
  return null;
}

interface CategoryMeta {
  label: string;
  description: string;
  icon: typeof FileText;
  accent: string;
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

// Map free-form `documentType` strings (or admin "category" tags routed
// through the same field) to a friendly label, blurb, and icon. The match
// is loose so legacy free-text values still get sensible visuals.
function buildCategories(t: TFunc): Array<{ test: (raw: string) => boolean; meta: CategoryMeta }> {
  return [
    {
      test: (s) => /proof.*income|income.*proof|payslip|salary/i.test(s) || s === 'proof_of_income',
      meta: {
        label: t("documents.categories.proofOfIncome.label"),
        description: t("documents.categories.proofOfIncome.description"),
        icon: Banknote,
        accent: "from-emerald-500 to-emerald-700",
      },
    },
    {
      test: (s) => /source.*funds|funds.*source/i.test(s) || s === 'source_of_funds',
      meta: {
        label: t("documents.categories.sourceOfFunds.label"),
        description: t("documents.categories.sourceOfFunds.description"),
        icon: ScrollText,
        accent: "from-amber-500 to-amber-700",
      },
    },
    {
      test: (s) => /\bkyc\b|identity|id\s*proof|passport|driver|driving|national\s*id|selfie|holding\s*id/i.test(s) || s === 'kyc_id',
      meta: {
        label: t("documents.categories.kyc.label"),
        description: t("documents.categories.kyc.description"),
        icon: IdCard,
        accent: "from-blue-500 to-blue-700",
      },
    },
    {
      test: (s) => /fatca|crs/i.test(s) || s === 'fatca_crs',
      meta: {
        label: t("documents.categories.fatca.label"),
        description: t("documents.categories.fatca.description"),
        icon: Globe2,
        accent: "from-violet-500 to-violet-700",
      },
    },
    // Financial signatory documents (Task #140). Plain English defaults
    // until i18n keys are added; the loose regex matches both the
    // admin-picked canonical label and the underlying category slug.
    {
      test: (s) => /tax.*residen/i.test(s) || s === 'tax_residency_declaration',
      meta: {
        label: t('documents.categories.taxResidency.label'),
        description: t('documents.categories.taxResidency.description'),
        icon: Globe2,
        accent: 'from-cyan-500 to-cyan-700',
      },
    },
    {
      test: (s) => /beneficial.*owner|ubo\b/i.test(s) || s === 'beneficial_ownership',
      meta: {
        label: t('documents.categories.beneficialOwnership.label'),
        description: t('documents.categories.beneficialOwnership.description'),
        icon: IdCard,
        accent: 'from-blue-500 to-blue-700',
      },
    },
    {
      test: (s) => /\baml\b|anti.money|sanctions/i.test(s) || s === 'aml_screening',
      meta: {
        label: t('documents.categories.aml.label'),
        description: t('documents.categories.aml.description'),
        icon: ShieldCheck,
        accent: 'from-rose-500 to-rose-700',
      },
    },
    {
      test: (s) => /settlement.*auth|disbursement.*auth/i.test(s) || s === 'settlement_authorization',
      meta: {
        label: t('documents.categories.settlementAuth.label'),
        description: t('documents.categories.settlementAuth.description'),
        icon: FileCheck2,
        accent: 'from-amber-500 to-orange-600',
      },
    },
    {
      test: (s) => /power.*attorney|\bpoa\b/i.test(s) || s === 'power_of_attorney',
      meta: {
        label: t('documents.categories.powerOfAttorney.label'),
        description: t('documents.categories.powerOfAttorney.description'),
        icon: ScrollText,
        accent: 'from-indigo-500 to-indigo-700',
      },
    },
  ];
}

function categoryFor(documentType: string, t: TFunc): CategoryMeta {
  for (const entry of buildCategories(t)) {
    if (entry.test(documentType)) return entry.meta;
  }
  return {
    label: documentType,
    description: t("documents.categories.custom.description"),
    icon: FileText,
    accent: "from-slate-500 to-slate-700",
  };
}

const DOCUMENT_STATUS_GLASS: Record<DocumentRequestStatus, { Icon: React.ElementType; cls: string }> = {
  approved:     { Icon: CheckCircle2,  cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' },
  rejected:     { Icon: XCircle,       cls: 'bg-red-500/20 text-red-300 border border-red-500/30' },
  under_review: { Icon: Clock,         cls: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' },
  submitted:    { Icon: Upload,        cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' },
  pending:      { Icon: AlertTriangle, cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' },
};

function statusBadge(status: string) {
  const s = (status?.toLowerCase() ?? '') as DocumentRequestStatus;
  const style = DOCUMENT_STATUS_GLASS[s] ?? DOCUMENT_STATUS_GLASS.pending;
  const label = DOCUMENT_REQUEST_STATUS_LABELS[s] ?? DOCUMENT_REQUEST_STATUS_LABELS.pending;
  return { Icon: style.Icon, label, cls: style.cls };
}

function DocumentRequestCard({ doc }: { doc: DocumentRequest }) {
  const { t } = useTranslation("portal");
  const { formatDateTime } = useFormat();
  const meta = useMemo(() => categoryFor(doc.documentType, t), [doc.documentType, t]);
  const badge = statusBadge(doc.status);
  const Icon = meta.icon;
  const StatusIcon = badge.Icon;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const { submitDocument, currentCase } = usePortal();
  const { toast } = useToast();
  const templateCategory = useMemo(
    () => financialSignatoryCategory(doc.documentType ?? ''),
    [doc.documentType],
  );

  const downloadTemplate = async () => {
    if (!templateCategory || !currentCase?.id) return;
    setIsDownloadingTemplate(true);
    try {
      const portalToken = getPortalToken();
      const res = await fetch(
        `/api/cases/${currentCase.id}/document-templates/${templateCategory}`,
        {
          headers: portalToken
            ? { 'x-portal-session-token': portalToken }
            : {},
        },
      );
      if (!res.ok) {
        throw new Error(`Template download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${templateCategory}_${currentCase.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t('context.toast.networkErrorTitle'),
        description: (err as Error).message,
      });
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  // Compliance can pause an individual upload link from the admin
  // dashboard. When `uploadsEnabled` is explicitly false we hide the
  // upload button and show a "paused" notice instead. Treat undefined
  // as enabled so older API responses don't accidentally lock users out.
  const uploadsEnabled = doc.uploadsEnabled !== false;
  const inUploadableStatus = doc.status === 'pending' || doc.status === 'requested' || doc.status === 'rejected';
  const canUpload = inUploadableStatus && uploadsEnabled;
  const deadlineDate = doc.deadline ? new Date(doc.deadline) : null;
  const overdue = deadlineDate ? deadlineDate.getTime() < Date.now() && canUpload : false;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true);
    try {
      await submitDocument(doc.id, file);
    } catch {
      // toast already shown
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const downloadSubmission = () => {
    if (!doc.submittedFileData) return;
    const a = document.createElement('a');
    a.href = doc.submittedFileData;
    a.download = doc.submittedFileName || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl glass-dark-premium card-depth overflow-hidden"
      data-testid={`document-request-${doc.id}`}
    >
      <div className="p-5 flex items-start gap-4 border-b border-white/10">
        <div className={`gradient-icon w-12 h-12 bg-gradient-to-br ${meta.accent} shrink-0`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 mb-1.5">
            <h3 className="font-bold text-white text-base min-w-0">{meta.label}</h3>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Badge className={`text-[10px] flex items-center gap-1 ${badge.cls}`}>
                <StatusIcon className="w-3 h-3" /> {badge.label}
              </Badge>
              {overdue && (
                <Badge className="text-[10px] bg-red-500/20 text-red-300 border border-red-500/30 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {t("documents.card.overdue")}
                </Badge>
              )}
            </div>
          </div>
          <p className="text-sm text-blue-200/80 leading-snug">{meta.description}</p>
          {doc.documentType && doc.documentType !== meta.label && (
            <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-wider">{t("documents.card.reference", { type: doc.documentType })}</p>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {doc.description && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-blue-400/70 font-bold mb-1">{t("documents.card.complianceNotes")}</p>
            <p className="text-sm text-blue-100 whitespace-pre-wrap">{doc.description}</p>
          </div>
        )}

        <div className="grid grid-cols-1 [@media(min-width:376px)]:grid-cols-2 gap-3 text-xs">
          <div className="min-w-0">
            <p className="text-blue-400/60 uppercase tracking-wider mb-1">{t("documents.card.requested")}</p>
            <p className="text-white break-words">{formatDateTime(doc.createdAt)}</p>
          </div>
          {deadlineDate && (
            <div className="min-w-0">
              <p className="text-blue-400/60 uppercase tracking-wider mb-1">{t("documents.card.deadline")}</p>
              <p className={`break-words ${overdue ? "text-red-300 font-semibold" : "text-white"}`}>{formatDateTime(deadlineDate)}</p>
            </div>
          )}
        </div>

        {doc.adminNotes && doc.status === 'rejected' && (
          <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30">
            <p className="text-[10px] uppercase tracking-widest text-red-300 font-bold mb-1">{t("documents.card.reviewerNotes")}</p>
            <p className="text-sm text-red-100">{doc.adminNotes}</p>
          </div>
        )}
        {doc.adminNotes && doc.status === 'approved' && (
          <div className="rounded-xl p-3 bg-emerald-500/10 border border-emerald-500/30">
            <p className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold mb-1">{t("documents.card.reviewerNotes")}</p>
            <p className="text-sm text-emerald-100">{doc.adminNotes}</p>
          </div>
        )}

        {doc.submittedFileName && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl p-3 bg-white/5 border border-white/10 gap-2 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <FileCheck2 className="w-5 h-5 text-blue-300 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{doc.submittedFileName}</p>
                  {doc.submittedAt && (
                    <p className="text-xs text-blue-300/80">{t("documents.card.submittedOn", { date: formatDateTime(doc.submittedAt) })}</p>
                  )}
                </div>
              </div>
              {doc.submittedFileData ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreviewOpen(v => !v)}
                    className="text-blue-200 hover:bg-white/10"
                    data-testid={`button-preview-document-${doc.id}`}
                  >
                    <Eye className="w-4 h-4 mr-1.5" /> {previewOpen ? t("documents.card.hide") : t("documents.card.preview")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={downloadSubmission}
                    className="text-blue-200 hover:bg-white/10"
                    data-testid={`button-download-document-${doc.id}`}
                  >
                    <Download className="w-4 h-4 mr-1.5" /> {t("documents.card.download")}
                  </Button>
                </div>
              ) : (
                <Badge
                  className="text-[10px] bg-slate-700/40 text-slate-300 border border-white/10"
                  data-testid={`badge-document-archived-${doc.id}`}
                >
                  {t("documents.card.archived")}
                </Badge>
              )}
            </div>
            {doc.submittedFileData && previewOpen && (
              <DocumentPreview
                dataUrl={doc.submittedFileData}
                fileName={doc.submittedFileName}
                variant="portal"
                testIdPrefix={`portal-document-preview-${doc.id}`}
              />
            )}
          </div>
        )}

        {inUploadableStatus && !uploadsEnabled && (
          <div
            className="rounded-xl p-3 bg-slate-800/50 border border-white/10 flex items-start gap-3"
            data-testid={`document-uploads-paused-${doc.id}`}
          >
            <Lock className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" />
            <div className="text-xs text-blue-100/90 leading-relaxed">
              <p className="font-semibold text-white mb-0.5">{t("documents.card.uploadsPausedTitle")}</p>
              <p>{t("documents.card.uploadsPausedBody")}</p>
            </div>
          </div>
        )}

        {templateCategory && canUpload && (
          <div
            className="rounded-xl p-3 bg-amber-500/5 border border-amber-500/20 flex items-start gap-3"
            data-testid={`document-template-${doc.id}`}
          >
            <FileText className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white mb-0.5">
                {t('documents.card.templateTitle')}
              </p>
              <p className="text-xs text-blue-100/80 leading-relaxed mb-2">
                {t('documents.card.templateBody')}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadTemplate}
                disabled={isDownloadingTemplate}
                className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                data-testid={`button-download-template-${doc.id}`}
              >
                {isDownloadingTemplate ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> {t('documents.card.templateDownloading')}</>
                ) : (
                  <><Download className="w-3.5 h-3.5 mr-1.5" /> {t('documents.card.templateDownload')}</>
                )}
              </Button>
            </div>
          </div>
        )}

        {canUpload && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
              data-testid={`input-document-file-${doc.id}`}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full bg-gradient-to-r from-[#004182] to-[#0066cc] text-white hover:opacity-90"
              data-testid={`button-upload-document-${doc.id}`}
            >
              {isUploading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("documents.card.uploading")}</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" /> {doc.status === 'rejected' ? t("documents.card.uploadCorrected") : t("documents.card.upload")}</>
              )}
            </Button>
            <p className="text-[11px] text-slate-400 mt-2 text-center">
              {t("documents.card.uploadHint")}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

const USER_DOC_CATEGORY_OPTIONS = [
  { value: 'general', labelKey: 'documents.supporting.category.general' },
  { value: 'id_proof', labelKey: 'documents.supporting.category.idProof' },
  { value: 'transaction', labelKey: 'documents.supporting.category.transaction' },
  { value: 'evidence', labelKey: 'documents.supporting.category.evidence' },
];

function userDocStatusBadge(status: string, t: TFunc) {
  const s = status?.toLowerCase();
  if (s === 'approved') {
    return { Icon: CheckCircle2, label: t('documents.status.approved'), cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' };
  }
  if (s === 'rejected') {
    return { Icon: XCircle, label: t('documents.status.rejected'), cls: 'bg-red-500/20 text-red-300 border border-red-500/30' };
  }
  if (s === 'reviewed') {
    return { Icon: Clock, label: t('documents.status.underReview'), cls: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' };
  }
  return { Icon: Upload, label: t('documents.supporting.status.uploaded'), cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' };
}

function UserDocumentCard({ doc }: { doc: UserDocumentMeta }) {
  const { t } = useTranslation('portal');
  const { formatDateTime } = useFormat();
  const badge = userDocStatusBadge(doc.status, t);
  const StatusIcon = badge.Icon;

  const categoryLabel = useMemo(() => {
    const opt = USER_DOC_CATEGORY_OPTIONS.find(o => o.value === doc.category);
    return opt ? t(opt.labelKey) : (doc.category ?? t('documents.supporting.category.unknown'));
  }, [doc.category, t]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl glass-dark-premium border border-white/10 p-4 flex items-start gap-4"
      data-testid={`user-document-${doc.id}`}
    >
      <div className="gradient-icon w-10 h-10 bg-gradient-to-br from-slate-500 to-slate-700 shrink-0">
        <FileText className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white truncate">{doc.fileName}</p>
          <Badge className={`text-[10px] flex items-center gap-1 shrink-0 ${badge.cls}`}>
            <StatusIcon className="w-3 h-3" /> {badge.label}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-blue-300/80">
          <span>{categoryLabel}</span>
          {doc.fileSize && <span>{doc.fileSize}</span>}
          <span>{formatDateTime(doc.uploadedAt)}</span>
        </div>
        {doc.description && (
          <p className="text-xs text-blue-100/70 mt-1 italic">{doc.description}</p>
        )}
        {doc.adminNotes && (doc.status === 'approved' || doc.status === 'rejected') && (
          <div className={`mt-2 rounded-lg p-2 text-xs ${doc.status === 'rejected' ? 'bg-red-500/10 border border-red-500/20 text-red-200' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-200'}`}>
            <span className="font-semibold uppercase tracking-wider text-[10px] block mb-0.5">
              {t('documents.card.reviewerNotes')}
            </span>
            {doc.adminNotes}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function SupportingDocumentsSection() {
  const { t } = useTranslation('portal');
  const { userDocuments, uploadUserDocument, refreshUserDocuments } = usePortal();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('general');
  const [description, setDescription] = useState('');

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const trimmed = description.trim();
      await uploadUserDocument(file, selectedCategory, trimmed ? trimmed : undefined);
      setDescription('');
    } catch {
      // toast already shown by context
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [uploadUserDocument, selectedCategory, description]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="mt-8"
    >
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-blue-300" />
          <h3 className="text-lg font-bold text-white">
            {t('documents.supporting.title')}
          </h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refreshUserDocuments}
          className="text-white hover:bg-white/10 border border-white/10"
          data-testid="button-refresh-user-documents"
        >
          <RefreshCw className="w-4 h-4 mr-1.5" /> {t('documents.header.refresh')}
        </Button>
      </div>

      <Card className="glass-dark-premium border-white/10 mb-4">
        <CardContent className="p-4">
          <p className="text-sm text-blue-100/80 leading-relaxed mb-4">
            {t('documents.supporting.description')}
          </p>

          <div className="mb-3">
            <label
              htmlFor="user-doc-description"
              className="block text-xs font-semibold uppercase tracking-wider text-blue-200/80 mb-1.5"
            >
              {t('documents.supporting.descriptionLabel')}
            </label>
            <Textarea
              id="user-doc-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder={t('documents.supporting.descriptionPlaceholder')}
              className="bg-white/5 border-white/20 text-white placeholder:text-slate-500 text-sm"
              data-testid="input-user-doc-description"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="w-full sm:w-48">
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger
                  className="bg-white/5 border-white/20 text-white text-sm"
                  data-testid="select-user-doc-category"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0a1628] border-white/20 text-white">
                  {USER_DOC_CATEGORY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} className="text-white hover:bg-white/10 focus:bg-white/10">
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
              data-testid="input-user-document-file"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full sm:w-auto bg-gradient-to-r from-[#004182] to-[#0066cc] text-white hover:opacity-90"
              data-testid="button-upload-user-document"
            >
              {isUploading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('documents.card.uploading')}</>
              ) : (
                <><PlusCircle className="w-4 h-4 mr-2" /> {t('documents.supporting.uploadButton')}</>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {t('documents.card.uploadHint')}
          </p>
        </CardContent>
      </Card>

      {userDocuments.length === 0 ? (
        <PortalEmptyState
          icon={FolderOpen}
          title={t('documents.supporting.emptyTitle')}
          description={t('documents.supporting.emptySubtitle')}
          iconClassName="text-slate-500"
          data-testid="supporting-documents-empty-state"
        />
      ) : (
        <div className="space-y-3">
          {userDocuments.map(doc => (
            <UserDocumentCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function DocumentsView() {
  const { t } = useTranslation("portal");
  const { documentRequests, refreshDocumentRequests, pendingDocumentCount } = usePortal();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshDocumentRequests();
    } catch {
      // The finally block clears the spinner so users are never left with a
      // permanent skeleton. Show a destructive toast so the failure is visible.
      toast({
        variant: "destructive",
        title: t("documents.refreshError.title", { defaultValue: "Refresh failed" }),
        description: t("documents.refreshError.description", {
          defaultValue: "Could not reload your documents. Please try again.",
        }),
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const sorted = useMemo(() => {
    const order = (s: string) => {
      const v = s?.toLowerCase();
      if (v === 'rejected') return 0;
      if (v === 'pending' || v === 'requested') return 1;
      if (v === 'submitted' || v === 'under_review') return 2;
      if (v === 'approved') return 3;
      return 4;
    };
    return [...documentRequests].sort((a, b) => {
      const diff = order(a.status) - order(b.status);
      if (diff !== 0) return diff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [documentRequests]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-amber-300" />
            {t("documents.header.title")}
          </h2>
          <p className="text-blue-300 text-sm">
            {t("documents.header.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingDocumentCount > 0 && (
            <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {t("documents.header.awaiting", { count: pendingDocumentCount })}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-white hover:bg-white/10 border border-white/10"
            data-testid="button-refresh-documents"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? t("documents.header.refreshing") : t("documents.header.refresh")}
          </Button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mb-6">
        <Card className="glass-dark-premium border-white/10">
          <CardContent className="p-4 flex items-start gap-3">
            <div className="gradient-icon w-10 h-10 bg-gradient-to-br from-[#004182] to-[#0066cc] shrink-0">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div className="text-sm text-blue-100/90 leading-relaxed">
              {t("documents.complianceNote")}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {isRefreshing ? (
        <PortalSkeleton variant="card" count={Math.max(2, sorted.length) || 2} />
      ) : sorted.length === 0 ? (
        <PortalEmptyState
          icon={FileText}
          title={t("documents.empty.title")}
          description={t("documents.empty.subtitle")}
          iconClassName="text-slate-500"
          data-testid="documents-empty-state"
        />
      ) : (
        <div className="space-y-4">
          {sorted.map((doc) => (
            <DocumentRequestCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}

      <SupportingDocumentsSection />
    </div>
  );
}
