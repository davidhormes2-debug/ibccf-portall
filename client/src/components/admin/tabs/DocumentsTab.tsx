import { Fragment, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle,
  XCircle,
  Eye,
  Download,
  FolderLock,
  RefreshCw,
  FileCheck2,
  Search,
} from "lucide-react";
import { useAdminDashboard } from "../AdminDashboardContext";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentRequest } from "../shared";

type CategoryKey =
  | "all"
  | "proof_of_income"
  | "source_of_funds"
  | "kyc_id"
  | "fatca_crs"
  | "bank_statement"
  | "tax_return"
  | "wallet_ownership_proof"
  | "aml_screening"
  | "beneficial_ownership"
  | "declaration"
  | "custom";

type StatusKey = "all" | "pending" | "submitted" | "approved" | "rejected";

// Loose category inference from the free-form `documentType` string.
// Mirrors the portal-side categoryFor() map but normalised for filtering.
function inferCategory(documentType: string): Exclude<CategoryKey, "all"> {
  const t = (documentType ?? "").toLowerCase();
  if (t.startsWith("declaration:")) return "declaration";
  if (
    t === "proof_of_income" ||
    /proof.*income|income.*proof|proof of source of income|payslip|salary/.test(t)
  ) {
    return "proof_of_income";
  }
  if (t === "source_of_funds" || /source.*funds|funds.*source/.test(t)) {
    return "source_of_funds";
  }
  if (
    t === "kyc_id" ||
    /\bkyc\b|identity|id\s*proof|passport|driver|driving|national\s*id|selfie|holding\s*id/.test(
      t,
    )
  ) {
    return "kyc_id";
  }
  if (t === "fatca_crs" || /fatca|crs|tax.*resid/.test(t)) {
    return "fatca_crs";
  }
  if (t === "bank_statement" || /bank.*statement|account.*statement/.test(t)) {
    return "bank_statement";
  }
  if (t === "tax_return" || /tax.*return|1040|w-?2|form.*16/.test(t)) {
    return "tax_return";
  }
  if (
    t === "wallet_ownership_proof" ||
    /wallet.*owner|signed.*message|proof.*of.*ownership/.test(t)
  ) {
    return "wallet_ownership_proof";
  }
  if (t === "aml_screening" || /\baml\b|sanctions|pep/.test(t)) {
    return "aml_screening";
  }
  if (
    t === "beneficial_ownership" ||
    /beneficial.*owner|ubo|ownership.*declaration/.test(t)
  ) {
    return "beneficial_ownership";
  }
  return "custom";
}

const CATEGORY_LABELS: Record<Exclude<CategoryKey, "all">, string> = {
  proof_of_income: "Proof of Income",
  source_of_funds: "Source of Funds",
  kyc_id: "KYC Identity",
  fatca_crs: "FATCA / CRS",
  bank_statement: "Bank Statement",
  tax_return: "Tax Return",
  wallet_ownership_proof: "Wallet Ownership Proof",
  aml_screening: "AML / Sanctions Screening",
  beneficial_ownership: "Beneficial Ownership",
  declaration: "Declaration",
  custom: "Custom",
};

function statusPillClass(status: string): string {
  const s = status?.toLowerCase();
  if (s === "approved")
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (s === "rejected") return "bg-red-500/15 text-red-300 border-red-500/30";
  if (s === "submitted" || s === "under_review")
    return "bg-blue-500/15 text-blue-300 border-blue-500/30";
  return "bg-amber-500/15 text-amber-300 border-amber-500/30";
}

function categoryPillClass(c: Exclude<CategoryKey, "all">): string {
  switch (c) {
    case "proof_of_income":
      return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
    case "source_of_funds":
      return "bg-amber-500/10 text-amber-300 border-amber-500/30";
    case "kyc_id":
      return "bg-blue-500/10 text-blue-300 border-blue-500/30";
    case "fatca_crs":
      return "bg-violet-500/10 text-violet-300 border-violet-500/30";
    case "declaration":
      return "bg-cyan-500/10 text-cyan-300 border-cyan-500/30";
    default:
      return "bg-slate-500/10 text-slate-300 border-slate-500/30";
  }
}

async function downloadSubmission(
  req: DocumentRequest,
  cached: string | undefined,
  fetcher: (id: number) => Promise<string | null>,
) {
  let data = req.submittedFileData ?? cached ?? null;
  if (!data) data = await fetcher(req.id);
  if (!data) return;
  const a = document.createElement("a");
  a.href = data;
  a.download = req.submittedFileName || "document";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function DocumentsTab() {
  const {
    cases,
    documentRequests,
    loadDocumentRequests,
    fetchDocumentFile,
    approveDocumentRequest,
    rejectDocumentRequest,
    markDocumentUnderReview,
    isDataLoading,
    adminRole,
  } = useAdminDashboard();

  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>("all");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("submitted");
  const [search, setSearch] = useState("");
  const [previewOpen, setPreviewOpen] = useState<Set<number>>(new Set());
  const [previewData, setPreviewData] = useState<Record<number, string>>({});
  const [rejectFor, setRejectFor] = useState<number | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({});
  const [approveNotes, setApproveNotes] = useState<Record<number, string>>({});

  const togglePreview = async (doc: DocumentRequest) => {
    const id = doc.id;
    if (previewOpen.has(id)) {
      setPreviewOpen((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    let data: string | null = doc.submittedFileData ?? previewData[id] ?? null;
    if (!data) data = await fetchDocumentFile(id);
    if (data) {
      const blob: string = data;
      setPreviewData((prev) => ({ ...prev, [id]: blob }));
      setPreviewOpen((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
  };

  const caseLookup = useMemo(() => {
    const m = new Map<string, { name: string; email: string }>();
    for (const c of cases) {
      m.set(c.id, {
        name: (c.userName ?? "").trim() || "—",
        email: c.userEmail ?? "",
      });
    }
    return m;
  }, [cases]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documentRequests
      .map((d) => ({ doc: d, category: inferCategory(d.documentType) }))
      .filter(({ doc, category }) => {
        if (categoryFilter !== "all" && category !== categoryFilter)
          return false;
        if (statusFilter !== "all") {
          const s = (doc.status ?? "").toLowerCase();
          if (statusFilter === "submitted") {
            if (s !== "submitted" && s !== "under_review") return false;
          } else if (s !== statusFilter) return false;
        }
        if (q) {
          const c = caseLookup.get(doc.caseId);
          const haystack = `${doc.documentType} ${doc.caseId} ${c?.name ?? ""} ${c?.email ?? ""}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ad = a.doc.submittedAt || a.doc.createdAt;
        const bd = b.doc.submittedAt || b.doc.createdAt;
        return new Date(bd).getTime() - new Date(ad).getTime();
      });
  }, [documentRequests, categoryFilter, statusFilter, search, caseLookup]);

  const counts = useMemo(() => {
    const submitted = documentRequests.filter(
      (d) => d.status === "submitted" || d.status === "under_review",
    ).length;
    const approved = documentRequests.filter(
      (d) => d.status === "approved",
    ).length;
    const rejected = documentRequests.filter(
      (d) => d.status === "rejected",
    ).length;
    return { total: documentRequests.length, submitted, approved, rejected };
  }, [documentRequests]);

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <FolderLock className="w-5 h-5 text-blue-400" /> Uploaded Documents
          </h2>
          <p className="text-slate-400 text-sm">
            Review every regulatory document submitted across all cases —
            preview, download, approve, or reject in one place.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadDocumentRequests()}
          className="border-slate-700 text-slate-200 hover:bg-slate-800"
          data-testid="button-refresh-documents"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Counter strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="bg-slate-950 border-slate-800 p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide">Total</p>
          <p className="text-2xl font-bold text-white">{counts.total}</p>
        </Card>
        <Card className="bg-slate-950 border-slate-800 p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide">Awaiting review</p>
          <p className="text-2xl font-bold text-blue-300">{counts.submitted}</p>
        </Card>
        <Card className="bg-slate-950 border-slate-800 p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide">Approved</p>
          <p className="text-2xl font-bold text-emerald-300">{counts.approved}</p>
        </Card>
        <Card className="bg-slate-950 border-slate-800 p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide">Rejected</p>
          <p className="text-2xl font-bold text-red-300">{counts.rejected}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-slate-950 border-slate-800 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Category</Label>
            <Select
              value={categoryFilter}
              onValueChange={(v) => setCategoryFilter(v as CategoryKey)}
            >
              <SelectTrigger
                className="bg-slate-900 border-slate-700 text-slate-200"
                data-testid="select-filter-category"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="proof_of_income">Proof of Income</SelectItem>
                <SelectItem value="source_of_funds">Source of Funds</SelectItem>
                <SelectItem value="kyc_id">KYC Identity</SelectItem>
                <SelectItem value="fatca_crs">FATCA / CRS</SelectItem>
                <SelectItem value="bank_statement">Bank Statement</SelectItem>
                <SelectItem value="tax_return">Tax Return</SelectItem>
                <SelectItem value="wallet_ownership_proof">Wallet Ownership Proof</SelectItem>
                <SelectItem value="aml_screening">AML / Sanctions Screening</SelectItem>
                <SelectItem value="beneficial_ownership">Beneficial Ownership</SelectItem>
                <SelectItem value="declaration">Declaration</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Status</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusKey)}
            >
              <SelectTrigger
                className="bg-slate-900 border-slate-700 text-slate-200"
                data-testid="select-filter-status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending (no upload yet)</SelectItem>
                <SelectItem value="submitted">Submitted — awaiting review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Case ID, user name, email, document type…"
              className="bg-slate-900 border-slate-700 text-slate-200"
              data-testid="input-filter-search"
            />
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="bg-slate-950 border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-900">
              <TableRow className="hover:bg-slate-900 border-slate-800">
                <TableHead className="text-slate-400">Submitted</TableHead>
                <TableHead className="text-slate-400">Case / User</TableHead>
                <TableHead className="text-slate-400">Document</TableHead>
                <TableHead className="text-slate-400">Category</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400">File</TableHead>
                <TableHead className="text-slate-400 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isDataLoading && filtered.length === 0 ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent border-slate-800 animate-pulse">
                    <TableCell colSpan={7}>
                      <div className="h-10 bg-slate-900/60 rounded" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent border-slate-800">
                  <TableCell colSpan={7} className="text-center py-12 text-slate-500">
                    No documents match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(({ doc, category }) => {
                  const c = caseLookup.get(doc.caseId);
                  const isReviewable =
                    doc.status === "submitted" || doc.status === "under_review";
                  return (
                    <Fragment key={doc.id}>
                      <TableRow
                        key={`${doc.id}-row`}
                        className="hover:bg-slate-900/50 border-slate-800 align-top"
                        data-testid={`row-document-${doc.id}`}
                      >
                        <TableCell className="text-slate-300 text-xs whitespace-nowrap">
                          {doc.submittedAt
                            ? new Date(doc.submittedAt).toLocaleString()
                            : new Date(doc.createdAt).toLocaleDateString()}
                          {!doc.submittedAt && (
                            <div className="text-[10px] text-slate-600 mt-0.5">
                              not yet uploaded
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium text-white truncate max-w-[180px]">
                            {c?.name || "—"}
                          </div>
                          <div className="text-slate-500 truncate max-w-[180px]">
                            {c?.email || "—"}
                          </div>
                          <div className="text-slate-600 font-mono text-[10px] mt-0.5 truncate max-w-[180px]">
                            {doc.caseId}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-200 text-sm">
                          <div className="font-medium">{doc.documentType}</div>
                          {doc.description && (
                            <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 max-w-[280px]">
                              {doc.description}
                            </div>
                          )}
                          {doc.adminNotes && (
                            <div className="text-[11px] text-slate-500 mt-0.5 italic">
                              Reviewer: {doc.adminNotes}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] border ${categoryPillClass(category)}`}
                          >
                            {CATEGORY_LABELS[category]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize border ${statusPillClass(doc.status)}`}
                          >
                            {(doc.status || "pending").replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {doc.submittedFileName ? (
                            (doc.submittedFileData || doc.hasSubmittedFile) ? (
                              <div className="flex items-center gap-1">
                                <FileCheck2 className="h-3 w-3 text-blue-400" />
                                <span className="text-slate-300 truncate max-w-[120px]">
                                  {doc.submittedFileName}
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5 text-blue-300 hover:bg-blue-500/10"
                                  onClick={() => togglePreview(doc)}
                                  data-testid={`button-preview-document-${doc.id}`}
                                >
                                  <Eye className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5 text-blue-300 hover:bg-blue-500/10"
                                  onClick={() => downloadSubmission(doc, previewData[doc.id], fetchDocumentFile)}
                                  data-testid={`button-download-document-${doc.id}`}
                                >
                                  <Download className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-slate-600 text-slate-400 bg-slate-800/50"
                              >
                                Archived (file removed after 90d)
                              </Badge>
                            )
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {isReviewable && (adminRole === 'admin' || adminRole === 'super_admin') ? (
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {doc.status === "submitted" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => markDocumentUnderReview(doc.id)}
                                  className="border-blue-500/40 text-blue-300 hover:bg-blue-500/10 h-7 px-2"
                                  data-testid={`button-under-review-doc-${doc.id}`}
                                >
                                  <Search className="h-3 w-3 mr-1" /> Under Review
                                </Button>
                              )}
                              <Button
                                size="sm"
                                onClick={() =>
                                  approveDocumentRequest(doc.id, approveNotes[doc.id])
                                }
                                className="bg-emerald-600/80 hover:bg-emerald-500 text-white h-7 px-2"
                                data-testid={`button-approve-doc-${doc.id}`}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setRejectFor(rejectFor === doc.id ? null : doc.id)
                                }
                                className="border-red-500/40 text-red-300 hover:bg-red-500/10 h-7 px-2"
                                data-testid={`button-reject-doc-${doc.id}`}
                              >
                                <XCircle className="h-3 w-3 mr-1" /> Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {previewOpen.has(doc.id) && (doc.submittedFileData || previewData[doc.id]) && (
                        <TableRow
                          key={`${doc.id}-preview`}
                          className="hover:bg-transparent border-slate-800"
                        >
                          <TableCell colSpan={7} className="bg-slate-900/40">
                            <div className="p-2">
                              <DocumentPreview
                                dataUrl={(doc.submittedFileData || previewData[doc.id])!}
                                fileName={doc.submittedFileName}
                                variant="admin"
                                testIdPrefix={`documents-tab-preview-${doc.id}`}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {isReviewable && rejectFor === doc.id && (
                        <TableRow
                          key={`${doc.id}-reject`}
                          className="hover:bg-transparent border-slate-800"
                        >
                          <TableCell colSpan={7} className="bg-red-950/10">
                            <div className="p-2 space-y-2">
                              <Textarea
                                placeholder="Tell the user what needs fixing or resubmitting…"
                                value={rejectNotes[doc.id] || ""}
                                onChange={(e) =>
                                  setRejectNotes((prev) => ({
                                    ...prev,
                                    [doc.id]: e.target.value,
                                  }))
                                }
                                rows={2}
                                className="bg-slate-950 border-slate-700 text-slate-200 text-sm resize-none"
                                data-testid={`textarea-reject-doc-${doc.id}`}
                              />
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setRejectFor(null);
                                    setRejectNotes((prev) => ({ ...prev, [doc.id]: "" }));
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    await rejectDocumentRequest(
                                      doc.id,
                                      rejectNotes[doc.id] || "",
                                    );
                                    setRejectFor(null);
                                  }}
                                  className="bg-red-600 hover:bg-red-500"
                                  data-testid={`button-confirm-reject-doc-${doc.id}`}
                                >
                                  Confirm rejection
                                </Button>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {isReviewable && (
                        <TableRow
                          key={`${doc.id}-approve-note`}
                          className="hover:bg-transparent border-slate-800"
                        >
                          <TableCell colSpan={7} className="py-1 px-3 bg-slate-950/60">
                            <Input
                              placeholder="Optional approval note for the user"
                              value={approveNotes[doc.id] || ""}
                              onChange={(e) =>
                                setApproveNotes((prev) => ({
                                  ...prev,
                                  [doc.id]: e.target.value,
                                }))
                              }
                              className="bg-slate-900 border-slate-800 text-slate-300 text-xs h-7"
                              data-testid={`input-approve-note-doc-${doc.id}`}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  );
}
