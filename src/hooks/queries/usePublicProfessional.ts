import { useQuery } from '@tanstack/react-query'
import { getPublicProfessional } from '@/services/public-profile'

export function usePublicProfessional(slug: string | undefined) {
  return useQuery({
    queryKey: ['public-professional', slug],
    queryFn: () => {
      if (!slug) throw new Error('slug ausente')
      return getPublicProfessional(slug)
    },
    enabled: !!slug,
    // Público: cache mais relaxado é OK, não é dado "quente"
    staleTime: 2 * 60 * 1000,
  })
}
