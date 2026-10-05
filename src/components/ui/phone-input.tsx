import * as React from 'react'
import { cn } from '@/lib/utils'
import { formatPhoneBR, normalizePhone } from '@/lib/phone'

interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Dígitos puros (ex.: "11999999999"). */
  value: string
  /** Chama com os dígitos puros. */
  onChange: (digits: string) => void
}

/**
 * Input de telefone BR com máscara (11) 99999-9999 enquanto digita.
 * Guarda apenas dígitos — a máscara é visual. Limite de 11 dígitos.
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onChange, className, placeholder, ...props }, ref) => {
    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      const digits = normalizePhone(event.target.value).slice(0, 11)
      onChange(digits)
    }

    const displayed = formatPhoneBR(value)

    return (
      <input
        ref={ref}
        {...props}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={displayed}
        onChange={handleChange}
        placeholder={placeholder ?? '(11) 99999-9999'}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      />
    )
  },
)
PhoneInput.displayName = 'PhoneInput'
