import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderLock, ShieldCheck, Plus, FileCheck2, Eye, Download, CheckCircle, XCircle, Search } from "lucide-react";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentRequest } from "@/components/admin/shared";

interface CaseDocumentsSectionProps {
  caseId: string;
  ndaSealed: boolean;
  requests: DocumentRequest[];
  newRequest: { caseId: string; documentType: string; description: string; deadline: string; category?: string };
  setNewRequest: React.Dispatch<React.SetStateAction<{ caseId: string; documentType: string; description: string; deadline: string; category?: string }>>;
  onCreate: () => void | Promise<void>;
  onApprove: (id: number, notes?: string) => void | Promise<void>;
  onReject: (id: number, notes: string) => void | Promise<void>;
  onMarkUnderReview: (id: number) => void | Promise<void>;
  onRequestKycIdBundle: (caseId: string) => void | Promise<void>;
  fetchDocumentFile: (id: number) => Promise<string | null>;
}

// Standard regulatory categories shown unconditionally in the request
// dropdown. `source_of_funds` and `fatca_crs` are intentionally NOT
// listed here — they belong to the post-NDA financial-signatory family
// below and must remain gated on `cases.sealedAt` so admins can't bypass
// the NDA precondition by picking the "standard" variant of the same
// category (Task #140).
const ADMIN_DOCUMENT_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'proof_of_income', label: 'Proof of Income' },
  { value: 'kyc_id', label: 'KYC Identity Verification' },
  { value: 'custom', label: 'Custom (free text)' },
];

// Financial signatory documents (Task #140). Each ships a pre-filled
// PDF template the user downloads, signs offline, and uploads through
// the standard flow. The optgroup is rendered only after the user
// signs the NDA (cases.sealedAt is the signal); until then the group
// is shown as a disabled hint so admins understand the precondition.
const ADMIN_FINANCIAL_SIGNATORY_CATEGORIES: Array<{ value: string; label: string; description: string }> = [
  { value: 'source_of_funds',           label: 'Source of Funds Declaration',            description: 'Please complete and sign the attached Source of Funds Declaration template.' },
  { value: 'beneficial_ownership',      label: 'Beneficial Ownership / KYC Attestation', description: 'Please complete and sign the attached Beneficial Ownership / KYC Attestation template.' },
  { value: 'fatca_crs',                 label: 'FATCA / CRS Self-Certification',         description: 'Please complete and sign the attached FATCA / CRS Self-Certification template.' },
  { value: 'aml_screening',             label: 'AML Acknowledgement',                    description: 'Please complete and sign the attached AML Acknowledgement template.' },
  { value: 'tax_residency_declaration', label: 'Tax Residency Declaration',              description: 'Please complete and sign the attached Tax Residency Declaration template.' },
  { value: 'settlement_authorization',  label: 'Settlement / Disbursement Authorization', description: 'Please complete and sign the attached Settlement / Disbursement Authorization template.' },
  { value: 'power_of_attorney',         label: 'Power of Attorney for Disbursement',     description: 'Please complete and sign the attached Power of Attorney for Disbursement template.' },
];

function statusPillClass(status: string): string {
  const s = status?.toLowerCase();
  if (s === 'approved') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (s === 'rejected') return 'bg-red-500/15 text-red-300 border-red-500/30';
  if (s === 'submitted' || s === 'under_review') return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
  return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
}

export function CaseDocumentsSection(props: CaseDocumentsSectionProps) {
  const { caseId, ndaSealed, requests, newRequest, setNewRequest, onCreate, onApprove, onReject, onMarkUnderReview, onRequestKycIdBundle, fetchDocumentFile } = props;
  const { t: tDocs } = useTranslation("admin");
  const [selectedCategory, setSelectedCategory] = useState<string>('proof_of_income');
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({});
  const [approveNotes, setApproveNotes] = useState<Record<number, string>>({});
  const [showRejectFor, setShowRejectFor] = useState<number | null>(null);
  const [previewOpenFor, setPreviewOpenFor] = useState<Set<number>>(new Set());
  const [previewData, setPreviewData] = useState<Record<number, string>>({});

  const togglePreview = async (req: DocumentRequest) => {
    const id = req.id;
    const isOpen = previewOpenFor.has(id);
    if (isOpen) {
      setPreviewOpenFor(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    // Lazy-fetch the blob if we don't already have it.
    let data: string | null = req.submittedFileData ?? previewData[id] ?? null;
    if (!data) {
      data = await fetchDocumentFile(id);
    }
    if (data) {
      const blob: string = data;
      setPreviewData(prev => ({ ...prev, [id]: blob }));
      setPreviewOpenFor(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
  };

  const isThisCase = newRequest.caseId === caseId;
  const docTypeValue = isThisCase ? newRequest.documentType : '';
  const descriptionValue = isThisCase ? newRequest.description : '';
  const deadlineValue = isThisCase ? newRequest.deadline : '';

  const applyCategory = (value: string) => {
    setSelectedCategory(value);
    const signatory = ADMIN_FINANCIAL_SIGNATORY_CATEGORIES.find(c => c.value === value);
    if (signatory) {
      // Financial signatory documents (Task #140): pre-fill the
      // documentType with the friendly label so the portal renders the
      // correct card + Download-template button, and seed the user-facing
      // note with the canonical "complete and sign" line.
      setNewRequest({
        caseId,
        documentType: signatory.label,
        description: signatory.description,
        deadline: deadlineValue,
        category: signatory.value,
      });
      return;
    }
    const meta = ADMIN_DOCUMENT_CATEGORIES.find(c => c.value === value);
    setNewRequest({
      caseId,
      documentType: value === 'custom' ? '' : value,
      description: value === 'custom' ? descriptionValue : (meta?.label ? `Please upload your ${meta.label}.` : descriptionValue),
      deadline: deadlineValue,
      category: value === 'custom' ? undefined : value,
    });
  };

  const handleCreate = async () => {
    setNewRequest(prev => ({ ...prev, caseId }));
    await onCreate();
  };

  const downloadSubmission = async (req: DocumentRequest) => {
    let data: string | null = req.submittedFileData ?? previewData[req.id] ?? null;
    if (!data) data = await fetchDocumentFile(req.id);
    if (!data) return;
    const a = document.createElement('a');
    a.href = data;
    a.download = req.submittedFileName || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const pendingReview = requests.filter(r => r.status === 'submitted' || r.status === 'under_review').length;

  // KYC ID bundle eligibility: at least one proof-of-income request exists
  // on this case AND every income request is approved AND no KYC bundle row
  // already exists. Mirrors the server-side gate so the button accurately
  // reflects what the API will accept.
  const KYC_BUNDLE_TYPES = new Set([
    'KYC ID — Front',
    'KYC ID — Back',
    'Selfie holding ID — Front',
    'Selfie holding ID — Back',
  ]);
  const incomeDocs = requests.filter(r => {
    const t = (r.documentType ?? '').toLowerCase();
    return t === 'proof_of_income' || /proof.*income|income.*proof|proof of source of income/.test(t);
  });
  const hasKycBundle = requests.some(r => KYC_BUNDLE_TYPES.has(r.documentType));
  const incomeAllApproved = incomeDocs.length > 0 && incomeDocs.every(d => d.status === 'approved');
  const canRequestKyc = incomeAllApproved && !hasKycBundle;

  return (
    <div className="space-y-4" data-testid="admin-case-documents-section">
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-slate-700/50 flex items-center justify-center">
            <FolderLock className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">{tDocs("sections.regulatoryDocuments", { defaultValue: "Regulatory Documents" })}</h3>
        </div>
        <span className="text-xs text-slate-600">
          {requests.length} request{requests.length !== 1 ? 's' : ''}
          {pendingReview > 0 && <span className="ml-2 text-blue-400">· {pendingReview} awaiting review</span>}
        </span>
      </div>

      {/* KYC ID verification bundle — admin-triggered after income approval */}
      <div className="rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-950/30 to-slate-900/40 p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-blue-200 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-300" /> KYC Identity Verification
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {hasKycBundle
                ? 'KYC ID bundle has already been requested on this case.'
                : incomeDocs.length === 0
                  ? 'Available once at least one Proof of Income document has been submitted and approved.'
                  : !incomeAllApproved
                    ? `Waiting on Proof of Income approval (${incomeDocs.filter(d => d.status === 'approved').length}/${incomeDocs.length} approved).`
                    : 'Sends 4 requests to the user: ID Front, ID Back, Selfie holding ID Front, Selfie holding ID Back.'}
            </p>
          </div>
          <Button
            size="sm"
            disabled={!canRequestKyc}
            onClick={() => onRequestKycIdBundle(caseId)}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="button-request-kyc-id-bundle"
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
            {hasKycBundle ? 'Already requested' : 'Request KYC ID'}
          </Button>
        </div>
      </div>

      {/* Create new request */}
      <div className="rounded-xl border border-slate-800/50 bg-slate-900/40 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Request a document</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Category</Label>
            <Select value={selectedCategory} onValueChange={applyCategory}>
              <SelectTrigger data-testid="select-document-category" className="bg-slate-950/60 border-slate-700 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="text-[10px] uppercase tracking-wider text-slate-500">Standard documents</SelectLabel>
                  {ADMIN_DOCUMENT_CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-[10px] uppercase tracking-wider text-slate-500">
                    Financial signatory documents
                    {!ndaSealed && (
                      <span className="ml-2 normal-case tracking-normal text-amber-400/80 text-[10px]">
                        — available after the user signs the NDA
                      </span>
                    )}
                  </SelectLabel>
                  {ADMIN_FINANCIAL_SIGNATORY_CATEGORIES.map(c => (
                    <SelectItem
                      key={`fs-${c.value}`}
                      value={c.value}
                      disabled={!ndaSealed}
                      data-testid={`select-item-financial-signatory-${c.value}`}
                    >
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Document type label</Label>
            <Input
              value={docTypeValue}
              onChange={(e) => setNewRequest({ ...newRequest, caseId, documentType: e.target.value, description: descriptionValue, deadline: deadlineValue })}
              placeholder={selectedCategory === 'custom' ? 'e.g. Trust deed' : selectedCategory}
              className="bg-slate-950/60 border-slate-700 text-slate-200"
              data-testid="input-document-type"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-400">Notes shown to user (optional)</Label>
          <Textarea
            value={descriptionValue}
            onChange={(e) => setNewRequest({ ...newRequest, caseId, documentType: docTypeValue, description: e.target.value, deadline: deadlineValue })}
            rows={2}
            className="bg-slate-950/60 border-slate-700 text-slate-200 resize-none"
            data-testid="textarea-document-description"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Deadline (optional)</Label>
            <Input
              type="datetime-local"
              value={deadlineValue}
              onChange={(e) => setNewRequest({ ...newRequest, caseId, documentType: docTypeValue, description: descriptionValue, deadline: e.target.value })}
              className="bg-slate-950/60 border-slate-700 text-slate-200"
              data-testid="input-document-deadline"
            />
          </div>
          <Button
            onClick={handleCreate}
            disabled={!docTypeValue.trim()}
            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600"
            data-testid="button-create-document-request"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Send request
          </Button>
        </div>
      </div>

      {/* Existing requests */}
      {requests.length === 0 ? (
        <div className="text-center py-6 bg-slate-900/30 rounded-xl border border-slate-800/30 border-dashed">
          <FolderLock className="h-8 w-8 text-slate-700 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">No documents requested yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map(req => (
            <div key={req.id} className="rounded-xl border border-slate-800/50 bg-slate-900/30 p-3" data-testid={`admin-document-request-${req.id}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-white text-sm">{req.documentType}</span>
                    <Badge variant="outline" className={`text-[10px] capitalize border ${statusPillClass(req.status)}`}>
                      {(req.status ?? 'pending').replace('_', ' ')}
                    </Badge>
                    {req.deadline && (
                      <span className="text-[11px] text-slate-500">
                        Due {new Date(req.deadline).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {req.description && (
                    <p className="text-xs text-slate-400 mt-1">{req.description}</p>
                  )}
                  {req.submittedFileName && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <FileCheck2 className="h-3.5 w-3.5 text-blue-400" />
                      <span className="text-xs text-slate-300 truncate">{req.submittedFileName}</span>
                      {(req.submittedFileData || req.hasSubmittedFile) ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-blue-300 hover:bg-blue-500/10"
                            onClick={() => togglePreview(req)}
                            data-testid={`button-admin-preview-document-${req.id}`}
                          >
                            <Eye className="h-3 w-3 mr-1" /> {previewOpenFor.has(req.id) ? 'Hide preview' : 'Preview'}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-blue-300 hover:bg-blue-500/10" onClick={() => downloadSubmission(req)} data-testid={`button-admin-download-document-${req.id}`}>
                            <Download className="h-3 w-3 mr-1" /> Download
                          </Button>
                        </>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-slate-600 text-slate-400 bg-slate-800/50"
                          data-testid={`badge-admin-document-archived-${req.id}`}
                        >
                          Archived — file removed after 90 days
                        </Badge>
                      )}
                    </div>
                  )}
                  {previewOpenFor.has(req.id) && (req.submittedFileData || previewData[req.id]) && (
                    <div className="mt-3">
                      <DocumentPreview
                        dataUrl={(req.submittedFileData || previewData[req.id])!}
                        fileName={req.submittedFileName}
                        variant="admin"
                        testIdPrefix={`admin-document-preview-${req.id}`}
                      />
                    </div>
                  )}
                  {req.adminNotes && (
                    <p className="text-[11px] text-slate-500 mt-1 italic">Reviewer: {req.adminNotes}</p>
                  )}
                </div>
                {(req.status === 'submitted' || req.status === 'under_review') && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {req.status === 'submitted' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onMarkUnderReview(req.id)}
                        className="border-blue-500/40 text-blue-300 hover:bg-blue-500/10"
                        data-testid={`button-under-review-document-${req.id}`}
                      >
                        <Search className="h-3.5 w-3.5 mr-1" /> Under Review
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => onApprove(req.id, approveNotes[req.id])}
                      className="bg-emerald-600/80 hover:bg-emerald-500 text-white"
                      data-testid={`button-approve-document-${req.id}`}
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowRejectFor(showRejectFor === req.id ? null : req.id)}
                      className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                      data-testid={`button-reject-document-${req.id}`}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                )}
              </div>

              {(req.status === 'submitted' || req.status === 'under_review') && showRejectFor === req.id && (
                <div className="mt-3 space-y-2">
                  <Textarea
                    placeholder="Explain what the user needs to fix or resubmit…"
                    value={rejectNotes[req.id] || ''}
                    onChange={(e) => setRejectNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                    rows={2}
                    className="bg-slate-950/60 border-slate-700 text-slate-200 text-sm resize-none"
                    data-testid={`textarea-reject-notes-${req.id}`}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setShowRejectFor(null); setRejectNotes(prev => ({ ...prev, [req.id]: '' })); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={async () => {
                        await onReject(req.id, rejectNotes[req.id] || '');
                        setShowRejectFor(null);
                      }}
                      className="bg-red-600 hover:bg-red-500"
                      data-testid={`button-confirm-reject-${req.id}`}
                    >
                      Confirm rejection
                    </Button>
                  </div>
                </div>
              )}

              {(req.status === 'submitted' || req.status === 'under_review') && (
                <div className="mt-2">
                  <Input
                    placeholder="Optional approval note for the user"
                    value={approveNotes[req.id] || ''}
                    onChange={(e) => setApproveNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                    className="bg-slate-950/60 border-slate-700 text-slate-200 text-xs h-8"
                    data-testid={`input-approve-notes-${req.id}`}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
