import React, { useState, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Key, Check, X, Send, Clock, AlertTriangle, CheckCircle, XCircle, Mail, User, Phone, MessageSquare, RefreshCw, Copy, ClipboardCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const VERIFICATION_EMAIL_TEMPLATE = `To proceed with your case, we require the following documentation. Please provide all items as completely as possible — incomplete submissions will delay the review of your case.

Please reply to this email with the requested information and attach all supporting files, or upload them through your secure case portal.

────────────────────────────────────────
SECTION 1 — IDENTITY VERIFICATION
────────────────────────────────────────

□  Full legal name as it appears on your government-issued ID
□  Date of birth
□  Country of residence
□  A clear, legible copy of your government-issued photo ID
   (passport, national identity card, or driver's licence)
□  A selfie photograph of yourself holding the ID next to your face

────────────────────────────────────────
SECTION 2 — ACCOUNT & PLATFORM DETAILS
────────────────────────────────────────

□  Full name of the platform or exchange where your funds are held
□  The email address or username registered on that platform
□  The date your account was opened
□  The date of your first deposit or investment
□  The date your funds became inaccessible or frozen

────────────────────────────────────────
SECTION 3 — FINANCIAL RECORDS
────────────────────────────────────────

□  Total amount involved (specify each asset type: BTC, ETH, USDT, etc.)
□  A complete deposit and withdrawal history
   (screenshots or CSV export from the platform)
□  All transaction IDs / transaction hashes associated with your funds
□  Wallet addresses used (both sending and receiving)
□  Blockchain explorer links confirming the transactions
   (e.g. etherscan.io, blockchain.com, bscscan.com)

────────────────────────────────────────
SECTION 4 — PROOF OF COMMUNICATIONS
────────────────────────────────────────

□  All email correspondence with the platform
   (export as PDF or full screenshots)
□  Any live-chat, support-ticket, or chat-thread logs
□  A full record of all withdrawal requests you submitted and their status
□  Any refusal, delay, or excuse messages you received from the platform

────────────────────────────────────────
SECTION 5 — PAYMENT HISTORY  ⚠ CRITICAL
────────────────────────────────────────

Please provide a complete record of every payment made TO the platform
AFTER your initial deposit. This includes any:
  • Taxes or tax clearance fees
  • Release fees or unlocking fees
  • Compliance or regulatory charges
  • Insurance or indemnity payments
  • Verification or identity fees
  • Any other payment requested by the platform

For EACH such payment, please provide:
  – Date of payment
  – Amount and currency / asset type
  – Reason given by the platform for the payment
  – Proof of payment (transaction hash, or bank / card statement)

────────────────────────────────────────
SECTION 6 — ADDITIONAL CONTEXT
────────────────────────────────────────

□  A brief description of how you found or were introduced to this platform
□  The name of any person who referred or recruited you (if applicable)
□  Whether you have filed a report with local law enforcement or a financial
   regulator — if yes, include the reference number and attach a copy
□  Any other information you believe may be relevant to our investigation

────────────────────────────────────────

A member of our compliance team will review your submission and contact you
within 3–5 business days.

If you have any questions, please reply directly to this message.

Regards,
IBCCF Compliance Team
International Blockchain Complaints Forum`;

function KeyRequestsLoadingSkeleton() {
  return (
    <div className="space-y-2 py-2" aria-label="Loading key requests…">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-slate-700/50">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32 flex-1" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      ))}
    </div>
  );
}

interface AccessKeyRequest {
  id: number;
  requestId: string;
  generatedKey: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  userName: string | null;
  userEmail: string | null;
  userPhone: string | null;
  requestReason: string | null;
  adminMessages: string | null;
  adminUsername: string | null;
  caseId: string | null;
  caseRef: string | null;
  expiresAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  keyViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AdminMessage {
  message: string;
  adminUsername: string;
  timestamp: string;
}

interface KeyRequestsManagementProps {
  authToken?: string | null;
}

export function KeyRequestsManagement({ authToken }: KeyRequestsManagementProps = {}) {
  const [requests, setRequests] = useState<AccessKeyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [selectedRequest, setSelectedRequest] = useState<AccessKeyRequest | null>(null);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const [lastApproved, setLastApproved] = useState<{ requestId: string; userName: string | null; key: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [verificationDialogOpen, setVerificationDialogOpen] = useState(false);
  const [pendingApprovalRequest, setPendingApprovalRequest] = useState<AccessKeyRequest | null>(null);
  const [verificationEmailBody, setVerificationEmailBody] = useState('');
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const { toast } = useToast();
  const reducedMotion = useReducedMotion();
  const fadeTransition = reducedMotion ? { duration: 0 } : { duration: 0.15, ease: "easeInOut" as const };

  const getAuthHeader = () => ({
    Authorization: `Bearer ${authToken || sessionStorage.getItem('adminToken') || ''}`,
  });

  const fetchRequests = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/access-key-requests/admin/list?status=${statusFilter}`, {
        headers: getAuthHeader(),
      });
      if (response.ok) {
        const data = await response.json();
        setRequests(data);
      } else {
        setError("Failed to load requests — please try again.");
      }
    } catch (err) {
      console.error("Error fetching requests:", err);
      setError("Failed to load requests — please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [statusFilter]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && error !== null) {
        fetchRequests();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [error, statusFilter]);

  const handleApprove = async (request: AccessKeyRequest) => {
    try {
      const response = await fetch(`/api/access-key-requests/admin/${request.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ adminUsername: 'Admin' }),
      });
      
      if (response.ok) {
        setLastApproved({ requestId: request.requestId, userName: request.userName, key: request.generatedKey });
        setCopiedKey(false);
        toast({ title: "Request Approved", description: `Key ${request.generatedKey} is now active for ${request.userName}.` });
        fetchRequests();
        setSelectedRequest(null);
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error, variant: "destructive" });
      }
    } catch (_e) {
      toast({ title: "Error", description: "Failed to approve request", variant: "destructive" });
    }
  };

  const openVerificationDialog = (request: AccessKeyRequest) => {
    setPendingApprovalRequest(request);
    setVerificationEmailBody(VERIFICATION_EMAIL_TEMPLATE);
    setVerificationDialogOpen(true);
  };

  const handleApproveAndSend = async () => {
    if (!pendingApprovalRequest) return;
    setIsSendingVerification(true);
    try {
      const approveRes = await fetch(`/api/access-key-requests/admin/${pendingApprovalRequest.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ adminUsername: 'Admin' }),
      });
      if (!approveRes.ok) {
        const err = await approveRes.json();
        toast({ title: "Approval failed", description: err.error, variant: "destructive" });
        return;
      }
      const emailRes = await fetch(`/api/access-key-requests/admin/${pendingApprovalRequest.id}/send-verification-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ body: verificationEmailBody }),
      });
      if (!emailRes.ok) {
        const err = await emailRes.json();
        toast({ title: "Approved — but verification email failed", description: err.error, variant: "destructive" });
      } else {
        toast({ title: "Approved & questionnaire sent", description: `Verification email sent to ${pendingApprovalRequest.userName}.` });
      }
      setLastApproved({ requestId: pendingApprovalRequest.requestId, userName: pendingApprovalRequest.userName, key: pendingApprovalRequest.generatedKey });
      setCopiedKey(false);
      setVerificationDialogOpen(false);
      setSelectedRequest(null);
      fetchRequests();
    } catch (_e) {
      toast({ title: "Error", description: "Failed to approve request", variant: "destructive" });
    } finally {
      setIsSendingVerification(false);
    }
  };

  const handleApproveWithoutEmail = async () => {
    if (!pendingApprovalRequest) return;
    setIsSendingVerification(true);
    try {
      await handleApprove(pendingApprovalRequest);
      setVerificationDialogOpen(false);
    } finally {
      setIsSendingVerification(false);
    }
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    });
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    
    try {
      const response = await fetch(`/api/access-key-requests/admin/${selectedRequest.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ adminUsername: 'Admin', reason: rejectReason }),
      });
      
      if (response.ok) {
        toast({ title: "Request Rejected", description: `Key request from ${selectedRequest.userName} has been rejected.` });
        fetchRequests();
        setSelectedRequest(null);
        setConfirmRejectOpen(false);
        setRejectReason('');
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error, variant: "destructive" });
      }
    } catch (_e) {
      toast({ title: "Error", description: "Failed to reject request", variant: "destructive" });
    }
  };

  const handleSendMessage = async () => {
    if (!selectedRequest || !newMessage.trim()) return;
    
    try {
      const response = await fetch(`/api/access-key-requests/admin/${selectedRequest.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ message: newMessage, adminUsername: 'Admin' }),
      });
      
      if (response.ok) {
        toast({ title: "Message Sent", description: "Your message has been sent to the user." });
        setNewMessage('');
        setMessageDialogOpen(false);
        fetchRequests();
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error, variant: "destructive" });
      }
    } catch (_e) {
      toast({ title: "Error", description: "Failed to send message", variant: "destructive" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'approved':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" /> Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
      case 'expired':
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30"><AlertTriangle className="w-3 h-3 mr-1" /> Expired</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const parseMessages = (messagesJson: string | null): AdminMessage[] => {
    if (!messagesJson) return [];
    try {
      return JSON.parse(messagesJson);
    } catch {
      return [];
    }
  };

  const getRejectionReason = (request: AccessKeyRequest): string | null => {
    const msgs = parseMessages(request.adminMessages);
    const rejMsg = msgs.find(m => m.message.toLowerCase().startsWith("request rejected:"));
    if (!rejMsg) return null;
    const extracted = rejMsg.message.replace(/^Request rejected:\s*/i, "").trim();
    return extracted || null;
  };

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Access Key Requests</h2>
          <p className="text-slate-400 text-sm">Review and approve user key generation requests.</p>
        </div>
        <Button variant="outline" onClick={fetchRequests} className="border-slate-700" data-testid="button-refresh-requests">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Approval confirmation banner */}
      {lastApproved && (
        <div className="bg-green-900/30 border border-green-700/50 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-testid="banner-approval-confirmed">
          <div className="flex items-center gap-2 text-green-400 shrink-0">
            <CheckCircle className="w-5 h-5" />
            <span className="font-semibold text-sm">Approved</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-slate-300 text-sm">
              <span className="font-medium text-white">{lastApproved.userName || 'User'}</span> ({lastApproved.requestId}) has been approved. Their access key is ready:
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xl font-bold text-green-300 bg-green-900/40 px-3 py-1 rounded-lg border border-green-700/50 tracking-widest" data-testid="text-approved-key">
              {lastApproved.key}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="border-green-700 text-green-400 hover:bg-green-900/40"
              onClick={() => handleCopyKey(lastApproved.key)}
              data-testid="button-copy-approved-key"
            >
              {copiedKey ? <ClipboardCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-slate-500 hover:text-slate-300"
              onClick={() => setLastApproved(null)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full">
        <TabsList className="bg-slate-900 border-slate-800">
          <TabsTrigger value="pending" className="data-[state=active]:bg-slate-800 relative" data-testid="filter-pending">
            Pending
            {pendingCount > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-500 text-black rounded-full">{pendingCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved" className="data-[state=active]:bg-slate-800" data-testid="filter-approved">
            Approved
          </TabsTrigger>
          <TabsTrigger value="rejected" className="data-[state=active]:bg-slate-800" data-testid="filter-rejected">
            Rejected
          </TabsTrigger>
          <TabsTrigger value="expired" className="data-[state=active]:bg-slate-800" data-testid="filter-expired">
            Expired
          </TabsTrigger>
          <TabsTrigger value="all" className="data-[state=active]:bg-slate-800" data-testid="filter-all">
            All
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AnimatePresence initial={false}>
        {loading ? (
          <motion.div
            key="kr-skeleton"
            exit={{ opacity: 0 }}
            transition={fadeTransition}
          >
            <Card className="bg-slate-800/50 border-slate-700">
              <KeyRequestsLoadingSkeleton />
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="kr-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={fadeTransition}
          >
        {error ? (
        <Card className="bg-slate-800/50 border-slate-700" data-testid="key-requests-error">
          <CardContent className="p-12 text-center">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-400" />
            <h3 className="text-lg font-medium text-red-300 mb-2">Failed to load requests</h3>
            <p className="text-slate-400 mb-4">Please try again or contact support if the problem persists.</p>
            <Button variant="outline" onClick={fetchRequests} className="border-slate-600">
              <RefreshCw className="w-4 h-4 mr-2" /> Try Again
            </Button>
          </CardContent>
        </Card>
      ) : requests.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-12 text-center">
            <Key className="w-12 h-12 mx-auto mb-4 text-slate-500" />
            <h3 className="text-lg font-medium text-slate-300 mb-2">No Requests Found</h3>
            <p className="text-slate-500">No {statusFilter === 'all' ? '' : statusFilter} key requests at this time.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-slate-800/50 border-slate-700">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">Request ID</TableHead>
                <TableHead className="text-slate-400">Case Ref</TableHead>
                <TableHead className="text-slate-400">User</TableHead>
                <TableHead className="text-slate-400">Contact</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400">Requested</TableHead>
                <TableHead className="text-slate-400">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow 
                  key={request.id} 
                  className="border-slate-700 hover:bg-slate-700/30 cursor-pointer"
                  onClick={() => setSelectedRequest(request)}
                  data-testid={`row-request-${request.id}`}
                >
                  <TableCell className="font-mono text-blue-400">{request.requestId}</TableCell>
                  <TableCell>
                    {request.caseRef ? (
                      <span className="font-mono text-xs text-fuchsia-300 tracking-wider">{request.caseRef}</span>
                    ) : (
                      <span className="text-slate-600 text-xs italic">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-slate-500" />
                      <span className="text-white">{request.userName || 'N/A'}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <div className="flex items-center gap-1 text-slate-400">
                        <Mail className="w-3 h-3" /> {request.userEmail || 'N/A'}
                      </div>
                      {request.userPhone && (
                        <div className="flex items-center gap-1 text-slate-500">
                          <Phone className="w-3 h-3" /> {request.userPhone}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {getStatusBadge(request.status)}
                      {request.status === 'rejected' && (() => {
                        const reason = getRejectionReason(request);
                        return reason ? (
                          <p className="text-[11px] text-red-400/80 italic line-clamp-1 max-w-[180px]">
                            {reason}
                          </p>
                        ) : null;
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-400 text-sm">
                    {new Date(request.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {request.status === 'pending' && (
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button 
                          size="sm" 
                          className="bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => openVerificationDialog(request)}
                          data-testid={`button-approve-${request.id}`}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          className="border-slate-600 text-slate-300"
                          onClick={() => {
                            setSelectedRequest(request);
                            setMessageDialogOpen(true);
                          }}
                          data-testid={`button-message-${request.id}`}
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="destructive"
                          onClick={() => {
                            setSelectedRequest(request);
                            setConfirmRejectOpen(true);
                          }}
                          data-testid={`button-reject-${request.id}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                    {request.status === 'approved' && (
                      <span className="text-slate-500 text-sm">
                        Key: <span className="font-mono text-green-400">{request.generatedKey}</span>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={!!selectedRequest && !messageDialogOpen && !confirmRejectOpen} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-blue-400" />
              Request Details - {selectedRequest?.requestId}
            </DialogTitle>
          </DialogHeader>
          
          {selectedRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-400">Status</label>
                  <div className="mt-1">{getStatusBadge(selectedRequest.status)}</div>
                </div>
                <div>
                  <label className="text-sm text-slate-400">Generated Key</label>
                  <div className="font-mono text-lg text-blue-400 mt-1">{selectedRequest.generatedKey}</div>
                </div>
              </div>

              {selectedRequest.status === 'rejected' && (() => {
                const reason = getRejectionReason(selectedRequest);
                return (
                  <div className="rounded-lg border border-red-500/30 bg-red-950/30 p-4">
                    <div className="flex items-start gap-3">
                      <XCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-red-400 mb-1">Rejection Reason</p>
                        {reason ? (
                          <p className="text-sm text-red-200/90 leading-relaxed">{reason}</p>
                        ) : (
                          <p className="text-sm text-slate-500 italic">No reason provided.</p>
                        )}
                        {selectedRequest.rejectedAt && (
                          <p className="text-xs text-red-400/60 mt-2">
                            Rejected on {new Date(selectedRequest.rejectedAt).toLocaleString()} by {selectedRequest.adminUsername || 'Admin'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-400">Name</label>
                  <div className="text-white mt-1">{selectedRequest.userName || 'N/A'}</div>
                </div>
                <div>
                  <label className="text-sm text-slate-400">Email</label>
                  <div className="text-white mt-1">{selectedRequest.userEmail || 'N/A'}</div>
                </div>
              </div>
              
              {selectedRequest.userPhone && (
                <div>
                  <label className="text-sm text-slate-400">Phone</label>
                  <div className="text-white mt-1">{selectedRequest.userPhone}</div>
                </div>
              )}
              
              {selectedRequest.requestReason && (
                <div>
                  <label className="text-sm text-slate-400">Reason for Request</label>
                  <div className="text-white mt-1 bg-slate-800 p-3 rounded">{selectedRequest.requestReason}</div>
                </div>
              )}
              
              <div>
                <label className="text-sm text-slate-400">Timestamps</label>
                <div className="text-sm text-slate-300 mt-1 space-y-1">
                  <div>Created: {new Date(selectedRequest.createdAt).toLocaleString()}</div>
                  <div>Expires: {new Date(selectedRequest.expiresAt).toLocaleString()}</div>
                  {selectedRequest.approvedAt && <div className="text-green-400">Approved: {new Date(selectedRequest.approvedAt).toLocaleString()}</div>}
                  {selectedRequest.rejectedAt && <div className="text-red-400">Rejected: {new Date(selectedRequest.rejectedAt).toLocaleString()}</div>}
                  {selectedRequest.keyViewedAt && <div className="text-blue-400">Key Viewed: {new Date(selectedRequest.keyViewedAt).toLocaleString()}</div>}
                </div>
              </div>

              {parseMessages(selectedRequest.adminMessages).length > 0 && (
                <div>
                  <label className="text-sm text-slate-400 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> Admin Messages
                  </label>
                  <ScrollArea className="h-32 mt-2">
                    <div className="space-y-2">
                      {parseMessages(selectedRequest.adminMessages).map((msg, i) => (
                        <div key={i} className="bg-slate-800 p-3 rounded text-sm">
                          <div className="text-slate-400 text-xs mb-1">
                            {msg.adminUsername} - {new Date(msg.timestamp).toLocaleString()}
                          </div>
                          <div className="text-white">{msg.message}</div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
          
          <DialogFooter>
            {selectedRequest?.status === 'pending' && (
              <>
                <Button 
                  variant="outline" 
                  className="border-slate-600"
                  onClick={() => {
                    setMessageDialogOpen(true);
                  }}
                >
                  <Send className="w-4 h-4 mr-2" /> Send Message
                </Button>
                <Button 
                  variant="destructive"
                  onClick={() => setConfirmRejectOpen(true)}
                >
                  <X className="w-4 h-4 mr-2" /> Reject
                </Button>
                <Button 
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => openVerificationDialog(selectedRequest)}
                >
                  <Check className="w-4 h-4 mr-2" /> Approve
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={messageDialogOpen} onOpenChange={setMessageDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-blue-400" />
              Send Message to {selectedRequest?.userName}
            </DialogTitle>
          </DialogHeader>
          
          <div>
            <Textarea
              placeholder="Type your message to the user..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white min-h-[120px]"
              data-testid="input-admin-message"
            />
            <p className="text-xs text-slate-500 mt-2">
              This message will be visible to the user when they check their request status.
            </p>
          </div>
          
          <DialogFooter>
            <Button variant="outline" className="border-slate-600" onClick={() => setMessageDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="bg-blue-600 hover:bg-blue-700"
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
              data-testid="button-send-message"
            >
              <Send className="w-4 h-4 mr-2" /> Send Message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verification email dialog — shown when admin clicks Approve */}
      <Dialog open={verificationDialogOpen} onOpenChange={(open) => { if (!isSendingVerification) setVerificationDialogOpen(open); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-blue-400" />
              Send Verification Questionnaire
            </DialogTitle>
            <p className="text-slate-400 text-sm mt-1">
              Approving <span className="text-white font-medium">{pendingApprovalRequest?.userName}</span>
              {pendingApprovalRequest?.userEmail && (
                <span className="text-slate-500"> ({pendingApprovalRequest.userEmail})</span>
              )}
              {' '}will activate their access key. Review and edit the questionnaire below before sending.
            </p>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto py-2">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-slate-800/60 rounded-lg p-3">
                  <div className="text-slate-400 text-xs mb-1">Request ID</div>
                  <div className="font-mono text-blue-400 text-xs">{pendingApprovalRequest?.requestId}</div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-3">
                  <div className="text-slate-400 text-xs mb-1">Recipient</div>
                  <div className="text-white text-xs truncate">{pendingApprovalRequest?.userEmail || '—'}</div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-3">
                  <div className="text-slate-400 text-xs mb-1">Subject</div>
                  <div className="text-slate-300 text-xs">IBCCF — Verification Documentation Required</div>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">
                  Email body — edit as needed before sending
                </label>
                <Textarea
                  value={verificationEmailBody}
                  onChange={(e) => setVerificationEmailBody(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white font-mono text-xs leading-relaxed min-h-[340px] resize-none"
                  data-testid="input-verification-email-body"
                  disabled={isSendingVerification}
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  The email will be wrapped in the standard IBCCF template. Plain text only — no HTML needed.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 flex flex-col sm:flex-row gap-2 sm:gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2 sm:mr-auto disabled:opacity-50"
              onClick={handleApproveWithoutEmail}
              disabled={isSendingVerification}
              data-testid="button-approve-without-email"
            >
              Approve without sending email
            </button>
            <Button
              variant="outline"
              className="border-slate-600"
              onClick={() => setVerificationDialogOpen(false)}
              disabled={isSendingVerification}
            >
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 disabled:opacity-60"
              onClick={handleApproveAndSend}
              disabled={isSendingVerification || !verificationEmailBody.trim()}
              data-testid="button-approve-and-send"
            >
              {isSendingVerification ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
              ) : (
                <><Check className="w-4 h-4 mr-2" /><Mail className="w-4 h-4 mr-2" /> Approve &amp; Send Questionnaire</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRejectOpen} onOpenChange={setConfirmRejectOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <XCircle className="w-5 h-5" />
              Reject Request
            </DialogTitle>
          </DialogHeader>
          
          <div>
            <p className="text-slate-300 mb-4">
              Are you sure you want to reject the key request from <strong>{selectedRequest?.userName}</strong>?
            </p>
            <Textarea
              placeholder="Reason for rejection (optional, will be shown to user)..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
              data-testid="input-reject-reason"
            />
          </div>
          
          <DialogFooter>
            <Button variant="outline" className="border-slate-600" onClick={() => setConfirmRejectOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleReject}
              data-testid="button-confirm-reject"
            >
              <X className="w-4 h-4 mr-2" /> Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
