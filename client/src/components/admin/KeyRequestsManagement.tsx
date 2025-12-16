import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Key, Check, X, Send, Clock, AlertTriangle, CheckCircle, XCircle, Mail, User, Phone, MessageSquare, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

export function KeyRequestsManagement() {
  const [requests, setRequests] = useState<AccessKeyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [selectedRequest, setSelectedRequest] = useState<AccessKeyRequest | null>(null);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const { toast } = useToast();

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/access-key-requests/admin/list?status=${statusFilter}`);
      if (response.ok) {
        const data = await response.json();
        setRequests(data);
      }
    } catch (error) {
      console.error("Error fetching requests:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [statusFilter]);

  const handleApprove = async (request: AccessKeyRequest) => {
    try {
      const response = await fetch(`/api/access-key-requests/admin/${request.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUsername: 'Admin' }),
      });
      
      if (response.ok) {
        toast({ title: "Request Approved", description: `Key ${request.generatedKey} is now active for ${request.userName}.` });
        fetchRequests();
        setSelectedRequest(null);
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve request", variant: "destructive" });
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    
    try {
      const response = await fetch(`/api/access-key-requests/admin/${selectedRequest.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    } catch (error) {
      toast({ title: "Error", description: "Failed to reject request", variant: "destructive" });
    }
  };

  const handleSendMessage = async () => {
    if (!selectedRequest || !newMessage.trim()) return;
    
    try {
      const response = await fetch(`/api/access-key-requests/admin/${selectedRequest.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    } catch (error) {
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

      <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full">
        <TabsList className="bg-slate-800 border-slate-700">
          <TabsTrigger value="pending" className="data-[state=active]:bg-slate-700 relative" data-testid="filter-pending">
            Pending
            {pendingCount > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-500 text-black rounded-full">{pendingCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved" className="data-[state=active]:bg-slate-700" data-testid="filter-approved">
            Approved
          </TabsTrigger>
          <TabsTrigger value="rejected" className="data-[state=active]:bg-slate-700" data-testid="filter-rejected">
            Rejected
          </TabsTrigger>
          <TabsTrigger value="expired" className="data-[state=active]:bg-slate-700" data-testid="filter-expired">
            Expired
          </TabsTrigger>
          <TabsTrigger value="all" className="data-[state=active]:bg-slate-700" data-testid="filter-all">
            All
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
        </div>
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
                  <TableCell>{getStatusBadge(request.status)}</TableCell>
                  <TableCell className="text-slate-400 text-sm">
                    {new Date(request.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {request.status === 'pending' && (
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button 
                          size="sm" 
                          className="bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => handleApprove(request)}
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
                  onClick={() => handleApprove(selectedRequest)}
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
