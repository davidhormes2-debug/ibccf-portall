import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { API_ENDPOINTS } from '@shared/constants';
import type { 
  Case, 
  InsertCase, 
  UpdateCase,
  CaseLetter,
  InsertCaseLetter,
  UpdateCaseLetter,
  CaseSubmission,
  InsertCaseSubmission,
  CaseNote,
  InsertCaseNote
} from '@shared/types';

export const caseKeys = {
  all: ['cases'] as const,
  lists: () => [...caseKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...caseKeys.lists(), filters] as const,
  details: () => [...caseKeys.all, 'detail'] as const,
  detail: (id: string) => [...caseKeys.details(), id] as const,
  byAccess: (code: string) => [...caseKeys.all, 'access', code] as const,
  letter: (id: string) => [...caseKeys.detail(id), 'letter'] as const,
  submissions: (id: string) => [...caseKeys.detail(id), 'submissions'] as const,
  notes: (id: string) => [...caseKeys.detail(id), 'notes'] as const,
};

export function useCases() {
  return useQuery({
    queryKey: caseKeys.lists(),
    queryFn: () => apiClient.get<Case[]>(API_ENDPOINTS.cases),
    staleTime: 3000,
    refetchInterval: 3000,
  });
}

export function useCase(id: string) {
  return useQuery({
    queryKey: caseKeys.detail(id),
    queryFn: () => apiClient.get<Case>(API_ENDPOINTS.caseById(id)),
    enabled: !!id,
  });
}

export function useCaseByAccessCode(code: string) {
  return useQuery({
    queryKey: caseKeys.byAccess(code),
    queryFn: () => apiClient.get<Case>(API_ENDPOINTS.caseByAccess(code)),
    enabled: !!code,
    retry: false,
  });
}

export function useCreateCase() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: InsertCase) => 
      apiClient.post<Case>(API_ENDPOINTS.cases, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: caseKeys.lists() });
    },
  });
}

export function useUpdateCase() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCase }) =>
      apiClient.patch<Case>(API_ENDPOINTS.caseById(id), data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: caseKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: caseKeys.lists() });
    },
  });
}

export function useDeleteCase() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => 
      apiClient.delete<void>(API_ENDPOINTS.caseById(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: caseKeys.lists() });
    },
  });
}

export function useCaseLetter(caseId: string) {
  return useQuery({
    queryKey: caseKeys.letter(caseId),
    queryFn: () => apiClient.get<CaseLetter>(API_ENDPOINTS.caseLetter(caseId)),
    enabled: !!caseId,
  });
}

export function useUpdateCaseLetter() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ caseId, data }: { caseId: string; data: UpdateCaseLetter }) =>
      apiClient.put<CaseLetter>(API_ENDPOINTS.caseLetter(caseId), data),
    onSuccess: (_, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: caseKeys.letter(caseId) });
    },
  });
}

export function useCaseSubmissions(caseId: string) {
  return useQuery({
    queryKey: caseKeys.submissions(caseId),
    queryFn: () => apiClient.get<CaseSubmission[]>(API_ENDPOINTS.caseSubmissions(caseId)),
    enabled: !!caseId,
  });
}

export function useCreateSubmission() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ caseId, data }: { caseId: string; data: InsertCaseSubmission }) =>
      apiClient.post<CaseSubmission>(API_ENDPOINTS.caseSubmissions(caseId), data),
    onSuccess: (_, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: caseKeys.submissions(caseId) });
    },
  });
}

export function useCaseNotes(caseId: string) {
  return useQuery({
    queryKey: caseKeys.notes(caseId),
    queryFn: () => apiClient.get<CaseNote[]>(API_ENDPOINTS.caseNotes(caseId)),
    enabled: !!caseId,
  });
}

export function useCreateCaseNote() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ caseId, data }: { caseId: string; data: InsertCaseNote }) =>
      apiClient.post<CaseNote>(API_ENDPOINTS.caseNotes(caseId), data),
    onSuccess: (_, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: caseKeys.notes(caseId) });
    },
  });
}
