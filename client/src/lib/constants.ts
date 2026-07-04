// NOTE: Session timeout duration lives in shared/constants.ts → APP_CONFIG.sessionTimeout.
// Import APP_CONFIG from '@shared/constants' rather than declaring a local copy.

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

// NOTE: A flat ADMIN_ROLES enum (SUPER_ADMIN/ADMIN/AGENT/VIEWER) previously lived here.
// Admin-role string values are available in shared/constants.ts → ADMIN_ROLES (array of
// {value, label} objects) and as the AdminRole union type in shared/types.ts.

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
