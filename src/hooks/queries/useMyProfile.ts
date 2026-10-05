import { useQuery } from '@tanstack/react-query'
import { getMyProfile } from '@/services/profiles'
import { useAuth } from '@/hooks/useAuth'

export function useMyProfile() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-profile', user?.id],
    queryFn: () => {
      if (!user) throw new Error('Usuário não autenticado')
      return getMyProfile(user.id)
    },
    enabled: !!user,
  })
}
