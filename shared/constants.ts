export const APP_CONFIG = {
  name: 'IBCCF Customer Portal',
  version: '1.0.0',
  sessionTimeout: 3 * 60 * 1000, // 3 minutes
  pollInterval: 3000, // 3 seconds
  chatPollInterval: 3000,
  unreadPollInterval: 5000,
} as const;

export const BRANDING = {
  primaryColor: '#004182',
  accentColor: '#004AB3',
  fonts: {
    body: 'Public Sans',
    headings: 'Merriweather',
  },
} as const;


export const API_ENDPOINTS = {
  cases: '/api/cases',
  caseById: (id: string) => `/api/cases/${id}`,
  caseByAccess: (code: string) => `/api/cases/access/${code}`,
  caseLetter: (id: string) => `/api/cases/${id}/letter`,
  caseSubmissions: (id: string) => `/api/cases/${id}/submissions`,
  caseMessages: (id: string) => `/api/cases/${id}/messages`,
  caseMessagesRead: (id: string) => `/api/cases/${id}/messages/read`,
  caseAdminMessages: (id: string) => `/api/cases/${id}/admin-messages`,
  caseDepositReceipts: (id: string) => `/api/cases/${id}/deposit-receipts`,
  caseNotes: (id: string) => `/api/cases/${id}/notes`,
  
  submissions: '/api/submissions',
  
  adminMessages: '/api/admin-messages',
  adminMessageRead: (id: number) => `/api/admin-messages/${id}/read`,
  
  adminLogin: '/api/admin/login',
  adminVerify: '/api/admin/verify',
  adminLogout: '/api/admin/logout',
  
  chatTemplates: '/api/chat-templates',
  chatTemplateById: (id: number) => `/api/chat-templates/${id}`,
  chatTemplateUse: (id: number) => `/api/chat-templates/${id}/use`,
  
  messageTemplates: '/api/message-templates',
  messageTemplateById: (id: number) => `/api/message-templates/${id}`,
  
  scheduledMessages: '/api/scheduled-messages',
  scheduledMessageById: (id: number) => `/api/scheduled-messages/${id}`,
  
  helpArticles: '/api/help-articles',
  helpArticleById: (id: number) => `/api/help-articles/${id}`,
  
  userFeedback: '/api/user-feedback',
  
  documentRequests: '/api/document-requests',
  documentRequestById: (id: number) => `/api/document-requests/${id}`,
  
  notifications: '/api/notifications',
  notificationRead: (id: number) => `/api/notifications/${id}/read`,
  notificationsMarkAllRead: '/api/notifications/mark-all-read',
  
  auditLogs: '/api/audit-logs',
  adminSessions: '/api/admin-sessions',
  userSessions: '/api/user-sessions',
  
  translations: '/api/translations',
  translationsByLocale: (locale: string) => `/api/translations/${locale}`,
} as const;

export const CASE_STATUSES = [
  'created',
  'registered',
  'syncing',
  'active',
  'completed',
] as const;

export type CaseStatusValue = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Record<CaseStatusValue, string> = {
  created: 'Created',
  registered: 'Registered',
  syncing: 'Syncing',
  active: 'Active',
  completed: 'Completed',
};

export const CASE_STATUS_COLORS: Record<CaseStatusValue, string> = {
  created: 'bg-gray-100 text-gray-800',
  registered: 'bg-blue-100 text-blue-800',
  syncing: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-purple-100 text-purple-800',
};

export const MESSAGE_CATEGORY_STATUSES = [
  'urgent',
  'processing',
  'resolved',
] as const;

export type MessageCategoryValue = (typeof MESSAGE_CATEGORY_STATUSES)[number];

export const MESSAGE_CATEGORY_LABELS: Record<MessageCategoryValue, string> = {
  urgent: 'Urgent',
  processing: 'Processing',
  resolved: 'Resolved',
};

export const MESSAGE_CATEGORY_COLORS: Record<MessageCategoryValue, string> = {
  urgent: 'bg-red-100 text-red-800 border-red-200',
  processing: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  resolved: 'bg-green-100 text-green-800 border-green-200',
};

export const PRIORITY_STATUSES = [
  'high',
  'medium',
  'low',
] as const;

export type PriorityValue = (typeof PRIORITY_STATUSES)[number];

export const PRIORITY_LABELS: Record<PriorityValue, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const PRIORITY_COLORS: Record<PriorityValue, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
};

/**
 * Canonical list of receipt status values accepted by the merged inbox.
 * Used to derive the `?status=` Zod enum in `GET /api/deposits/all-receipts`
 * so adding a new status here automatically expands the accepted filter values.
 */
export const RECEIPT_STATUSES = [
  'pending',
  'reviewed',
  'approved',
  'rejected',
  'awaiting_admin_approval',
] as const;

export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  pending: 'Pending Review',
  reviewed: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
  awaiting_admin_approval: 'Awaiting Admin Approval',
} as const;

export const RECEIPT_STATUS_COLORS: Record<ReceiptStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  reviewed: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  awaiting_admin_approval: 'bg-yellow-100 text-yellow-800',
} as const;

/**
 * Canonical list of certificate fee payment status values.
 * Mirrors the set of values used for `cases.certificateFeeStatus` in the
 * server routes and the portal context type.
 */
export const CERTIFICATE_FEE_STATUSES = [
  'not_required',
  'awaiting_admin_approval',
  'approved',
  'rejected',
] as const;

export type CertificateFeeStatus = (typeof CERTIFICATE_FEE_STATUSES)[number];

export const CERTIFICATE_FEE_STATUS_LABELS: Record<CertificateFeeStatus, string> = {
  not_required: 'Not Required',
  awaiting_admin_approval: 'Awaiting Approval',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;

export const CERTIFICATE_FEE_STATUS_COLORS: Record<CertificateFeeStatus, string> = {
  not_required: 'bg-slate-100 text-slate-800',
  awaiting_admin_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
} as const;

/**
 * Canonical list of stamp duty status values.
 * Mirrors the set of values used for `cases.stampDutyStatus` in the server
 * routes and `client/src/lib/stampDutyHistory.ts`.
 */
export const STAMP_DUTY_STATUSES = [
  'awaiting_upload',
  'awaiting_admin_approval',
  'approved',
  'rejected',
] as const;

export type SharedStampDutyStatus = (typeof STAMP_DUTY_STATUSES)[number];

export const STAMP_DUTY_STATUS_LABELS: Record<SharedStampDutyStatus, string> = {
  awaiting_upload: 'Awaiting Upload',
  awaiting_admin_approval: 'Awaiting Approval',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;

export const STAMP_DUTY_STATUS_COLORS: Record<SharedStampDutyStatus, string> = {
  awaiting_upload: 'bg-amber-100 text-amber-800',
  awaiting_admin_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
} as const;

/**
 * Canonical list of document request status values.
 * Covers the full lifecycle: admin creates (pending), portal user uploads
 * (submitted), admin begins review (under_review), then approves or rejects.
 */
export const DOCUMENT_REQUEST_STATUSES = [
  'pending',
  'submitted',
  'under_review',
  'approved',
  'rejected',
] as const;

export type DocumentRequestStatus = (typeof DOCUMENT_REQUEST_STATUSES)[number];

export const DOCUMENT_REQUEST_STATUS_LABELS: Record<DocumentRequestStatus, string> = {
  pending: 'Pending',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;

export const DOCUMENT_REQUEST_STATUS_COLORS: Record<DocumentRequestStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  submitted: 'bg-blue-100 text-blue-800',
  under_review: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
} as const;

export const SYNC_STATUS_MESSAGES = [
  'Initializing secure handshake...',
  'Account phrase key generation process successfully started...',
  'File of customer is now being sorted...',
  'Account information is now being synchronised...',
  'Waiting for Final Clearance from ISO-D Secretariat...',
] as const;

export const LANDING_PAGE_OPTIONS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'letter', label: 'Letter' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'messages', label: 'Messages' },
] as const;

export const ADMIN_ROLES = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'agent', label: 'Agent' },
  { value: 'viewer', label: 'Viewer' },
] as const;

export const TEMPLATE_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'greeting', label: 'Greeting' },
  { value: 'support', label: 'Support' },
  { value: 'verification', label: 'Verification' },
  { value: 'deposits', label: 'Deposits' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'urgent', label: 'Urgent' },
] as const;

export const HELP_ARTICLE_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'deposits', label: 'Deposits' },
  { value: 'withdrawals', label: 'Withdrawals' },
  { value: 'account', label: 'Account' },
] as const;

export const DOCUMENT_TYPES = [
  { value: 'id_proof', label: 'ID Proof' },
  { value: 'address_proof', label: 'Address Proof' },
  { value: 'bank_statement', label: 'Bank Statement' },
  { value: 'other', label: 'Other' },
] as const;

export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'zh', label: 'Chinese' },
] as const;

export const VALIDATION = {
  accessCode: {
    minLength: 4,
    maxLength: 20,
    pattern: /^[a-zA-Z0-9]+$/,
  },
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  phone: {
    minLength: 7,
    maxLength: 20,
    pattern: /^[+]?[\d\s-()]+$/,
  },
  name: {
    minLength: 2,
    maxLength: 100,
  },
  message: {
    minLength: 1,
    maxLength: 5000,
  },
  password: {
    minLength: 8,
    maxLength: 100,
  },
} as const;

export const ERROR_MESSAGES = {
  generic: 'An error occurred. Please try again.',
  networkError: 'Unable to connect to server. Please check your connection.',
  unauthorized: 'You are not authorized to perform this action.',
  sessionExpired: 'Your session has expired. Please log in again.',
  invalidCredentials: 'Invalid username or password.',
  invalidAccessCode: 'Invalid access code.',
  uploadFailed: 'Failed to upload file. Please try again.',
  saveFailed: 'Failed to save changes. Please try again.',
  deleteFailed: 'Failed to delete. Please try again.',
  loadFailed: 'Failed to load data. Please refresh the page.',
} as const;

export const SUCCESS_MESSAGES = {
  saved: 'Changes saved successfully.',
  deleted: 'Deleted successfully.',
  uploaded: 'File uploaded successfully.',
  messageSent: 'Message sent successfully.',
  loginSuccess: 'Login successful.',
  logoutSuccess: 'Logged out successfully.',
  caseCreated: 'Case created successfully.',
  caseUpdated: 'Case updated successfully.',
  submissionReceived: 'Submission received successfully.',
} as const;

/**
 * The prefix written to a merge_fee deposit receipt's `notes` field.
 * Notes are stored as `"${BATCH_FEE_NOTES_PREFIX}<amount>"` (e.g.
 * `"Batch merge fee: 500 USDT"`).  `extractBatchAmountLabel` strips this
 * prefix before displaying the amount in Batch History rows.  Keeping the
 * string in one place means the producer and consumer can never silently drift.
 */
export const BATCH_FEE_NOTES_PREFIX = "Batch merge fee: " as const;
