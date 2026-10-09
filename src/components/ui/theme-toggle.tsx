import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'

interface ThemeToggleProps {
  /** `full` mostra label; `icon` só o ícone (navbars compactas). */
  variant?: 'full' | 'icon'
  className?: string
}

export function ThemeToggle({ variant = 'full', className }: ThemeToggleProps) {
  const { resolved, toggle } = useTheme()
  const isDark = resolved === 'dark'
  const label = isDark ? 'Tema claro' : 'Tema escuro'

  if (variant === 'icon') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-label={label}
        title={label}
        className={className}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={toggle}
      className={`w-full justify-start text-muted-foreground ${className ?? ''}`.trim()}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {label}
    </Button>
  )
}
