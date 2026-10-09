import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface BackgroundUploadProps {
  value: string | null
  onUpload: (file: File) => Promise<void> | void
  onRemove: () => Promise<void> | void
  disabled?: boolean
}

export function BackgroundUpload({
  value,
  onUpload,
  onRemove,
  disabled,
}: BackgroundUploadProps) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover.')
    } finally {
      setWorking('idle')
    }
  }

  const busy = working !== 'idle' || !!disabled

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'relative aspect-[21/9] w-full overflow-hidden rounded-lg border bg-muted',
          busy && 'opacity-60',
        )}
      >
        {value ? (
          <img
            src={value}
            alt="Plano de fundo"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            Nenhuma imagem definida.
          </div>
        )}
        {working === 'uploading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <ImagePlus className="h-4 w-4" />
          {value ? 'Trocar imagem' : 'Enviar imagem'}
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
        JPG, PNG ou WEBP · até 5MB · ideal paisagem (1920×820 ou similar).
      </p>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

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
