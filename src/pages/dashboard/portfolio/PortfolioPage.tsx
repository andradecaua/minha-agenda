import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FileDrop } from '@/components/ui/file-drop'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { useMyTeam } from '@/hooks/queries/useMyTeam'
import { portfolioQueryKey, usePortfolio } from '@/hooks/queries/usePortfolio'
import {
  addPortfolioItem,
  deletePortfolioItem,
  updatePortfolioItem,
} from '@/services/portfolio'
import type { PortfolioItem } from '@/types/database'
import { UploadValidationError } from '@/services/storage'
import { cn } from '@/lib/utils'

export function PortfolioPage() {
  const queryClient = useQueryClient()
  const { data: profile } = useMyProfile()
  const { data: team } = useMyTeam()
  const { data: items, isLoading } = usePortfolio(team?.id)

  const [pending, setPending] = useState<File | null>(null)
  const [pendingTitle, setPendingTitle] = useState('')
  const [pendingDesc, setPendingDesc] = useState('')
  const [editing, setEditing] = useState<PortfolioItem | null>(null)
  const [deleting, setDeleting] = useState<PortfolioItem | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  function invalidate() {
    if (team) queryClient.invalidateQueries({ queryKey: portfolioQueryKey(team.id) })
  }

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!profile || !team || !pending) throw new Error('nada para enviar')
      return addPortfolioItem(team.id, profile.id, {
        file: pending,
        title: pendingTitle,
        description: pendingDesc,
      })
    },
    onSuccess: () => {
      invalidate()
      setPending(null)
      setPendingTitle('')
      setPendingDesc('')
      setFeedback(null)
    },
    onError: (err) => {
      if (err instanceof UploadValidationError) {
        setFeedback(err.message)
      } else {
        setFeedback('Não foi possível enviar. Tente novamente.')
      }
    },
  })

  const editMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Pick<PortfolioItem, 'title' | 'description'>>
    }) => updatePortfolioItem(id, patch),
    onSuccess: () => {
      invalidate()
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (item: PortfolioItem) => deletePortfolioItem(item),
    onSuccess: () => {
      invalidate()
      setDeleting(null)
    },
  })

  function handleFiles(files: File[]) {
    const file = files[0]
    if (!file) return
    setFeedback(null)
    setPending(file)
  }

  const count = items?.length ?? 0

  return (
    <div className="space-y-14">
      <EditorialHeader count={count} loading={isLoading || !profile} />

      <UploadSection
        onFiles={handleFiles}
        disabled={addMutation.isPending}
        feedback={feedback}
      />

      <GallerySection
        items={items ?? []}
        loading={isLoading || !profile}
        onEdit={setEditing}
        onDelete={setDeleting}
      />

      {/* Dialog de confirmar envio */}
      <Dialog
        open={!!pending}
        onClose={() => {
          if (addMutation.isPending) return
          setPending(null)
          setPendingTitle('')
          setPendingDesc('')
        }}
        title="Adicionar ao portfólio"
        description="Essa imagem aparecerá na sua página pública."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setPending(null)
                setPendingTitle('')
                setPendingDesc('')
              }}
              disabled={addMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending}
            >
              {addMutation.isPending ? (
                'Enviando…'
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Enviar
                </>
              )}
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-4">
            <div className="overflow-hidden border border-border bg-muted">
              <img
                src={URL.createObjectURL(pending)}
                alt="Prévia"
                className="h-56 w-full object-cover"
                onLoad={(e) =>
                  URL.revokeObjectURL((e.target as HTMLImageElement).src)
                }
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="pf-title"
                className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground"
              >
                Título (opcional)
              </Label>
              <Input
                id="pf-title"
                value={pendingTitle}
                onChange={(e) => setPendingTitle(e.target.value)}
                placeholder="Ex.: Degradê com navalhado"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="pf-desc"
                className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground"
              >
                Descrição (opcional)
              </Label>
              <Textarea
                id="pf-desc"
                rows={2}
                value={pendingDesc}
                onChange={(e) => setPendingDesc(e.target.value)}
              />
            </div>
          </div>
        )}
      </Dialog>

      {editing && (
        <EditDialog
          key={editing.id}
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => editMutation.mutate({ id: editing.id, patch })}
          saving={editMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting)
        }}
        title="Remover foto?"
        description="A imagem será apagada do portfólio e do armazenamento."
        confirmLabel="Remover"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Header editorial                                                  */
/* ──────────────────────────────────────────────────────────────── */

function EditorialHeader({
  count,
  loading,
}: {
  count: number
  loading: boolean
}) {
  return (
    <header>
      <div className="flex items-center justify-between border-b border-border/70 pb-4">
        <div className="flex items-center gap-3">
          <span className="h-px w-6 bg-foreground/30" aria-hidden />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Dashboard · Portfólio
          </span>
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Carregando
            </span>
          ) : (
            <>{count.toString().padStart(2, '0')} {count === 1 ? 'peça' : 'peças'}</>
          )}
        </div>
      </div>

      <h1 className="mt-8 font-serif text-[clamp(2.5rem,6vw,4.25rem)] leading-[1.02] tracking-tight">
        Portfólio.
      </h1>
      <p className="mt-4 max-w-xl font-serif text-[clamp(1.25rem,2vw,1.75rem)] italic leading-tight text-muted-foreground">
        O trabalho que você mostra.
      </p>
      <p className="mt-6 max-w-lg text-[14px] leading-[1.75] text-muted-foreground">
        As fotos adicionadas aqui aparecem em destaque na sua página pública,
        logo acima da lista de serviços. Mostre o que você faz melhor.
      </p>
    </header>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Upload                                                            */
/* ──────────────────────────────────────────────────────────────── */

function UploadSection({
  onFiles,
  disabled,
  feedback,
}: {
  onFiles: (files: File[]) => void
  disabled: boolean
  feedback: string | null
}) {
  return (
    <section aria-labelledby="upload-head">
      <div className="flex items-center gap-3 pb-4">
        <span className="h-px w-6 bg-foreground/30" aria-hidden />
        <span
          id="upload-head"
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
        >
          Adicionar peça
        </span>
      </div>

      <FileDrop
        onFiles={onFiles}
        disabled={disabled}
        className="group min-h-[220px] rounded-[14px] border border-dashed border-foreground/20 bg-background p-10 transition-colors hover:border-foreground/40 hover:bg-muted/40"
      >
        <div className="flex flex-col items-center text-center">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background transition-transform group-hover:-translate-y-0.5">
            <Plus
              className="h-4 w-4 text-foreground/70"
              aria-hidden
              strokeWidth={1.6}
            />
          </span>
          <p className="mt-6 font-serif text-[clamp(1.5rem,2.5vw,2rem)] leading-tight tracking-tight">
            Arraste uma imagem.
          </p>
          <p className="mt-3 max-w-xs font-serif italic leading-snug text-muted-foreground">
            Ou clique para escolher do seu dispositivo.
          </p>
          <p className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            JPG · PNG · WEBP · até 5MB
          </p>
        </div>
      </FileDrop>

      {feedback && (
        <p
          className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-destructive"
          role="alert"
        >
          {feedback}
        </p>
      )}
    </section>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Galeria                                                           */
/* ──────────────────────────────────────────────────────────────── */

function GallerySection({
  items,
  loading,
  onEdit,
  onDelete,
}: {
  items: PortfolioItem[]
  loading: boolean
  onEdit: (item: PortfolioItem) => void
  onDelete: (item: PortfolioItem) => void
}) {
  return (
    <section aria-labelledby="gallery-head">
      <div className="flex items-center justify-between border-t border-border/70 pt-6">
        <div className="flex items-center gap-3">
          <span className="h-px w-6 bg-foreground/30" aria-hidden />
          <span
            id="gallery-head"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
          >
            Galeria
          </span>
        </div>
        {!loading && items.length > 0 && (
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            arranjo pela posição
          </span>
        )}
      </div>

      {loading ? (
        <GallerySkeleton />
      ) : items.length === 0 ? (
        <GalleryEmpty />
      ) : (
        <ul className="mt-10 grid grid-cols-1 gap-x-5 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <PortfolioTile
                item={item}
                onEdit={() => onEdit(item)}
                onDelete={() => onDelete(item)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function GallerySkeleton() {
  return (
    <ul className="mt-10 grid grid-cols-1 gap-x-5 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i}>
          <div className="aspect-[4/5] animate-pulse border border-border bg-muted" />
          <div className="mt-3 h-3 w-24 animate-pulse bg-muted" />
        </li>
      ))}
    </ul>
  )
}

function GalleryEmpty() {
  return (
    <div className="mt-10 border border-dashed border-border py-20 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Nada por aqui ainda
      </p>
      <h2 className="mx-auto mt-5 max-w-md font-serif text-[clamp(1.75rem,3.5vw,2.5rem)] leading-tight tracking-tight">
        Sua galeria{' '}
        <span className="italic text-muted-foreground">está em branco.</span>
      </h2>
      <p className="mx-auto mt-4 max-w-sm text-[13.5px] leading-[1.7] text-muted-foreground">
        Comece adicionando a primeira foto do seu trabalho. Ela aparecerá
        logo em destaque na sua página pública.
      </p>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Tile                                                              */
/* ──────────────────────────────────────────────────────────────── */

function PortfolioTile({
  item,
  onEdit,
  onDelete,
}: {
  item: PortfolioItem
  onEdit: () => void
  onDelete: () => void
}) {
  const date = formatMonoDate(item.created_at)

  return (
    <article className="group">
      <div className="relative aspect-[4/5] overflow-hidden border border-border bg-muted">
        <img
          src={item.image_url}
          alt={item.title ?? 'Trabalho do portfólio'}
          className="h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.05]"
          loading="lazy"
        />

        {/* Fade overlay para legibilidade do título no hover */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        />

        {/* Título em serif durante hover */}
        {item.title && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 px-5 pb-5 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
            <h3 className="font-serif text-[1.25rem] leading-snug tracking-tight text-white">
              {item.title}
            </h3>
          </div>
        )}

        {/* Ações top-right */}
        <div className="absolute right-3 top-3 flex gap-1.5 opacity-0 transition-opacity duration-300 group-hover:opacity-100 focus-within:opacity-100">
          <IconPill onClick={onEdit} label="Editar">
            <Pencil className="h-3.5 w-3.5" aria-hidden strokeWidth={1.6} />
          </IconPill>
          <IconPill onClick={onDelete} label="Remover" destructive>
            <Trash2 className="h-3.5 w-3.5" aria-hidden strokeWidth={1.6} />
          </IconPill>
        </div>
      </div>

      {/* Meta sob a imagem — tipográfico, hairline */}
      <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-border/70 pt-3">
        <h4 className="min-w-0 flex-1 truncate font-serif text-[1.05rem] leading-tight tracking-tight">
          {item.title || (
            <span className="italic text-muted-foreground">Sem título</span>
          )}
        </h4>
        <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {date}
        </span>
      </div>
      {item.description && (
        <p className="mt-2 line-clamp-2 text-[12.5px] leading-[1.55] text-muted-foreground">
          {item.description}
        </p>
      )}
    </article>
  )
}

function IconPill({
  children,
  onClick,
  label,
  destructive,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background',
        destructive && 'hover:border-destructive hover:text-destructive',
      )}
    >
      {children}
    </button>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Dialog de edição                                                  */
/* ──────────────────────────────────────────────────────────────── */

interface EditDialogProps {
  item: PortfolioItem | null
  onClose: () => void
  onSave: (patch: Partial<Pick<PortfolioItem, 'title' | 'description'>>) => void
  saving: boolean
}

function EditDialog({ item, onClose, onSave, saving }: EditDialogProps) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')

  useEffect(() => {
    if (item) {
      setTitle(item.title ?? '')
      setDesc(item.description ?? '')
    }
  }, [item])

  return (
    <Dialog
      open={!!item}
      onClose={() => {
        if (saving) return
        setTitle('')
        setDesc('')
        onClose()
      }}
      title="Editar peça"
      size="md"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              setTitle('')
              setDesc('')
              onClose()
            }}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSave({
                title: title.trim() || null,
                description: desc.trim() || null,
              })
              setTitle('')
              setDesc('')
            }}
            disabled={saving}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      {item && (
        <div className="space-y-4">
          <div className="overflow-hidden border border-border bg-muted">
            <img
              src={item.image_url}
              alt=""
              className="h-40 w-full object-cover"
            />
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="edit-title"
              className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground"
            >
              Título
            </Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="edit-desc"
              className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground"
            >
              Descrição
            </Label>
            <Textarea
              id="edit-desc"
              rows={2}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
        </div>
      )}
    </Dialog>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Utilidades                                                        */
/* ──────────────────────────────────────────────────────────────── */

// "04 OUT 2026" — formato mono curto, sem "de"s do Intl pt-BR.
const MONTHS_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]
function formatMonoDate(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getDate()).padStart(2, '0')
  const mon = MONTHS_PT[d.getMonth()]
  const year = d.getFullYear()
  return `${day} ${mon} ${year}`
}

