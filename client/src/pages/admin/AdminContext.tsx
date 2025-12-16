import React, { createContext, useContext, useState, useRef, useMemo, ReactNode, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/App";

export interface AdminData {
  vipStatus: string;
  username: string;
  withdrawalAmount: string;
  withdrawalBatches: string;
  physilocal0: string;
}

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
  priority?: string;
  assignedTo?: string;
  tags?: string;
  internalNotes?: string;
  showWithdrawalProgress?: boolean;
  withdrawalStage?: string;
  activityDepositAmount?: string;
  phraseKeyDepositAmount?: string;
  phraseKeyMergeDeposit?: string;
  activityWalletRequirement?: string;
  phraseKeyCertificateSent?: boolean;
  submissionUrl?: string;
  createdAt: string;
  updatedAt: string;
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
  imageData: string;
  fileName?: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNotes?: string;
  uploadedAt: string;
}

export interface CaseLetter {
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

export interface ChatTemplate {
  id: number;
  name: string;
  content: string;
  category?: string;
  shortcut?: string;
  usageCount?: string;
  isActive: boolean;
  createdAt: string;
}

export interface CaseNote {
  id: number;
  caseId: string;
  content: string;
  adminUsername: string;
  isPinned: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  adminUsername: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  description: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface AdminSession {
  id: string;
  adminUsername: string;
  token: string;
  ipAddress?: string;
  userAgent?: string;
  location?: string;
  isActive: boolean;
  lastActivityAt: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface Notification {
  id: number;
  recipientType: string;
  recipientId?: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface ScheduledMessage {
  id: number;
  caseId?: string;
  messageType: string;
  category?: string;
  title?: string;
  content: string;
  status: string;
  scheduledFor: string;
  createdBy?: string;
  createdAt: string;
}

export interface MessageTemplate {
  id: number;
  name: string;
  content: string;
  category?: string;
  isActive: boolean;
  usageCount?: string;
  createdBy?: string;
  createdAt: string;
}

export interface HelpArticle {
  id: number;
  title: string;
  content: string;
  category?: string;
  order?: string;
  isPublished: boolean;
  createdAt: string;
}

export interface UserFeedback {
  id: number;
  caseId: string;
  rating: string;
  comment?: string;
  feedbackType?: string;
  createdAt: string;
}

export interface DocumentRequest {
  id: number;
  caseId: string;
  documentType: string;
  description?: string;
  status: string;
  deadline?: string;
  submittedFileData?: string;
  submittedFileName?: string;
  adminNotes?: string;
  createdAt: string;
}

export type SettingsView = 'main' | 'audit' | 'sessions' | 'scheduled' | 'templates' | 'help' | 'feedback' | 'documents' | '2fa' | 'admin-users' | 'user-sessions' | 'translations';

export const playNotificationSound = () => {
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

interface AdminContextType {
  authToken: string | null;
  setAuthToken: (token: string | null) => void;
  cases: Case[];
  setCases: (cases: Case[]) => void;
  allSubmissions: Submission[];
  setAllSubmissions: (submissions: Submission[]) => void;
  isDataLoading: boolean;
  setIsDataLoading: (loading: boolean) => void;
  selectedCase: Case | null;
  setSelectedCase: (c: Case | null) => void;
  filteredCases: Case[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  statusFilter: string;
  setStatusFilter: (filter: string) => void;
  chatCase: Case | null;
  setChatCase: (c: Case | null) => void;
  chatMessages: ChatMessage[];
  setChatMessages: (messages: ChatMessage[]) => void;
  unreadCounts: Record<string, number>;
  setUnreadCounts: (counts: Record<string, number>) => void;
  totalUnread: number;
  setTotalUnread: (count: number) => void;
  adminMessages: AdminMessage[];
  setAdminMessages: (messages: AdminMessage[]) => void;
  depositReceipts: DepositReceipt[];
  setDepositReceipts: (receipts: DepositReceipt[]) => void;
  chatTemplates: ChatTemplate[];
  setChatTemplates: (templates: ChatTemplate[]) => void;
  caseNotes: CaseNote[];
  setCaseNotes: (notes: CaseNote[]) => void;
  auditLogs: AuditLog[];
  setAuditLogs: (logs: AuditLog[]) => void;
  adminSessions: AdminSession[];
  setAdminSessions: (sessions: AdminSession[]) => void;
  notifications: Notification[];
  setNotifications: (notifications: Notification[]) => void;
  unreadNotifications: number;
  setUnreadNotifications: (count: number) => void;
  scheduledMessages: ScheduledMessage[];
  setScheduledMessages: (messages: ScheduledMessage[]) => void;
  messageTemplates: MessageTemplate[];
  setMessageTemplates: (templates: MessageTemplate[]) => void;
  helpArticles: HelpArticle[];
  setHelpArticles: (articles: HelpArticle[]) => void;
  userFeedback: UserFeedback[];
  setUserFeedback: (feedback: UserFeedback[]) => void;
  documentRequests: DocumentRequest[];
  setDocumentRequests: (requests: DocumentRequest[]) => void;
  adminUsers: any[];
  setAdminUsers: (users: any[]) => void;
  userSessions: any[];
  setUserSessions: (sessions: any[]) => void;
  translations: {id: number; key: string; value: string; locale: string}[];
  setTranslations: (translations: {id: number; key: string; value: string; locale: string}[]) => void;
  settingsView: SettingsView;
  setSettingsView: (view: SettingsView) => void;
  lastMessageCountRef: React.MutableRefObject<Record<string, number>>;
  isInitialLoadRef: React.MutableRefObject<boolean>;
  lastRegisteredCountRef: React.MutableRefObject<number>;
  lastSubmissionsCountRef: React.MutableRefObject<number>;
  isInitialDataLoadRef: React.MutableRefObject<boolean>;
  toast: ReturnType<typeof useToast>['toast'];
  theme: string;
  toggleTheme: () => void;
  loadData: (showToast?: boolean) => Promise<void>;
  loadChatTemplates: () => Promise<void>;
  loadChatMessages: (caseId: string) => Promise<void>;
  sendChatMessage: (caseId: string, message: string) => Promise<void>;
  loadCaseNotes: (caseId: string) => Promise<void>;
  createCaseNote: (caseId: string, content: string) => Promise<void>;
  deleteCaseNote: (noteId: number, caseId: string) => Promise<void>;
  toggleNotePin: (noteId: number, caseId: string) => Promise<void>;
  createChatTemplate: (template: { name: string; content: string; category?: string }) => Promise<void>;
  deleteChatTemplate: (id: number) => Promise<void>;
}

const AdminContext = createContext<AdminContextType | null>(null);

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
}

interface AdminProviderProps {
  children: ReactNode;
  authToken: string | null;
  setAuthToken: (token: string | null) => void;
}

export function AdminProvider({ children, authToken, setAuthToken }: AdminProviderProps) {
  const [cases, setCases] = useState<Case[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  
  const [chatCase, setChatCase] = useState<Case | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [totalUnread, setTotalUnread] = useState(0);
  
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [depositReceipts, setDepositReceipts] = useState<DepositReceipt[]>([]);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const [chatTemplates, setChatTemplates] = useState<ChatTemplate[]>([]);
  const [caseNotes, setCaseNotes] = useState<CaseNote[]>([]);
  
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [adminSessions, setAdminSessions] = useState<AdminSession[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [helpArticles, setHelpArticles] = useState<HelpArticle[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [userSessions, setUserSessions] = useState<any[]>([]);
  const [userFeedback, setUserFeedback] = useState<UserFeedback[]>([]);
  const [documentRequests, setDocumentRequests] = useState<DocumentRequest[]>([]);
  const [translations, setTranslations] = useState<{id: number; key: string; value: string; locale: string}[]>([]);
  
  const [settingsView, setSettingsView] = useState<SettingsView>('main');
  
  const lastMessageCountRef = useRef<Record<string, number>>({});
  const isInitialLoadRef = useRef(true);
  const lastRegisteredCountRef = useRef(0);
  const lastSubmissionsCountRef = useRef(0);
  const isInitialDataLoadRef = useRef(true);
  
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  
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

  const loadData = useCallback(async (showToast = false) => {
    try {
      const token = authToken || sessionStorage.getItem('adminToken');
      const headers = { 'Authorization': `Bearer ${token}` };
      const [casesRes, submissionsRes] = await Promise.all([
        fetch('/api/cases', { headers }),
        fetch('/api/submissions', { headers })
      ]);
      
      if (casesRes.ok) {
        const data = await casesRes.json();
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
  }, [toast, authToken]);

  const loadChatTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/chat-templates', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const templates = await res.json();
        setChatTemplates(templates);
      }
    } catch (error) {
      console.error('Failed to load chat templates:', error);
    }
  }, [authToken]);

  const loadChatMessages = useCallback(async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/chat`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const messages = await res.json();
        setChatMessages(messages);
        
        const currentCount = messages.length;
        const prevCount = lastMessageCountRef.current[caseId] || 0;
        
        if (!isInitialLoadRef.current && currentCount > prevCount) {
          const latestMessage = messages[messages.length - 1];
          if (latestMessage?.sender === 'user') {
            playNotificationSound();
            toast({
              title: "New Message",
              description: `User sent a new message`
            });
          }
        }
        
        lastMessageCountRef.current[caseId] = currentCount;
        if (isInitialLoadRef.current) {
          isInitialLoadRef.current = false;
        }
      }
    } catch (error) {
      console.error('Failed to load chat messages:', error);
    }
  }, [toast, authToken]);

  const sendChatMessage = useCallback(async (caseId: string, message: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ sender: 'admin', message })
      });
      if (res.ok) {
        await loadChatMessages(caseId);
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to send message" });
    }
  }, [loadChatMessages, toast, authToken]);

  const loadCaseNotes = useCallback(async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/notes`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const notes = await res.json();
        setCaseNotes(notes);
      }
    } catch (error) {
      console.error('Failed to load case notes:', error);
    }
  }, [authToken]);

  const createCaseNote = useCallback(async (caseId: string, content: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/notes`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ content, adminUsername: 'Admin2025' })
      });
      if (res.ok) {
        toast({ title: "Note Added", description: "Case note created." });
        await loadCaseNotes(caseId);
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to add note" });
    }
  }, [authToken, loadCaseNotes, toast]);

  const deleteCaseNote = useCallback(async (noteId: number, caseId: string) => {
    try {
      await fetch(`/api/case-notes/${noteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      toast({ title: "Deleted", description: "Note removed." });
      await loadCaseNotes(caseId);
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete note" });
    }
  }, [authToken, loadCaseNotes, toast]);

  const toggleNotePin = useCallback(async (noteId: number, caseId: string) => {
    try {
      await fetch(`/api/case-notes/${noteId}/toggle-pin`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      await loadCaseNotes(caseId);
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to toggle pin" });
    }
  }, [authToken, loadCaseNotes, toast]);

  const createChatTemplate = useCallback(async (template: { name: string; content: string; category?: string }) => {
    if (!template.name.trim() || !template.content.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Name and content are required" });
      return;
    }
    try {
      const res = await fetch('/api/chat-templates', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(template)
      });
      if (res.ok) {
        toast({ title: "Template Created", description: "New chat template added." });
        await loadChatTemplates();
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to create template" });
    }
  }, [authToken, loadChatTemplates, toast]);

  const deleteChatTemplate = useCallback(async (id: number) => {
    try {
      await fetch(`/api/chat-templates/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      toast({ title: "Deleted", description: "Template removed." });
      await loadChatTemplates();
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete template" });
    }
  }, [authToken, loadChatTemplates, toast]);

  useEffect(() => {
    if (authToken) {
      loadData();
      loadChatTemplates();
      const interval = setInterval(() => loadData(), 3000);
      return () => clearInterval(interval);
    }
  }, [authToken, loadData, loadChatTemplates]);
  
  const value: AdminContextType = {
    authToken,
    setAuthToken,
    cases,
    setCases,
    allSubmissions,
    setAllSubmissions,
    isDataLoading,
    setIsDataLoading,
    selectedCase,
    setSelectedCase,
    filteredCases,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    chatCase,
    setChatCase,
    chatMessages,
    setChatMessages,
    unreadCounts,
    setUnreadCounts,
    totalUnread,
    setTotalUnread,
    adminMessages,
    setAdminMessages,
    depositReceipts,
    setDepositReceipts,
    chatTemplates,
    setChatTemplates,
    caseNotes,
    setCaseNotes,
    auditLogs,
    setAuditLogs,
    adminSessions,
    setAdminSessions,
    notifications,
    setNotifications,
    unreadNotifications,
    setUnreadNotifications,
    scheduledMessages,
    setScheduledMessages,
    messageTemplates,
    setMessageTemplates,
    helpArticles,
    setHelpArticles,
    userFeedback,
    setUserFeedback,
    documentRequests,
    setDocumentRequests,
    adminUsers,
    setAdminUsers,
    userSessions,
    setUserSessions,
    translations,
    setTranslations,
    settingsView,
    setSettingsView,
    lastMessageCountRef,
    isInitialLoadRef,
    lastRegisteredCountRef,
    lastSubmissionsCountRef,
    isInitialDataLoadRef,
    toast,
    theme,
    toggleTheme,
    loadData,
    loadChatTemplates,
    loadChatMessages,
    sendChatMessage,
    loadCaseNotes,
    createCaseNote,
    deleteCaseNote,
    toggleNotePin,
    createChatTemplate,
    deleteChatTemplate,
  };
  
  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
}

export default AdminContext;
