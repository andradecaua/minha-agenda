import { useEffect, useState } from 'react'
import {
  useForm,
  Controller,
  type Control,
  type UseFormRegisterReturn,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { useBookingSettings } from '@/hooks/queries/useBookingSettings'
import {
  updateBookingSettings,
  type BookingSettingsUpdate,
} from '@/services/booking-settings'

const schema = z.object({
  online_booking_enabled: z.boolean(),
  require_confirmation: z.boolean(),
  cancellation_enabled: z.boolean(),
  minimum_advance_minutes: z.coerce.number().int().min(0).max(60 * 24 * 30),
  maximum_advance_days: z.coerce.number().int().min(1).max(365),
  cancellation_deadline_minutes: z.coerce.number().int().min(0).max(60 * 24 * 30),
})

type FormData = z.infer<typeof schema>

export function BookingSettingsPage() {
  const queryClient = useQueryClient()
  const { data: profile } = useMyProfile()
  const { data: settings, isLoading } = useBookingSettings(profile?.id)

  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      online_booking_enabled: true,
      require_confirmation: true,
      cancellation_enabled: true,
      minimum_advance_minutes: 120,
      maximum_advance_days: 30,
      cancellation_deadline_minutes: 120,
    },
  })

  useEffect(() => {
    if (settings) {
      reset({
        online_booking_enabled: settings.online_booking_enabled,
        require_confirmation: settings.require_confirmation,
        cancellation_enabled: settings.cancellation_enabled,
        minimum_advance_minutes: settings.minimum_advance_minutes,
        maximum_advance_days: settings.maximum_advance_days,
        cancellation_deadline_minutes: settings.cancellation_deadline_minutes,
      })
    }
  }, [settings, reset])

  const mutation = useMutation({
    mutationFn: (patch: BookingSettingsUpdate) => {
      if (!profile) throw new Error('Perfil não carregado')
      return updateBookingSettings(profile.id, patch)
    },
    onSuccess: (updated) => {
      if (profile) {
        queryClient.setQueryData(['booking-settings', profile.id], updated)
      }
      setSavedAt(new Date())
      setServerError(null)
    },
  })

  async function onSubmit(data: FormData) {
    setServerError(null)
    try {
      await mutation.mutateAsync(data)
    } catch {
      setServerError('Não foi possível salvar. Tente novamente.')
    }
  }

  const cancellationEnabled = watch('cancellation_enabled')

  if (isLoading || !settings) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando configurações...
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Regras de agendamento</CardTitle>
        <CardDescription>
          Controla como clientes podem reservar horários na sua página pública.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <ToggleRow
            name="online_booking_enabled"
            control={control}
            label="Permitir agendamento online"
            description="Se desligado, sua página pública não aceitará reservas (clientes verão aviso)."
          />
          <ToggleRow
            name="require_confirmation"
            control={control}
            label="Exigir confirmação manual"
            description="Novos agendamentos ficam como 'pendentes' até você confirmar. Desligue para que entrem já confirmados."
          />
          <ToggleRow
            name="cancellation_enabled"
            control={control}
            label="Permitir cancelamento pelo cliente"
            description="Clientes podem cancelar até o prazo definido abaixo."
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <NumberField
              id="minimum_advance_minutes"
              label="Antecedência mínima (minutos)"
              hint="Ex.: 120 = clientes precisam agendar com pelo menos 2h de antecedência."
              register={register('minimum_advance_minutes')}
              error={errors.minimum_advance_minutes?.message}
              min={0}
            />
            <NumberField
              id="maximum_advance_days"
              label="Antecedência máxima (dias)"
              hint="Ex.: 30 = clientes só podem agendar nos próximos 30 dias."
              register={register('maximum_advance_days')}
              error={errors.maximum_advance_days?.message}
              min={1}
            />
            <NumberField
              id="cancellation_deadline_minutes"
              label="Prazo p/ cancelamento (minutos)"
              hint="Tempo mínimo antes do horário para cancelar."
              register={register('cancellation_deadline_minutes')}
              error={errors.cancellation_deadline_minutes?.message}
              min={0}
              disabled={!cancellationEnabled}
            />
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
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

interface ToggleRowProps {
  name: 'online_booking_enabled' | 'require_confirmation' | 'cancellation_enabled'
  control: Control<FormData>
  label: string
  description: string
}

function ToggleRow({ name, control, label, description }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-4 last:border-b-0 last:pb-0">
      <div className="space-y-1">
        <Label htmlFor={name}>{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Switch
            id={name}
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        )}
      />
    </div>
  )
}

interface NumberFieldProps {
  id: string
  label: string
  hint: string
  register: UseFormRegisterReturn
  error: string | undefined
  min: number
  disabled?: boolean
}

function NumberField({ id, label, hint, register, error, min, disabled }: NumberFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        disabled={disabled}
        {...register}
        aria-invalid={!!error}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
