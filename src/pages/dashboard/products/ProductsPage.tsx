import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Package, Pencil, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { productsQueryKey, useProducts } from '@/hooks/queries/useProducts'
import {
  createProduct,
  deleteProduct,
  toggleProductActive,
  updateProduct,
} from '@/services/products'
import type { Product } from '@/types/database'
import { formatCurrencyBRL, cn } from '@/lib/utils'
import { ProductForm, type ProductFormResult } from './ProductForm'

export function ProductsPage() {
  const queryClient = useQueryClient()
  const { data: profile } = useMyProfile()
  const { data: products, isLoading } = useProducts(profile?.id)

  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  function invalidate() {
    if (profile) {
      queryClient.invalidateQueries({ queryKey: productsQueryKey(profile.id) })
    }
  }

  const createMutation = useMutation({
    mutationFn: ({ result }: { result: ProductFormResult }) => {
      if (!profile) throw new Error('Perfil não carregado')
      return createProduct(profile.id, result.input, result.imageFile)
    },
    onSuccess: () => {
      invalidate()
      setCreating(false)
      setFormError(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ current, result }: { current: Product; result: ProductFormResult }) =>
      updateProduct(current, result.input, {
        imageFile: result.imageFile,
        removeImage: result.removeImage,
      }),
    onSuccess: () => {
      invalidate()
      setEditing(null)
      setFormError(null)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ product, active }: { product: Product; active: boolean }) =>
      toggleProductActive(product, active),
    onSuccess: invalidate,
    onError: () => setListError('Não foi possível atualizar o status.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (product: Product) => deleteProduct(product),
    onSuccess: () => {
      invalidate()
      setDeleting(null)
      setListError(null)
    },
    onError: () => {
      setListError('Não foi possível excluir. Tente novamente.')
      setDeleting(null)
    },
  })

  async function handleSave(result: ProductFormResult) {
    setFormError(null)
    try {
      if (editing) {
        await updateMutation.mutateAsync({ current: editing, result })
      } else {
        await createMutation.mutateAsync({ result })
      }
    } catch {
      setFormError('Não foi possível salvar. Tente novamente.')
    }
  }

  if (isLoading || !profile) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando produtos...
        </CardContent>
      </Card>
    )
  }

  const hasAny = (products?.length ?? 0) > 0
  const dialogOpen = creating || editing !== null
  const submitting = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produtos</h1>
          <p className="text-sm text-muted-foreground">
            Itens que você comercializa. Produtos inativos não aparecem na sua página pública.
          </p>
        </div>
        <Button
          onClick={() => {
            setFormError(null)
            setCreating(true)
          }}
        >
          <Plus className="h-4 w-4" />
          Novo produto
        </Button>
      </div>

      {listError && (
        <Card>
          <CardContent className="py-3 text-sm text-destructive" role="alert">
            {listError}
          </CardContent>
        </Card>
      )}

      {!hasAny ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products!.map((p) => (
            <li key={p.id}>
              <ProductCard
                product={p}
                onEdit={() => {
                  setFormError(null)
                  setEditing(p)
                }}
                onToggle={(active) =>
                  toggleMutation.mutate({ product: p, active })
                }
                onDelete={() => setDeleting(p)}
                toggling={
                  toggleMutation.isPending &&
                  toggleMutation.variables?.product.id === p.id
                }
              />
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => {
          if (submitting) return
          setCreating(false)
          setEditing(null)
        }}
        title={editing ? 'Editar produto' : 'Novo produto'}
        description={
          editing
            ? 'Atualize os dados deste produto.'
            : 'Preencha os dados do produto que você vende.'
        }
        size="lg"
      >
        {dialogOpen && (
          <ProductForm
            initial={editing ?? undefined}
            submitting={submitting}
            errorMessage={formError}
            onSubmit={handleSave}
            onCancel={() => {
              setCreating(false)
              setEditing(null)
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting)
        }}
        title="Excluir produto?"
        description={
          deleting
            ? `"${deleting.name}" será removido permanentemente. Essa ação não pode ser desfeita.`
            : ''
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

interface ProductCardProps {
  product: Product
  onEdit: () => void
  onToggle: (active: boolean) => void
  onDelete: () => void
  toggling: boolean
}

function ProductCard({ product, onEdit, onToggle, onDelete, toggling }: ProductCardProps) {
  const lowStock = product.stock <= 3 && product.stock > 0
  const outOfStock = product.stock === 0

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-background">
      <div className="relative aspect-[4/3] bg-muted">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Package className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
        {!product.active && (
          <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium backdrop-blur">
            inativo
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{product.name}</p>
          {product.sku && (
            <p className="truncate text-xs text-muted-foreground">SKU {product.sku}</p>
          )}
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-base font-semibold">
              {formatCurrencyBRL(product.price_cents)}
            </p>
            <p
              className={cn(
                'text-xs',
                outOfStock
                  ? 'text-destructive'
                  : lowStock
                    ? 'text-amber-600'
                    : 'text-muted-foreground',
              )}
            >
              {outOfStock
                ? 'sem estoque'
                : `${product.stock} em estoque${lowStock ? ' (baixo)' : ''}`}
            </p>
          </div>
          <Switch
            checked={product.active}
            onCheckedChange={onToggle}
            disabled={toggling}
            aria-label={product.active ? 'Desativar' : 'Ativar'}
          />
        </div>

        <div className="flex gap-1 border-t pt-2">
          <Button variant="ghost" size="sm" onClick={onEdit} className="flex-1 justify-center">
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="flex-1 justify-center text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Excluir
          </Button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Package className="h-5 w-5" aria-hidden="true" />
        </div>
        <CardTitle className="mt-2">Nenhum produto ainda</CardTitle>
        <CardDescription>
          Cadastre o que você vende para controlar estoque e aparecer para seus clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pb-6">
        <Button onClick={onCreate}>
          <Plus className="h-4 w-4" />
          Criar primeiro produto
        </Button>
      </CardContent>
    </Card>
  )
}
