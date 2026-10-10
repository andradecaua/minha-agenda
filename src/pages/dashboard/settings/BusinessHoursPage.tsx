import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { useBusinessHours } from '@/hooks/queries/useBusinessHours'
import { replaceWeekdayHours, type Weekday } from '@/services/business-hours'
import { cn } from '@/lib/utils'

const WEEKDAYS: Array<{ value: Weekday; label: string }> = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
]

interface Window {
  start: string
  end: string
}

type DayState = {
  open: boolean
  windows: Window[]
}

// 'HH:MM:SS' ou 'HH:MM' → 'HH:MM'
function trimToHHMM(value: string): string {
  return value.length >= 5 ? value.slice(0, 5) : value
}

export function BusinessHoursPage() {
  const queryClient = useQueryClient()
  const { data: profile } = useMyProfile()
  const { data: hours, isLoading } = useBusinessHours(profile?.id)

  const [state, setState] = useState<Record<Weekday, DayState>>(() => emptyState())
  const [savingWeekday, setSavingWeekday] = useState<Weekday | null>(null)
  const [savedWeekday, setSavedWeekday] = useState<Weekday | null>(null)
  const [errorWeekday, setErrorWeekday] = useState<{ weekday: Weekday; message: string } | null>(null)

  // Hidrata o estado quando chegam os horários
  useEffect(() => {
    if (!hours) return
    const next = emptyState()
    for (const row of hours) {
      const day = next[row.weekday as Weekday]
      day.windows.push({
        start: trimToHHMM(row.start_time),
        end: trimToHHMM(row.end_time),
      })
      if (row.active) day.open = true
    }
    // Normaliza: dias sem janelas = fechados
    for (const w of WEEKDAYS) {
      const d = next[w.value]
      if (d.windows.length === 0) d.open = false
    }
    setState(next)
  }, [hours])

  const mutation = useMutation({
    mutationFn: async ({ weekday, windows }: { weekday: Weekday; windows: Window[] }) => {
      if (!profile) throw new Error('Perfil não carregado')
      await replaceWeekdayHours(
        profile.id,
        weekday,
        windows.map((w) => ({ start_time: w.start, end_time: w.end, active: true })),
      )
    },
    onSuccess: () => {
      if (profile) {
        queryClient.invalidateQueries({ queryKey: ['business-hours', profile.id] })
      }
    },
  })

  function updateDay(weekday: Weekday, patch: Partial<DayState>) {
    setState((prev) => ({ ...prev, [weekday]: { ...prev[weekday], ...patch } }))
  }

  function addWindow(weekday: Weekday) {
    setState((prev) => {
      const prevDay = prev[weekday]
      const last = prevDay.windows[prevDay.windows.length - 1]
      const defaults: Window = last
        ? { start: last.end, end: addHour(last.end) }
        : { start: '08:00', end: '18:00' }
      return {
        ...prev,
        [weekday]: {
          open: true,
          windows: [...prevDay.windows, defaults],
        },
      }
    })
  }

  function removeWindow(weekday: Weekday, index: number) {
    setState((prev) => {
      const next = prev[weekday].windows.filter((_, i) => i !== index)
      return {
        ...prev,
        [weekday]: {
          open: next.length > 0 ? prev[weekday].open : false,
          windows: next,
        },
      }
    })
  }

  function updateWindow(weekday: Weekday, index: number, patch: Partial<Window>) {
    setState((prev) => {
      const windows = prev[weekday].windows.map((w, i) =>
        i === index ? { ...w, ...patch } : w,
      )
      return { ...prev, [weekday]: { ...prev[weekday], windows } }
    })
  }

  async function saveDay(weekday: Weekday) {
    const day = state[weekday]
    setErrorWeekday(null)

    const windowsToSave: Window[] = day.open ? day.windows : []

    for (const w of windowsToSave) {
      if (!w.start || !w.end) {
        setErrorWeekday({ weekday, message: 'Preencha início e fim.' })
        return
      }
      if (w.end <= w.start) {
        setErrorWeekday({ weekday, message: 'O fim deve ser maior que o início.' })
        return
      }
    }

    // Overlap check local (o banco também vai evitar via lógica de aplicação)
    const sorted = [...windowsToSave].sort((a, b) => a.start.localeCompare(b.start))
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const curr = sorted[i]!
      if (curr.start < prev.end) {
        setErrorWeekday({ weekday, message: 'Os períodos não podem se sobrepor.' })
        return
      }
    }

    setSavingWeekday(weekday)
    try {
      await mutation.mutateAsync({ weekday, windows: windowsToSave })
      setSavedWeekday(weekday)
      setTimeout(() => {
        setSavedWeekday((curr) => (curr === weekday ? null : curr))
      }, 2000)
    } catch {
      setErrorWeekday({ weekday, message: 'Não foi possível salvar. Tente novamente.' })
    } finally {
      setSavingWeekday(null)
    }
  }

  const content = useMemo(() => {
    if (isLoading || !profile) {
      return (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando horários...
          </CardContent>
        </Card>
      )
    }

    return (
      <div className="space-y-3">
        {WEEKDAYS.map((wd) => {
          const day = state[wd.value]
          const isSaving = savingWeekday === wd.value
          const isSaved = savedWeekday === wd.value
          const error = errorWeekday?.weekday === wd.value ? errorWeekday.message : null

          return (
            <Card key={wd.value}>
              <CardContent className="space-y-3 py-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={day.open}
                      onCheckedChange={(open) => {
                        if (open && day.windows.length === 0) {
                          updateDay(wd.value, {
                            open: true,
                            windows: [{ start: '08:00', end: '18:00' }],
                          })
                        } else {
                          updateDay(wd.value, { open })
                        }
                      }}
                      aria-label={`Abrir ${wd.label}`}
                    />
                    <div>
                      <p className="font-medium">{wd.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {day.open ? `${day.windows.length} período(s)` : 'Fechado'}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => saveDay(wd.value)}
                  >
                    {isSaving ? 'Salvando…' : isSaved ? 'Salvo!' : 'Salvar'}
                  </Button>
                </div>

                {day.open && (
                  <div className="space-y-2 border-t pt-3">
                    {day.windows.map((win, idx) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-center gap-2 sm:flex-nowrap"
                      >
                        <TimeInput
                          value={win.start}
                          onChange={(v) => updateWindow(wd.value, idx, { start: v })}
                          ariaLabel={`${wd.label} - início do período ${idx + 1}`}
                        />
                        <span className="text-sm text-muted-foreground">até</span>
                        <TimeInput
                          value={win.end}
                          onChange={(v) => updateWindow(wd.value, idx, { end: v })}
                          ariaLabel={`${wd.label} - fim do período ${idx + 1}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeWindow(wd.value, idx)}
                          aria-label={`Remover período ${idx + 1} de ${wd.label}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => addWindow(wd.value)}
                    >
                      <Plus className="h-4 w-4" />
                      Adicionar período
                    </Button>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    )
  }, [
    isLoading,
    profile,
    state,
    savingWeekday,
    savedWeekday,
    errorWeekday,
  ])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Horários de funcionamento</CardTitle>
          <CardDescription>
            Defina quando você aceita agendamentos. Múltiplos períodos no
            mesmo dia são suportados (ex.: 08–12 e 14–18 para incluir o
            horário de almoço).
          </CardDescription>
        </CardHeader>
      </Card>
      {content}
    </div>
  )
}

function emptyState(): Record<Weekday, DayState> {
  return {
    0: { open: false, windows: [] },
    1: { open: false, windows: [] },
    2: { open: false, windows: [] },
    3: { open: false, windows: [] },
    4: { open: false, windows: [] },
    5: { open: false, windows: [] },
    6: { open: false, windows: [] },
  }
}

function addHour(hhmm: string): string {
  const parts = hhmm.split(':')
  const h = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 0)
  const nextH = Math.min(23, h + 1)
  return `${String(nextH).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

interface TimeInputProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}

function TimeInput({ value, onChange, ariaLabel }: TimeInputProps) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={cn(
        'h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    />
  )
}
