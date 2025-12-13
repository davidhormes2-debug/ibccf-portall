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

export const CASE_STATUS_LABELS = {
  created: 'Created',
  registered: 'Registered',
  syncing: 'Syncing',
  active: 'Active',
  completed: 'Completed',
} as const;

export const CASE_STATUS_COLORS = {
  created: 'bg-gray-100 text-gray-800',
  registered: 'bg-blue-100 text-blue-800',
  syncing: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-purple-100 text-purple-800',
} as const;

export const MESSAGE_CATEGORY_LABELS = {
  urgent: 'Urgent',
  processing: 'Processing',
  resolved: 'Resolved',
} as const;

export const MESSAGE_CATEGORY_COLORS = {
  urgent: 'bg-red-100 text-red-800 border-red-200',
  processing: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  resolved: 'bg-green-100 text-green-800 border-green-200',
} as const;

export const PRIORITY_LABELS = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
} as const;

export const PRIORITY_COLORS = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
} as const;

export const RECEIPT_STATUS_LABELS = {
  pending: 'Pending Review',
  reviewed: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;

export const RECEIPT_STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  reviewed: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
} as const;

export const WITHDRAWAL_STAGES = [
  { stage: '1', label: 'Withdrawal Process Initiated', description: 'Your withdrawal request has been received and is being processed.' },
  { stage: '2', label: 'First Stage Verification Completed', description: 'Initial verification of your account and withdrawal details is complete.' },
  { stage: '3', label: 'Financial Department Verification', description: 'The financial department is reviewing your withdrawal request.' },
  { stage: '4', label: 'Miners Department', description: 'Transaction is being prepared for blockchain processing.' },
  { stage: '5', label: 'Money Laundry Funds Check', description: 'Compliance verification is in progress.' },
  { stage: '6', label: 'Final Withdrawal Processing', description: 'Your withdrawal is in the final processing stage.' },
  { stage: '7', label: 'Withdrawal Now Released', description: 'Congratulations! Your withdrawal has been released.' },
] as const;

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
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
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
