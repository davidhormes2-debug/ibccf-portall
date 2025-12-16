import { useState } from "react";
import { Link } from "wouter";
import { Shield, Lock, ArrowLeft, Send, Clock, CheckCircle, XCircle, AlertTriangle, Key, User, Mail, Phone, MessageSquare, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";

interface AdminMessage {
  message: string;
  adminUsername: string;
  timestamp: string;
}

interface RequestStatus {
  requestId: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  userName: string | null;
  createdAt: string;
  expiresAt: string;
  adminMessages: AdminMessage[];
  accessKey?: string;
  rejectedAt?: string | null;
}

export default function RequestAccessKey() {
  const [mode, setMode] = useState<'request' | 'check'>('request');
  const [isLoading, setIsLoading] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  
  const [formData, setFormData] = useState({
    userName: '',
    userEmail: '',
    userPhone: '',
    requestReason: ''
  });
  
  const [submittedRequestId, setSubmittedRequestId] = useState('');
  const { toast } = useToast();

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.userName.trim() || !formData.userEmail.trim()) {
      toast({
        variant: "destructive",
        title: "Required Fields",
        description: "Please fill in your name and email address.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/access-key-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      
      if (res.ok) {
        const data = await res.json();
        setSubmittedRequestId(data.requestId);
        toast({
          title: "Request Submitted",
          description: "Your access key request has been submitted for review.",
        });
      } else {
        const error = await res.json();
        toast({
          variant: "destructive",
          title: "Submission Failed",
          description: error.error || "Unable to submit request. Please try again.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to submit request. Please try again later.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!requestId.trim()) {
      toast({
        variant: "destructive",
        title: "Required Field",
        description: "Please enter your request ID.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/access-key-requests/status/${requestId}`);
      
      if (res.ok) {
        const data = await res.json();
        setRequestStatus(data);
      } else {
        toast({
          variant: "destructive",
          title: "Not Found",
          description: "Request ID not found. Please check and try again.",
        });
        setRequestStatus(null);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to check status. Please try again later.",
      });
    } finally {
      setIsLoading(false);
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-600 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" /> Under Review</Badge>;
      case 'approved':
        return <Badge className="bg-green-500/20 text-green-600 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" /> Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-600 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
      case 'expired':
        return <Badge className="bg-gray-500/20 text-gray-600 border-gray-500/30"><AlertTriangle className="w-3 h-3 mr-1" /> Expired</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#004182] to-[#002d5a] font-['Public_Sans',sans-serif]">
      <header className="bg-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/verify" className="flex items-center gap-2 text-white hover:opacity-80 transition-opacity">
              <ArrowLeft className="h-5 w-5" />
              <span className="font-medium">Back to Verify</span>
            </Link>
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-white" />
              <span className="text-xl font-bold text-white font-['Merriweather',serif]">IBCCF</span>
            </div>
            <ThemeToggle className="text-white" />
          </div>
        </div>
      </header>

      <main className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">
          {submittedRequestId ? (
            <Card className="bg-white rounded-2xl shadow-2xl">
              <CardContent className="p-8">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="h-8 w-8 text-green-600" />
                  </div>
                  <h1 className="text-2xl font-bold text-[#0F172B] font-['Merriweather',serif] mb-2">
                    Request Submitted
                  </h1>
                  <p className="text-slate-600">
                    Your access key request has been submitted for review.
                  </p>
                </div>
                
                <div className="bg-slate-100 rounded-lg p-4 mb-6">
                  <p className="text-sm text-slate-600 mb-1">Your Request ID:</p>
                  <p className="text-2xl font-mono font-bold text-[#004182] text-center">{submittedRequestId}</p>
                </div>
                
                <div className="space-y-4 text-sm text-slate-600">
                  <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-[#004182] mt-0.5" />
                    <p>Please save this Request ID. You'll need it to check your request status and retrieve your access key once approved.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-[#004182] mt-0.5" />
                    <p>Our team will review your request and may send you messages if additional information is needed.</p>
                  </div>
                </div>
                
                <div className="flex gap-3 mt-6">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setRequestId(submittedRequestId);
                      setSubmittedRequestId('');
                      setMode('check');
                    }}
                    data-testid="button-check-submitted"
                  >
                    Check Status
                  </Button>
                  <Button
                    className="flex-1 bg-[#004AB3] hover:bg-[#003d99]"
                    onClick={() => {
                      setSubmittedRequestId('');
                      setFormData({ userName: '', userEmail: '', userPhone: '', requestReason: '' });
                    }}
                    data-testid="button-new-request"
                  >
                    New Request
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="bg-white rounded-2xl shadow-2xl p-8">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-[#004182]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Key className="h-8 w-8 text-[#004182]" />
                </div>
                <h1 className="text-2xl font-bold text-[#0F172B] font-['Merriweather',serif] mb-2">
                  {mode === 'request' ? 'Request Access Key' : 'Check Request Status'}
                </h1>
                <p className="text-slate-600">
                  {mode === 'request' 
                    ? "Submit a request to receive an access key for the secure portal."
                    : "Enter your request ID to check the status of your application."
                  }
                </p>
              </div>

              <div className="flex mb-6 border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => { setMode('request'); setRequestStatus(null); }}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    mode === 'request' 
                      ? 'text-[#004AB3] border-b-2 border-[#004AB3]' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                  data-testid="tab-request"
                >
                  <Send className="w-4 h-4 inline mr-2" />
                  New Request
                </button>
                <button
                  type="button"
                  onClick={() => setMode('check')}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    mode === 'check' 
                      ? 'text-[#004AB3] border-b-2 border-[#004AB3]' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                  data-testid="tab-check-status"
                >
                  <FileText className="w-4 h-4 inline mr-2" />
                  Check Status
                </button>
              </div>

              {mode === 'request' ? (
                <form onSubmit={handleSubmitRequest} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      <User className="w-4 h-4 inline mr-1" /> Full Name *
                    </label>
                    <Input
                      type="text"
                      value={formData.userName}
                      onChange={(e) => setFormData(prev => ({ ...prev, userName: e.target.value }))}
                      placeholder="Enter your full name"
                      className="w-full border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                      data-testid="input-user-name"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      <Mail className="w-4 h-4 inline mr-1" /> Email Address *
                    </label>
                    <Input
                      type="email"
                      value={formData.userEmail}
                      onChange={(e) => setFormData(prev => ({ ...prev, userEmail: e.target.value }))}
                      placeholder="Enter your email address"
                      className="w-full border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                      data-testid="input-user-email"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      <Phone className="w-4 h-4 inline mr-1" /> Phone Number (optional)
                    </label>
                    <Input
                      type="tel"
                      value={formData.userPhone}
                      onChange={(e) => setFormData(prev => ({ ...prev, userPhone: e.target.value }))}
                      placeholder="Enter your phone number"
                      className="w-full border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                      data-testid="input-user-phone"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      <MessageSquare className="w-4 h-4 inline mr-1" /> Reason for Request (optional)
                    </label>
                    <Textarea
                      value={formData.requestReason}
                      onChange={(e) => setFormData(prev => ({ ...prev, requestReason: e.target.value }))}
                      placeholder="Briefly describe why you need access..."
                      className="w-full min-h-[80px] border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                      data-testid="input-request-reason"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-12 bg-[#004AB3] hover:bg-[#003d99] text-white font-semibold text-lg shadow-lg"
                    disabled={isLoading}
                    data-testid="button-submit-request"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Submitting...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Send className="h-5 w-5" />
                        Submit Request
                      </span>
                    )}
                  </Button>
                </form>
              ) : (
                <div className="space-y-4">
                  <form onSubmit={handleCheckStatus} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        <FileText className="w-4 h-4 inline mr-1" /> Request ID
                      </label>
                      <Input
                        type="text"
                        value={requestId}
                        onChange={(e) => setRequestId(e.target.value.toUpperCase())}
                        placeholder="Enter your request ID (e.g., REQ-XXXXXX)"
                        className="w-full font-mono border-slate-300 focus:border-[#004182] focus:ring-[#004182]"
                        data-testid="input-request-id"
                      />
                    </div>

                    <Button
                      type="submit"
                      className="w-full h-12 bg-[#004AB3] hover:bg-[#003d99] text-white font-semibold text-lg shadow-lg"
                      disabled={isLoading}
                      data-testid="button-check-status"
                    >
                      {isLoading ? (
                        <span className="flex items-center gap-2">
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Checking...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <FileText className="h-5 w-5" />
                          Check Status
                        </span>
                      )}
                    </Button>
                  </form>

                  {requestStatus && (
                    <Card className="border-slate-200 bg-slate-50">
                      <CardContent className="p-4 space-y-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm text-slate-500">Request ID</p>
                            <p className="font-mono font-bold text-[#004182]">{requestStatus.requestId}</p>
                          </div>
                          {getStatusBadge(requestStatus.status)}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-slate-500">Name</p>
                            <p className="font-medium">{requestStatus.userName || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Submitted</p>
                            <p className="font-medium">{new Date(requestStatus.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>

                        {requestStatus.status === 'approved' && (
                          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <div className="flex items-center gap-2 text-green-700 mb-2">
                              <CheckCircle className="w-5 h-5" />
                              <span className="font-semibold">Your Access Key</span>
                            </div>
                            <p className="text-3xl font-mono font-bold text-green-600 text-center py-2">{requestStatus.accessKey}</p>
                            <p className="text-sm text-green-600 text-center mt-2">
                              Use this key on the verification page to access your portal.
                            </p>
                            <Link href="/verify">
                              <Button className="w-full mt-3 bg-green-600 hover:bg-green-700" data-testid="button-go-verify">
                                Go to Verification Page
                              </Button>
                            </Link>
                          </div>
                        )}

                        {requestStatus.status === 'rejected' && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                            <div className="flex items-center gap-2 text-red-700 mb-2">
                              <XCircle className="w-5 h-5" />
                              <span className="font-semibold">Request Rejected</span>
                            </div>
                            <p className="text-sm text-red-600">
                              Your request has been reviewed and could not be approved. Please check any messages from our team below for more information.
                            </p>
                          </div>
                        )}

                        {requestStatus.status === 'expired' && (
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center gap-2 text-gray-700 mb-2">
                              <AlertTriangle className="w-5 h-5" />
                              <span className="font-semibold">Request Expired</span>
                            </div>
                            <p className="text-sm text-gray-600">
                              This request has expired. Please submit a new access key request.
                            </p>
                          </div>
                        )}

                        {requestStatus.status === 'pending' && (
                          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                            <div className="flex items-center gap-2 text-yellow-700 mb-2">
                              <Clock className="w-5 h-5" />
                              <span className="font-semibold">Under Review</span>
                            </div>
                            <p className="text-sm text-yellow-700">
                              Your request is being reviewed by our team. Please check back later for updates.
                            </p>
                          </div>
                        )}

                        {requestStatus.adminMessages && requestStatus.adminMessages.length > 0 && (
                          <div className="border-t border-slate-200 pt-4">
                            <p className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                              <MessageSquare className="w-4 h-4" /> Messages from Admin
                            </p>
                            <div className="space-y-2">
                              {requestStatus.adminMessages.map((msg, i) => (
                                <div key={i} className="bg-white border border-slate-200 rounded-lg p-3">
                                  <p className="text-sm text-slate-800">{msg.message}</p>
                                  <p className="text-xs text-slate-400 mt-2">
                                    {new Date(msg.timestamp).toLocaleString()}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-slate-200">
                <div className="flex items-start gap-3 text-sm text-slate-600">
                  <Lock className="h-4 w-4 mt-0.5 text-[#004182]" />
                  <p>
                    Access key requests are reviewed by our security team. Processing typically takes 1-3 business days.
                  </p>
                </div>
              </div>
            </div>
          )}

          <p className="text-center text-white/60 text-sm mt-6">
            Protected by enterprise-grade encryption
          </p>
        </div>
      </main>
    </div>
  );
}
