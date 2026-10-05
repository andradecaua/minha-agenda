import { useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'

interface DateStripProps {
  selected: Date | null
  onSelect: (d: Date) => void
  /** Quantos dias a partir de hoje mostrar. */
  days: number
}

const WEEK_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/**
 * Fita horizontal de datas selecionáveis a partir de hoje. Mobile-first.
 * Alternativa simples a um calendário completo — útil para visitantes
 * que normalmente agendam poucos dias à frente.
 */
export function DateStrip({ selected, onSelect, days }: DateStripProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const list = useMemo(() => {
    const base = new Date()
    base.setHours(0, 0, 0, 0)
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(base)
      d.setDate(base.getDate() + i)
      return d
    })
  }, [days])

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label="Escolha a data"
      className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory"
    >
      {list.map((d) => {
        const isSelected = selected ? sameDay(selected, d) : false
        const isToday = sameDay(new Date(), d)
        return (
          <button
            key={d.toISOString()}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(d)}
            className={cn(
              'flex min-w-[64px] shrink-0 snap-start flex-col items-center rounded-lg border px-3 py-2 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background hover:bg-accent',
            )}
          >
            <span
              className={cn(
                'text-[11px] uppercase tracking-wide',
                isSelected ? 'opacity-80' : 'text-muted-foreground',
              )}
            >
              {WEEK_LABEL[d.getDay()]}
            </span>
            <span className="text-lg font-semibold leading-none">
              {d.getDate()}
            </span>
            <span
              className={cn(
                'text-[11px]',
                isSelected ? 'opacity-80' : 'text-muted-foreground',
              )}
            >
              {isToday ? 'hoje' : monthLabel(d)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function monthLabel(d: Date): string {
  return MONTHS[d.getMonth()] ?? ''
}
