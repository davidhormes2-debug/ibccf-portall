import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { API_ENDPOINTS } from '@shared/constants';
import type { 
  ChatMessage, 
  InsertChatMessage,
  AdminMessage,
  InsertAdminMessage,
  ChatTemplate,
  InsertChatTemplate,
  MessageTemplate,
  InsertMessageTemplate,
  ScheduledMessage,
  InsertScheduledMessage
} from '@shared/types';

export const messageKeys = {
  all: ['messages'] as const,
  chat: (caseId: string) => [...messageKeys.all, 'chat', caseId] as const,
  admin: (caseId: string) => [...messageKeys.all, 'admin', caseId] as const,
  allAdmin: () => [...messageKeys.all, 'admin-all'] as const,
  templates: {
    chat: () => [...messageKeys.all, 'templates', 'chat'] as const,
    message: () => [...messageKeys.all, 'templates', 'message'] as const,
  },
  scheduled: () => [...messageKeys.all, 'scheduled'] as const,
};

export function useChatMessages(caseId: string) {
  return useQuery({
    queryKey: messageKeys.chat(caseId),
    queryFn: () => apiClient.get<ChatMessage[]>(API_ENDPOINTS.caseMessages(caseId)),
    enabled: !!caseId,
    staleTime: 3000,
    refetchInterval: 3000,
  });
}

export function useSendChatMessage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ caseId, data }: { caseId: string; data: InsertChatMessage }) =>
      apiClient.post<ChatMessage>(API_ENDPOINTS.caseMessages(caseId), data),
    onSuccess: (_, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: messageKeys.chat(caseId) });
    },
  });
}

export function useMarkChatMessagesRead() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ caseId, sender }: { caseId: string; sender: 'admin' | 'user' }) =>
      apiClient.post<void>(API_ENDPOINTS.caseMessagesRead(caseId), { sender }),
    onSuccess: (_, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: messageKeys.chat(caseId) });
    },
  });
}

export function useAdminMessages(caseId: string) {
  return useQuery({
    queryKey: messageKeys.admin(caseId),
    queryFn: () => apiClient.get<AdminMessage[]>(API_ENDPOINTS.caseAdminMessages(caseId)),
    enabled: !!caseId,
  });
}

export function useSendAdminMessage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ caseId, data }: { caseId: string; data: InsertAdminMessage }) =>
      apiClient.post<AdminMessage>(API_ENDPOINTS.caseAdminMessages(caseId), data),
    onSuccess: (_, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: messageKeys.admin(caseId) });
    },
  });
}

export function useMarkAdminMessageRead() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: number) =>
      apiClient.post<void>(API_ENDPOINTS.adminMessageRead(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.allAdmin() });
    },
  });
}

export function useChatTemplates() {
  return useQuery({
    queryKey: messageKeys.templates.chat(),
    queryFn: () => apiClient.get<ChatTemplate[]>(API_ENDPOINTS.chatTemplates),
  });
}

export function useCreateChatTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: InsertChatTemplate) =>
      apiClient.post<ChatTemplate>(API_ENDPOINTS.chatTemplates, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.templates.chat() });
    },
  });
}

export function useDeleteChatTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: number) =>
      apiClient.delete<void>(API_ENDPOINTS.chatTemplateById(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.templates.chat() });
    },
  });
}

export function useUseChatTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: number) =>
      apiClient.post<void>(API_ENDPOINTS.chatTemplateUse(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.templates.chat() });
    },
  });
}

export function useMessageTemplates() {
  return useQuery({
    queryKey: messageKeys.templates.message(),
    queryFn: () => apiClient.get<MessageTemplate[]>(API_ENDPOINTS.messageTemplates),
  });
}

export function useCreateMessageTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: InsertMessageTemplate) =>
      apiClient.post<MessageTemplate>(API_ENDPOINTS.messageTemplates, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.templates.message() });
    },
  });
}

export function useDeleteMessageTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: number) =>
      apiClient.delete<void>(API_ENDPOINTS.messageTemplateById(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.templates.message() });
    },
  });
}

export function useScheduledMessages() {
  return useQuery({
    queryKey: messageKeys.scheduled(),
    queryFn: () => apiClient.get<ScheduledMessage[]>(API_ENDPOINTS.scheduledMessages),
  });
}

export function useCreateScheduledMessage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: InsertScheduledMessage) =>
      apiClient.post<ScheduledMessage>(API_ENDPOINTS.scheduledMessages, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.scheduled() });
    },
  });
}

export function useDeleteScheduledMessage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: number) =>
      apiClient.delete<void>(API_ENDPOINTS.scheduledMessageById(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.scheduled() });
    },
  });
}
