import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PhoneInput } from '@/components/ui/phone-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AvatarUpload } from '@/components/ui/avatar-upload'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { myTeamKey, useMyTeam, useTeamMembers } from '@/hooks/queries/useMyTeam'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSIONS } from '@/lib/permissions'
import {
  SLUG_REGEX,
  isSlugAvailable,
  updateMyProfile,
  type ProfileUpdate,
} from '@/services/profiles'
import { removeAvatar, replaceAvatar } from '@/services/avatar'
import { updateTeamBackground } from '@/services/teams'
import { deleteImage, uploadImage, UploadValidationError } from '@/services/storage'
import { BackgroundUpload } from '@/components/ui/background-upload'
import { isValidPhoneBR, normalizePhone } from '@/lib/phone'

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Informe seu nome.').max(120),
  slug: z
    .string()
    .trim()
    .min(3, 'Mínimo de 3 caracteres.')
    .max(60, 'Máximo de 60 caracteres.')
    .regex(SLUG_REGEX, 'Use apenas letras minúsculas, números e hífen (ex.: joao-silva).'),
  bio: z.string().trim().max(500, 'Máximo de 500 caracteres.').optional().or(z.literal('')),
  phone: z
    .string()
    .refine((v) => v === '' || isValidPhoneBR(v), {
      message: 'Informe DDD + número (10 ou 11 dígitos).',
    }),
  city: z.string().trim().max(120).optional().or(z.literal('')),
})

type ProfileFormData = z.infer<typeof profileSchema>

export function ProfilePage() {
  const queryClient = useQueryClient()
  const { data: profile, isLoading } = useMyProfile()
  const { data: team } = useMyTeam()
  const { data: teamMembers } = useTeamMembers(team?.id)
  const { can } = usePermissions()
  const canSetBackground = can(PERMISSIONS.PROFILE_BACKGROUND)

  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [slugCheck, setSlugCheck] = useState<'idle' | 'checking' | 'ok' | 'taken'>(
    'idle',
  )

  // Membro em equipe multi: a URL pública é a do owner (members não
  // têm mais página individual desde v0.4.4). Mostramos o slug do
  // owner no lugar do próprio pra que o botão "copiar" compartilhe
  // o link certo.
  const isMemberInMultiTeam =
    !!team &&
    !!teamMembers &&
    teamMembers.length > 1 &&
    !!profile &&
    team.owner_user_id !== profile.user_id
  const ownerSlug = isMemberInMultiTeam
    ? teamMembers?.find((m) => m.role === 'owner')?.profile?.slug ?? null
    : null

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      slug: '',
      bio: '',
      phone: '',
      city: '',
    },
  })

  // Hidrata o form quando o profile chega. Normaliza o phone antigo
  // (pode ter sido salvo com formatação ou com texto livre antes da
  // validação existir) para que a máscara aplique certo.
  useEffect(() => {
    if (profile) {
      reset({
        name: profile.name,
        slug: profile.slug,
        bio: profile.bio ?? '',
        phone: normalizePhone(profile.phone),
        city: profile.city ?? '',
      })
    }
  }, [profile, reset])

  const slugValue = watch('slug')

  // Checagem leve de disponibilidade do slug (debounced)
  useEffect(() => {
    if (!profile) return
    if (!slugValue || slugValue === profile.slug) {
      setSlugCheck('idle')
      return
    }
    if (!SLUG_REGEX.test(slugValue) || slugValue.length < 3) {
      setSlugCheck('idle')
      return
    }
    setSlugCheck('checking')
    const handle = setTimeout(async () => {
      const available = await isSlugAvailable(slugValue, profile.id)
      setSlugCheck(available ? 'ok' : 'taken')
    }, 400)
    return () => clearTimeout(handle)
  }, [slugValue, profile])

  const mutation = useMutation({
    mutationFn: (patch: ProfileUpdate) => {
      if (!profile) throw new Error('Perfil não carregado')
      return updateMyProfile(profile.id, patch)
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['my-profile', profile?.user_id], updated)
      // Invalida cache da página pública pra que o novo nome/slug/bio
      // apareça imediatamente em `/p/<slug>` (seja do próprio profile
      // ou do owner do time, se for membro — o fetch arrasta ambos).
      void queryClient.invalidateQueries({ queryKey: ['public-professional'] })
      setSavedAt(new Date())
      setServerError(null)
    },
  })

  async function onSubmit(data: ProfileFormData) {
    if (!profile) return
    setServerError(null)

    if (data.slug !== profile.slug) {
      const available = await isSlugAvailable(data.slug, profile.id)
      if (!available) {
        setError('slug', { message: 'Este link já está em uso.' })
        return
      }
    }

    const normalizedPhone = normalizePhone(data.phone)
    const patch: ProfileUpdate = {
      name: data.name,
      slug: data.slug,
      bio: data.bio?.trim() || null,
      phone: normalizedPhone || null,
      city: data.city?.trim() || null,
    }

    try {
      await mutation.mutateAsync(patch)
    } catch (err) {
      const msg =
        err instanceof Error && err.message.toLowerCase().includes('duplicate')
          ? 'Este link já está em uso.'
          : 'Não foi possível salvar. Tente novamente.'
      setServerError(msg)
    }
  }

  const publicUrl = useMemo(() => {
    if (!profile) return ''
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    // Membro em equipe multi compartilha o link do owner — o slug
    // próprio só redireciona pra lá. Owner e profissional solo usam
    // o próprio slug.
    const effectiveSlug = ownerSlug ?? slugValue ?? profile.slug
    return `${base}/p/${effectiveSlug}`
  }, [profile, slugValue, ownerSlug])

  if (isLoading || !profile) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando perfil...
        </CardContent>
      </Card>
    )
  }

  const initials = profile.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

  async function handleAvatarUpload(file: File) {
    const url = await replaceAvatar(
      { id: profile!.id, avatar_url: profile!.avatar_url },
      file,
    )
    queryClient.setQueryData(['my-profile', profile!.user_id], {
      ...profile!,
      avatar_url: url,
    })
  }

  async function handleAvatarRemove() {
    await removeAvatar({ id: profile!.id, avatar_url: profile!.avatar_url })
    queryClient.setQueryData(['my-profile', profile!.user_id], {
      ...profile!,
      avatar_url: null,
    })
  }

  async function handleBackgroundUpload(file: File) {
    if (!team) throw new Error('Equipe não carregada.')
    try {
      const { path, publicUrl } = await uploadImage('backgrounds', team.id, file)
      const oldPath = team.background_storage_path
      await updateTeamBackground(publicUrl, path)
      queryClient.setQueryData(myTeamKey(profile!.user_id), {
        ...team,
        background_url: publicUrl,
        background_storage_path: path,
      })
      void queryClient.invalidateQueries({ queryKey: ['public-professional'] })
      // Limpa o blob antigo depois do sucesso da RPC. Falha aqui =
      // órfão; não propaga pra UI porque o novo já está salvo.
      if (oldPath && oldPath !== path) {
        void deleteImage('backgrounds', oldPath).catch(() => {})
      }
    } catch (err) {
      if (err instanceof UploadValidationError) throw new Error(err.message)
      throw err
    }
  }

  async function handleBackgroundRemove() {
    if (!team) return
    const oldPath = team.background_storage_path
    await updateTeamBackground(null, null)
    queryClient.setQueryData(myTeamKey(profile!.user_id), {
      ...team,
      background_url: null,
      background_storage_path: null,
    })
    void queryClient.invalidateQueries({ queryKey: ['public-professional'] })
    if (oldPath) {
      void deleteImage('backgrounds', oldPath).catch(() => {})
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Foto</CardTitle>
          <CardDescription>
            Aparece no topo da sua página pública. Prefira uma foto clara, de rosto ou do seu trabalho.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarUpload
            value={profile.avatar_url}
            onUpload={handleAvatarUpload}
            onRemove={handleAvatarRemove}
            initials={initials}
          />
        </CardContent>
      </Card>

      {team && canSetBackground && (
        <Card>
          <CardHeader>
            <CardTitle>Plano de fundo</CardTitle>
            <CardDescription>
              Imagem exibida atrás da foto na sua página pública. Ótima pra
              reforçar a identidade visual do seu trabalho.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BackgroundUpload
              value={team.background_url}
              onUpload={handleBackgroundUpload}
              onRemove={handleBackgroundRemove}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Perfil público</CardTitle>
          <CardDescription>
            Essas informações aparecem na sua página pública de agendamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" {...register('name')} aria-invalid={!!errors.name} />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">Link público</Label>
              <div className="flex items-center overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <span className="px-3 text-sm text-muted-foreground">/p/</span>
                <input
                  id="slug"
                  {...register('slug')}
                  className="h-10 w-full bg-transparent pr-3 text-sm outline-none"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!errors.slug}
                />
              </div>
              <SlugStatus
                error={errors.slug?.message}
                status={slugCheck}
                currentSlug={profile.slug}
                nextSlug={slugValue}
              />
              {isMemberInMultiTeam && (
                <p className="text-xs text-muted-foreground">
                  Como membro da equipe, sua página pública é a do time:{' '}
                  <code className="rounded bg-muted px-1 py-0.5">
                    /p/{ownerSlug}
                  </code>
                  . Este slug só identifica você internamente — qualquer
                  URL com ele redireciona pra página da equipe.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                {...register('bio')}
                placeholder="Conte brevemente sobre seu trabalho."
                rows={4}
                aria-invalid={!!errors.bio}
              />
              {errors.bio && (
                <p className="text-sm text-destructive">{errors.bio.message}</p>
              )}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Controller
                  name="phone"
                  control={control}
                  render={({ field }) => (
                    <PhoneInput
                      id="phone"
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      aria-invalid={!!errors.phone}
                    />
                  )}
                />
                {errors.phone && (
                  <p className="text-sm text-destructive">{errors.phone.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Formato: DDD + número. Ex.: (11) 99999-9999.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Cidade</Label>
                <Input id="city" {...register('city')} placeholder="São Paulo, SP" />
              </div>
            </div>

            {serverError && (
              <p className="text-sm text-destructive" role="alert">
                {serverError}
              </p>
            )}

            <div className="flex items-center justify-between gap-4 border-t pt-4">
              <span className="text-xs text-muted-foreground">
                {savedAt
                  ? `Salvo às ${savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                  : 'Alterações são aplicadas após salvar.'}
              </span>
              <Button
                type="submit"
                disabled={isSubmitting || !isDirty || slugCheck === 'taken'}
              >
                {isSubmitting ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seu link público</CardTitle>
          <CardDescription>Compartilhe com seus clientes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {publicUrl}
            </code>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(publicUrl)}
              >
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={`/p/${profile.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Abrir
                </a>
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O link usa o slug <strong>salvo</strong>. Se você mudar acima, salve
            antes para o link refletir.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

interface SlugStatusProps {
  error: string | undefined
  status: 'idle' | 'checking' | 'ok' | 'taken'
  currentSlug: string
  nextSlug: string
}

function SlugStatus({ error, status, currentSlug, nextSlug }: SlugStatusProps) {
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!nextSlug || nextSlug === currentSlug) {
    return (
      <p className="text-xs text-muted-foreground">
        Letras minúsculas, números e hífen. Ex.: <code>joao-silva</code>.
      </p>
    )
  }
  if (status === 'checking') {
    return (
      <p className="text-xs text-muted-foreground">Verificando disponibilidade...</p>
    )
  }
  if (status === 'ok') {
    return <p className="text-xs text-green-600">Disponível.</p>
  }
  if (status === 'taken') {
    return <p className="text-sm text-destructive">Este link já está em uso.</p>
  }
  return null
}
