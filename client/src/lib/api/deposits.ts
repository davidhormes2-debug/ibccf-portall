import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { API_ENDPOINTS } from '@shared/constants';
import type { DepositReceipt, InsertDepositReceipt } from '@shared/types';

export const depositKeys = {
  all: ['deposits'] as const,
  byCase: (caseId: string) => [...depositKeys.all, caseId] as const,
};

export function useDepositReceipts(caseId: string) {
  return useQuery({
    queryKey: depositKeys.byCase(caseId),
    queryFn: () => apiClient.get<DepositReceipt[]>(API_ENDPOINTS.caseDepositReceipts(caseId)),
    enabled: !!caseId,
  });
}

export function useUploadDepositReceipt() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ caseId, data }: { caseId: string; data: InsertDepositReceipt }) =>
      apiClient.post<DepositReceipt>(API_ENDPOINTS.caseDepositReceipts(caseId), data),
    onSuccess: (_, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: depositKeys.byCase(caseId) });
    },
  });
}

export function useUpdateDepositReceipt() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ receiptId, data }: { 
      caseId: string; 
      receiptId: number; 
      data: Partial<DepositReceipt> 
    }) =>
      apiClient.patch<DepositReceipt>(
        `/api/deposit-receipts/${receiptId}`,
        data
      ),
    onSuccess: (_, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: depositKeys.byCase(caseId) });
    },
  });
}
