import { useQuery } from '@tanstack/react-query'
import { listTeamInvites } from '@/services/team-invites'

export const teamInvitesKey = (teamId: string | undefined) =>
  ['team-invites', teamId] as const

export function useTeamInvites(teamId: string | undefined) {
  return useQuery({
    queryKey: teamInvitesKey(teamId),
    queryFn: () => {
      if (!teamId) throw new Error('teamId ausente')
      return listTeamInvites(teamId)
    },
    enabled: !!teamId,
    staleTime: 30 * 1000,
  })
}
