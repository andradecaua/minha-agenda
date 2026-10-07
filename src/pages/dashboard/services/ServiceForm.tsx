import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Camera, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Switch } from '@/components/ui/switch'
import { IconPicker } from '@/components/ui/icon-picker'
import { getIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSIONS } from '@/lib/permissions'
import type { Service } from '@/types/database'
import type { ServiceInput } from '@/services/services'

const schema = z.object({
  name: z.string().trim().min(1, 'Informe um nome.').max(120),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  price_cents: z.number().int().min(0, 'Preço inválido.').max(100_000_000),
  duration_minutes: z.coerce
    .number()
    .int()
    .min(5, 'Mínimo de 5 minutos.')
    .max(24 * 60, 'Máximo de 24h.'),
  icon: z.string().nullable(),
  active: z.boolean(),
})

type FormData = z.infer<typeof schema>

export interface ServiceFormResult {
  input: ServiceInput
  imageFile: File | null
  removeImage: boolean
}

interface ServiceFormProps {
  initial?: Service
  submitting: boolean
  errorMessage: string | null
  onSubmit: (result: ServiceFormResult) => void
  onCancel: () => void
}

export function ServiceForm({
  initial,
  submitting,
  errorMessage,
  onSubmit,
  onCancel,
}: ServiceFormProps) {
  const { can } = usePermissions()
  const canUploadImage = can(PERMISSIONS.CUSTOM_IMAGES)

  const inputFileRef = useRef<HTMLInputElement>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(initial?.image_url ?? null)
  const [removedCurrent, setRemovedCurrent] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      price_cents: initial?.price_cents ?? 0,
      duration_minutes: initial?.duration_minutes ?? 30,
      icon: initial?.icon ?? null,
      active: initial?.active ?? true,
    },
  })

  useEffect(() => {
    reset({
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      price_cents: initial?.price_cents ?? 0,
      duration_minutes: initial?.duration_minutes ?? 30,
      icon: initial?.icon ?? null,
      active: initial?.active ?? true,
    })
    setPreviewUrl(initial?.image_url ?? null)
    setImageFile(null)
    setRemovedCurrent(false)
    setImageError(null)
  }, [initial, reset])

  function handleFile(file: File | null) {
    setImageError(null)
    if (!file) {
      setImageFile(null)
      setPreviewUrl(initial?.image_url ?? null)
      setRemovedCurrent(false)
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setImageError('Formato inválido. Use JPG, PNG ou WEBP.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageError('Imagem muito grande (máx. 5MB).')
      return
    }
    setImageFile(file)
    setRemovedCurrent(false)
    setPreviewUrl(URL.createObjectURL(file))
  }

  function removeExisting() {
    setImageFile(null)
    setPreviewUrl(null)
    setRemovedCurrent(true)
    if (inputFileRef.current) inputFileRef.current.value = ''
  }

  function submit(data: FormData) {
    onSubmit({
      input: {
        name: data.name,
        description: data.description?.trim() || null,
        price_cents: data.price_cents,
        duration_minutes: data.duration_minutes,
        icon: data.icon,
        active: data.active,
      },
      imageFile: canUploadImage ? imageFile : null,
      removeImage: canUploadImage && removedCurrent && !imageFile,
    })
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      {canUploadImage && (
        <div>
          <Label>Foto (opcional)</Label>
          <div className="mt-2 flex items-start gap-4">
            <div
              className={cn(
                'relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted',
                submitting && 'opacity-60',
              )}
            >
              {previewUrl ? (
                <img src={previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => inputFileRef.current?.click()}
                  disabled={submitting}
                >
                  <Camera className="h-4 w-4" />
                  {previewUrl ? 'Trocar foto' : 'Enviar foto'}
                </Button>
                {previewUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeExisting}
                    disabled={submitting}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remover
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">JPG, PNG ou WEBP · até 5MB.</p>
              {imageError && <p className="text-sm text-destructive">{imageError}</p>}
            </div>
          </div>
          <input
            ref={inputFileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="svc-name">Nome</Label>
        <Input
          id="svc-name"
          {...register('name')}
          aria-invalid={!!errors.name}
          placeholder="Ex.: Corte masculino"
        />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="svc-desc">Descrição (opcional)</Label>
        <Textarea
          id="svc-desc"
          rows={3}
          {...register('description')}
          placeholder="O que está incluído."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="svc-price">Preço</Label>
          <Controller
            name="price_cents"
            control={control}
            render={({ field }) => (
              <CurrencyInput
                id="svc-price"
                valueCents={field.value}
                onChangeCents={field.onChange}
              />
            )}
          />
          {errors.price_cents && (
            <p className="text-sm text-destructive">{errors.price_cents.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="svc-duration">Duração (minutos)</Label>
          <Input
            id="svc-duration"
            type="number"
            inputMode="numeric"
            min={5}
            step={5}
            {...register('duration_minutes')}
            aria-invalid={!!errors.duration_minutes}
          />
          {errors.duration_minutes && (
            <p className="text-sm text-destructive">
              {errors.duration_minutes.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="svc-icon">Ícone (opcional)</Label>
        <p className="text-xs text-muted-foreground">
          Aparece como fallback quando o serviço não tem foto.
        </p>
        <Controller
          name="icon"
          control={control}
          render={({ field }) => (
            <IconPicker
              id="svc-icon"
              value={field.value}
              onChange={field.onChange}
              disabled={submitting}
            />
          )}
        />
      </div>

      <div className="flex items-start justify-between gap-4 border-t pt-4">
        <div>
          <Label htmlFor="svc-active">Ativo</Label>
          <p className="text-sm text-muted-foreground">
            Serviços inativos não aparecem na página pública.
          </p>
        </div>
        <Controller
          name="active"
          control={control}
          render={({ field }) => (
            <Switch
              id="svc-active"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </div>

      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Salvando...' : initial ? 'Salvar alterações' : 'Criar serviço'}
        </Button>
      </div>
    </form>
  )
}

/** Alias de conveniência pra renderizar o ícone selecionado no form. */
export { getIcon as getServiceIcon }
