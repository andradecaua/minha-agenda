import * as React from 'react'
import { cn } from '@/lib/utils'

interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Valor em centavos (int) */
  valueCents: number
  onChangeCents: (cents: number) => void
}

/**
 * Input de dinheiro em BRL. Guarda em centavos (int) internamente,
 * exibe formatado com separador de milhar e vírgula decimal. Aceita
 * apenas dígitos — centavos sempre nos últimos 2.
 */
export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ valueCents, onChangeCents, className, ...props }, ref) => {
    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      const digits = event.target.value.replace(/\D/g, '')
      const cents = digits === '' ? 0 : Number.parseInt(digits, 10)
      onChangeCents(cents)
    }

    const formatted = formatBRL(valueCents)

    return (
      <input
        ref={ref}
        {...props}
        type="text"
        inputMode="numeric"
        value={formatted}
        onChange={handleChange}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      />
    )
  },
)
CurrencyInput.displayName = 'CurrencyInput'

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}
