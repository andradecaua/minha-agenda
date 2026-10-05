import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Switch } from '@/components/ui/switch'
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
  active: z.boolean(),
})

type FormData = z.infer<typeof schema>

interface ServiceFormProps {
  initial?: Service
  submitting: boolean
  errorMessage: string | null
  onSubmit: (input: ServiceInput) => void
  onCancel: () => void
}

export function ServiceForm({
  initial,
  submitting,
  errorMessage,
  onSubmit,
  onCancel,
}: ServiceFormProps) {
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
      active: initial?.active ?? true,
    },
  })

  useEffect(() => {
    reset({
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      price_cents: initial?.price_cents ?? 0,
      duration_minutes: initial?.duration_minutes ?? 30,
      active: initial?.active ?? true,
    })
  }, [initial, reset])

  function submit(data: FormData) {
    onSubmit({
      name: data.name,
      description: data.description?.trim() || null,
      price_cents: data.price_cents,
      duration_minutes: data.duration_minutes,
      active: data.active,
    })
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
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
