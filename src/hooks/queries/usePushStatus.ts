import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  disablePush,
  enablePush,
  getPushStatus,
  type PushStatus,
} from '@/lib/push'

const KEY = ['push-status'] as const

export function usePushStatus() {
  return useQuery<PushStatus>({
    queryKey: KEY,
    queryFn: () => getPushStatus(),
    staleTime: 30 * 1000,
  })
}

export function useEnablePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => enablePush(),
    onSuccess: (status) => qc.setQueryData(KEY, status),
  })
}

export function useDisablePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => disablePush(),
    onSuccess: (status) => qc.setQueryData(KEY, status),
  })
}
