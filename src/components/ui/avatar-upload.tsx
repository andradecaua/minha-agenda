import { useRef, useState } from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface AvatarUploadProps {
  /** URL atual (ou null). */
  value: string | null
  /** Chamado quando o usuário escolhe um novo arquivo. */
  onUpload: (file: File) => Promise<void> | void
  /** Chamado quando o usuário remove. */
  onRemove: () => Promise<void> | void
  /** Letras exibidas quando não há imagem. */
  initials: string
  disabled?: boolean
}

export function AvatarUpload({
  value,
  onUpload,
  onRemove,
  initials,
  disabled,
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [working, setWorking] = useState<'idle' | 'uploading' | 'removing'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setWorking('uploading')
    try {
      await onUpload(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar imagem.')
    } finally {
      setWorking('idle')
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleRemove() {
    setError(null)
    setWorking('removing')
    try {
      await onRemove()
    } catch {
      setError('Não foi possível remover.')
    } finally {
      setWorking('idle')
    }
  }

  const busy = working !== 'idle' || !!disabled

  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          'relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-xl font-semibold text-muted-foreground',
          busy && 'opacity-60',
        )}
      >
        {value ? (
          <img
            src={value}
            alt="Avatar"
            className="h-full w-full object-cover"
          />
        ) : (
          <span aria-hidden="true">{initials || '?'}</span>
        )}
        {working === 'uploading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <Camera className="h-4 w-4" />
            {value ? 'Trocar foto' : 'Enviar foto'}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={busy}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Remover
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          JPG, PNG ou WEBP · até 2MB · ideal quadrado.
        </p>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
    </div>
  )
}
