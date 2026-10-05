import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Dialog acessível construído sobre o <dialog> nativo. Entrega sem
 * dep nova: foco trap, Esc para fechar e click no backdrop.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  // Sincroniza prop `open` com o estado do <dialog>
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
    } else if (!open && el.open) {
      el.close()
    }
  }, [open])

  // Esc (nativo) emite evento `cancel`; propagamos para onClose
  useEffect(() => {
    const el = ref.current
    if (!el) return
    function handleCancel(e: Event) {
      e.preventDefault()
      onClose()
    }
    el.addEventListener('cancel', handleCancel)
    return () => el.removeEventListener('cancel', handleCancel)
  }, [onClose])

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    // Click foi no próprio <dialog> (área externa ao conteúdo)
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
  }[size]

  return (
    <dialog
      ref={ref}
      onClick={handleBackdropClick}
      className={cn(
        'w-[calc(100%-2rem)] rounded-xl border bg-background p-0 text-foreground shadow-xl',
        'backdrop:bg-black/40 backdrop:backdrop-blur-sm',
        'open:animate-in open:fade-in-0 open:zoom-in-95',
        sizeClass,
      )}
      aria-labelledby="dialog-title"
      aria-describedby={description ? 'dialog-description' : undefined}
    >
      <div className="flex items-start justify-between gap-4 border-b p-5">
        <div>
          <h2 id="dialog-title" className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description && (
            <p id="dialog-description" className="mt-1 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {children && <div className="p-5">{children}</div>}

      {footer && (
        <div className="flex items-center justify-end gap-2 border-t bg-muted/30 p-4">
          {footer}
        </div>
      )}
    </dialog>
  )
}
