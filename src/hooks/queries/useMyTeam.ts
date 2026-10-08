import { useQuery } from '@tanstack/react-query'
import { getMyTeam, listTeamMembers } from '@/services/teams'
import { useAuth } from '@/hooks/useAuth'

export const myTeamKey = (userId: string | undefined) => ['my-team', userId] as const
export const teamMembersKey = (teamId: string | undefined) =>
  ['team-members', teamId] as const

export function useMyTeam() {
  const { user } = useAuth()
  return useQuery({
    queryKey: myTeamKey(user?.id),
    queryFn: getMyTeam,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })
}

export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: teamMembersKey(teamId),
    queryFn: () => {
      if (!teamId) throw new Error('teamId ausente')
      return listTeamMembers(teamId)
    },
    enabled: !!teamId,
    staleTime: 30 * 1000,
  })
}
