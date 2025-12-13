export const WITHDRAWAL_STAGES = [
  { stage: '1', label: 'Withdrawal Process Initiated', description: 'Your withdrawal request has been received and is being processed.' },
  { stage: '2', label: 'First Stage Verification Completed', description: 'Initial verification of your account and withdrawal details is complete.' },
  { stage: '3', label: 'Financial Department Verification', description: 'The financial department is reviewing your withdrawal request.' },
  { stage: '4', label: 'Miners Department', description: 'Transaction is being prepared for blockchain processing.' },
  { stage: '5', label: 'Money Laundry Funds Check', description: 'Compliance verification is in progress.' },
  { stage: '6', label: 'Final Withdrawal Processing', description: 'Your withdrawal is in the final processing stage.' },
  { stage: '7', label: 'Withdrawal Now Released', description: 'Congratulations! Your withdrawal has been released.' },
] as const;

export const SESSION_TIMEOUT_MS = 3 * 60 * 1000;

export const POLLING_INTERVALS = {
  DATA: 3000,
  CHAT_UNREAD: 5000,
  NOTIFICATIONS: 10000,
} as const;

export const API_ENDPOINTS = {
  CASES: '/api/cases',
  SUBMISSIONS: '/api/submissions',
  MESSAGES: '/api/messages',
  ADMIN: '/api/admin',
  DEPOSITS: '/api/deposits',
  CHAT: '/api/chat',
  TEMPLATES: '/api/templates',
  HELP: '/api/help',
  TRANSLATIONS: '/api/translations',
  FEEDBACK: '/api/feedback',
  DOCUMENTS: '/api/documents',
  SESSIONS: '/api/sessions',
  AUDIT: '/api/audit',
  NOTIFICATIONS: '/api/notifications',
} as const;

export const MESSAGE_CATEGORIES = {
  URGENT: 'urgent',
  PROCESSING: 'processing',
  RESOLVED: 'resolved',
} as const;

export const CASE_STATUSES = {
  CREATED: 'created',
  REGISTERED: 'registered',
  SYNCING: 'syncing',
  ACTIVE: 'active',
  COMPLETED: 'completed',
} as const;

export const ADMIN_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  AGENT: 'agent',
  VIEWER: 'viewer',
} as const;

export const TOAST_MESSAGES = {
  SUCCESS: {
    SAVED: 'Changes saved successfully',
    SUBMITTED: 'Submission completed successfully',
    UPLOADED: 'File uploaded successfully',
    DELETED: 'Deleted successfully',
  },
  ERROR: {
    GENERIC: 'An error occurred. Please try again.',
    NETWORK: 'Network error. Please check your connection.',
    UNAUTHORIZED: 'You are not authorized to perform this action.',
    SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  },
} as const;
