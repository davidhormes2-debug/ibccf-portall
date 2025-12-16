// Re-export all types from schema for API usage
export {
  type Case,
  type InsertCase,
  type UpdateCase,
  type CaseLetter,
  type InsertCaseLetter,
  type UpdateCaseLetter,
  type CaseSubmission,
  type InsertCaseSubmission,
  type ChatMessage,
  type InsertChatMessage,
  type AdminMessage,
  type InsertAdminMessage,
  type DepositReceipt,
  type InsertDepositReceipt,
  type CaseNote,
  type InsertCaseNote,
  type AuditLog,
  type InsertAuditLog,
  type AdminSession,
  type InsertAdminSession,
  type UserSession,
  type InsertUserSession,
  type AdminUser,
  type InsertAdminUser,
  type Notification,
  type InsertNotification,
  type UserFeedback,
  type InsertUserFeedback,
  type DocumentRequest,
  type InsertDocumentRequest,
  type HelpArticle,
  type InsertHelpArticle,
  type Translation,
  type InsertTranslation,
  type ChatTemplate,
  type InsertChatTemplate,
  type MessageTemplate,
  type InsertMessageTemplate,
  type ScheduledMessage,
  type InsertScheduledMessage,
} from './schema';

// Import for local use in interfaces
import type {
  Case,
  CaseLetter,
  CaseSubmission,
  ChatMessage,
  AdminMessage,
  DepositReceipt,
  CaseNote,
} from './schema';

export type CaseStatus = 'created' | 'registered' | 'syncing' | 'active' | 'completed';
export type MessageCategory = 'urgent' | 'processing' | 'resolved';
export type MessageSender = 'admin' | 'user';
export type ReceiptStatus = 'pending' | 'reviewed' | 'approved' | 'rejected';
export type Priority = 'high' | 'medium' | 'low';
export type LandingPage = 'dashboard' | 'letter' | 'deposit' | 'messages';
export type AdminRole = 'super_admin' | 'admin' | 'agent' | 'viewer';
export type RecipientType = 'admin' | 'user';
export type ScheduledMessageType = 'chat' | 'admin_message' | 'letter';
export type ScheduledMessageStatus = 'pending' | 'sent' | 'cancelled';
export type DocumentStatus = 'pending' | 'submitted' | 'approved' | 'rejected';
export type FeedbackType = 'support' | 'overall' | 'feature';
export type ActorType = 'user' | 'admin' | 'system';

export type PortalViewState = 
  | 'login' 
  | 'register' 
  | 'sync' 
  | 'dashboard' 
  | 'letter' 
  | 'messages' 
  | 'submissions' 
  | 'success' 
  | 'deposit' 
  | 'timeline';

export type AdminSettingsView = 
  | 'main' 
  | 'audit' 
  | 'sessions' 
  | 'scheduled' 
  | 'templates' 
  | 'help' 
  | 'feedback' 
  | 'documents' 
  | '2fa' 
  | 'admin-users' 
  | 'user-sessions' 
  | 'translations';

export const LOCALES = ['en', 'es', 'zh', 'ja', 'ko', 'de', 'fr'] as const;
export type Locale = typeof LOCALES[number];

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminLoginRequest {
  username: string;
  password: string;
}

export interface AdminLoginResponse {
  token: string;
  username: string;
  role?: AdminRole;
}

export interface UserRegistrationData {
  userName: string;
  userEmail: string;
  userMobile: string;
}

export interface AdminFinalizationData {
  vipStatus: string;
  username: string;
  withdrawalAmount: string;
  withdrawalBatches: string;
  physilocal0: string;
}

export interface LetterFormData {
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

export interface NewAdminMessageForm {
  category: MessageCategory;
  title: string;
  body: string;
}

export interface NewScheduledMessageForm {
  caseId: string;
  messageType: ScheduledMessageType;
  category: string;
  title: string;
  content: string;
  scheduledFor: string;
}

export interface NewMessageTemplateForm {
  name: string;
  content: string;
  category: string;
}

export interface NewHelpArticleForm {
  title: string;
  content: string;
  category: string;
  isPublished: boolean;
}

export interface NewDocumentRequestForm {
  caseId: string;
  documentType: string;
  description: string;
  deadline: string;
}

export interface NewChatTemplateForm {
  name: string;
  content: string;
  category: string;
}

export interface UnreadCounts {
  [caseId: string]: number;
}

export interface CaseWithDetails {
  case: Case;
  letter?: CaseLetter;
  submissions: CaseSubmission[];
  messages: ChatMessage[];
  adminMessages: AdminMessage[];
  receipts: DepositReceipt[];
  notes?: CaseNote[];
}

export interface DashboardStats {
  totalCases: number;
  activeCases: number;
  pendingCases: number;
  completedCases: number;
  totalSubmissions: number;
  unreadMessages: number;
  pendingReceipts: number;
}

export interface ChartDataPoint {
  name: string;
  value: number;
  color?: string;
}

export interface TimelineEntry {
  id: number;
  timestamp: string;
  action: string;
  description: string;
  actor: ActorType;
  actorId?: string;
}
