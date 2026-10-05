import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface MiniCalendarProps {
  month: Date
  onMonthChange: (next: Date) => void
  selected: Date
  onSelect: (d: Date) => void
  /** Set de strings YYYY-MM-DD que têm agendamentos — para marcadores. */
  daysWithAppointments?: Set<string>
}

const WEEK_LABEL = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MONTH_LABEL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export function MiniCalendar({
  month,
  onMonthChange,
  selected,
  onSelect,
  daysWithAppointments,
}: MiniCalendarProps) {
  const grid = useMemo(() => buildGrid(month), [month])
  const today = useMemo(() => startOfDay(new Date()), [])

  return (
    <div className="rounded-xl border bg-background p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {MONTH_LABEL[month.getMonth()]} {month.getFullYear()}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onMonthChange(addMonths(month, -1))}
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              const t = startOfDay(new Date())
              onSelect(t)
              onMonthChange(new Date(t.getFullYear(), t.getMonth(), 1))
            }}
          >
            Hoje
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onMonthChange(addMonths(month, 1))}
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase text-muted-foreground">
        {WEEK_LABEL.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {grid.map((d, i) => {
          const inMonth = d.getMonth() === month.getMonth()
          const isSelected = sameDay(d, selected)
          const isToday = sameDay(d, today)
          const key = dateKey(d)
          const hasApp = daysWithAppointments?.has(key)
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(d)}
              aria-pressed={isSelected}
              className={cn(
                'relative aspect-square rounded-md text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                !inMonth && 'text-muted-foreground/40',
                inMonth && !isSelected && 'hover:bg-accent',
                isSelected && 'bg-primary text-primary-foreground',
                !isSelected && isToday && 'ring-1 ring-inset ring-primary/40',
              )}
            >
              <span>{d.getDate()}</span>
              {hasApp && !isSelected && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* Helpers de data ------------------------------------------- */

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function addMonths(d: Date, delta: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth() + delta, 1)
  return r
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Gera 42 datas (6 semanas × 7 dias) começando no domingo da semana
 * que contém o dia 1 do mês. Simplifica o render do grid.
 */
function buildGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const startDow = first.getDay() // 0=Dom
  const start = new Date(first)
  start.setDate(first.getDate() - startDow)

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}
