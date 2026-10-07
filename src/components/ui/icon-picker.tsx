import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ICON_CATALOG } from '@/lib/icons'

interface IconPickerProps {
  /** Nome do ícone selecionado (`null` = nenhum). */
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
  /** `id` do campo primário pra `htmlFor` do `<Label>` externo. */
  id?: string
}

/**
 * Grid de ícones com clique pra selecionar. Clicar no ícone já
 * selecionado NÃO desseleciona (fica estável); use o botão "Limpar"
 * pra voltar ao estado sem ícone.
 */
export function IconPicker({ value, onChange, disabled, id }: IconPickerProps) {
  return (
    <div className="space-y-2">
      <div
        id={id}
        role="radiogroup"
        aria-label="Ícone"
        className={cn(
          'grid grid-cols-8 gap-1.5 rounded-md border bg-background p-2',
          disabled && 'opacity-60 pointer-events-none',
        )}
      >
        {ICON_CATALOG.map((icon) => {
          const Component = icon.component
          const selected = value === icon.name
          return (
            <button
              key={icon.name}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={icon.label}
              title={icon.label}
              onClick={() => onChange(icon.name)}
              className={cn(
                'flex aspect-square items-center justify-center rounded-md border transition-colors',
                selected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-transparent bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Component className="h-4 w-4" aria-hidden="true" strokeWidth={1.8} />
            </button>
          )
        })}
      </div>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" aria-hidden="true" />
          Limpar ícone
        </Button>
      )}
    </div>
  )
}
