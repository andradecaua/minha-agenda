import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SlotsGridProps {
  slots: string[]
  selected: string | null
  onSelect: (iso: string) => void
  loading: boolean
}

/**
 * Grid de horários disponíveis. Mostra o horário formatado no fuso do
 * navegador — a RPC já retorna timestamptz, então converter aqui está OK.
 */
export function SlotsGrid({ slots, selected, onSelect, loading }: SlotsGridProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando horários...
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <p className="rounded-md border bg-muted/20 py-6 text-center text-sm text-muted-foreground">
        Nenhum horário disponível neste dia.
      </p>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label="Escolha o horário"
      className="grid grid-cols-3 gap-2 sm:grid-cols-4"
    >
      {slots.map((iso) => {
        const label = new Date(iso).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })
        const isSelected = selected === iso
        return (
          <button
            key={iso}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(iso)}
            className={cn(
              'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background hover:bg-accent',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
