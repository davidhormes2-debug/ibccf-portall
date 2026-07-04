import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { API_ENDPOINTS } from '@shared/constants';
import type { 
  AdminLoginRequest, 
  AdminLoginResponse,
  AuditLog,
  AdminSession,
  
  
  Notification,
  UserFeedback,
  DocumentRequest,
  InsertDocumentRequest,
  HelpArticle,
  InsertHelpArticle,
  Translation
} from '@shared/types';

export const adminKeys = {
  all: ['admin'] as const,
  auditLogs: () => [...adminKeys.all, 'audit'] as const,
  sessions: () => [...adminKeys.all, 'sessions'] as const,
  users: () => [...adminKeys.all, 'users'] as const,
  notifications: () => [...adminKeys.all, 'notifications'] as const,
  feedback: () => [...adminKeys.all, 'feedback'] as const,
  documents: () => [...adminKeys.all, 'documents'] as const,
  help: () => [...adminKeys.all, 'help'] as const,
  translations: (locale?: string) => [...adminKeys.all, 'translations', locale] as const,
};

export function useAdminLogin() {
  return useMutation({
    mutationFn: (data: AdminLoginRequest) =>
      apiClient.post<AdminLoginResponse>(API_ENDPOINTS.adminLogin, data),
    onSuccess: (data) => {
      sessionStorage.setItem('adminToken', data.token);
    },
  });
}

export function useAdminVerify() {
  return useQuery({
    queryKey: ['admin', 'verify'],
    queryFn: () => apiClient.get<{ valid: boolean }>(API_ENDPOINTS.adminVerify),
    retry: false,
  });
}

export function useAdminLogout() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => apiClient.post<void>(API_ENDPOINTS.adminLogout),
    onSuccess: () => {
      sessionStorage.removeItem('adminToken');
      queryClient.clear();
    },
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: adminKeys.auditLogs(),
    queryFn: () => apiClient.get<AuditLog[]>(API_ENDPOINTS.auditLogs),
  });
}

export function useAdminSessions() {
  return useQuery({
    queryKey: adminKeys.sessions(),
    queryFn: () => apiClient.get<AdminSession[]>(API_ENDPOINTS.adminSessions),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: adminKeys.notifications(),
    queryFn: () => apiClient.get<Notification[]>(API_ENDPOINTS.notifications),
    staleTime: 5000,
    refetchInterval: 5000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: number) =>
      apiClient.post<void>(API_ENDPOINTS.notificationRead(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.notifications() });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () =>
      apiClient.post<void>(API_ENDPOINTS.notificationsMarkAllRead),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.notifications() });
    },
  });
}

export function useUserFeedback() {
  return useQuery({
    queryKey: adminKeys.feedback(),
    queryFn: () => apiClient.get<UserFeedback[]>(API_ENDPOINTS.userFeedback),
  });
}

export function useSubmitFeedback() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { caseId: string; rating: number; comment?: string; category?: string }) =>
      apiClient.post<UserFeedback>(API_ENDPOINTS.userFeedback, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.feedback() });
    },
  });
}

export function useDocumentRequests() {
  return useQuery({
    queryKey: adminKeys.documents(),
    queryFn: () => apiClient.get<DocumentRequest[]>(API_ENDPOINTS.documentRequests),
  });
}

export function useCreateDocumentRequest() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: InsertDocumentRequest) =>
      apiClient.post<DocumentRequest>(API_ENDPOINTS.documentRequests, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.documents() });
    },
  });
}

export function useUpdateDocumentRequest() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DocumentRequest> }) =>
      apiClient.patch<DocumentRequest>(API_ENDPOINTS.documentRequestById(id), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.documents() });
    },
  });
}

export function useHelpArticles() {
  return useQuery({
    queryKey: adminKeys.help(),
    queryFn: () => apiClient.get<HelpArticle[]>(API_ENDPOINTS.helpArticles),
  });
}

export function useCreateHelpArticle() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: InsertHelpArticle) =>
      apiClient.post<HelpArticle>(API_ENDPOINTS.helpArticles, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.help() });
    },
  });
}

export function useDeleteHelpArticle() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: number) =>
      apiClient.delete<void>(API_ENDPOINTS.helpArticleById(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.help() });
    },
  });
}

export function useTranslations(locale?: string) {
  return useQuery({
    queryKey: adminKeys.translations(locale),
    queryFn: () => {
      const url = locale 
        ? API_ENDPOINTS.translationsByLocale(locale)
        : API_ENDPOINTS.translations;
      return apiClient.get<Translation[]>(url);
    },
  });
}

export function useCreateTranslation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { key: string; value: string; locale: string; context?: string }) =>
      apiClient.post<Translation>(API_ENDPOINTS.translations, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.translations() });
    },
  });
}
