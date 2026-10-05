import { useMemo, useState } from 'react'
import { ChevronDown, Plus, Search, UserPlus } from 'lucide-react'
import type { ClientWithStats } from '@/services/clients'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PhoneInput } from '@/components/ui/phone-input'
import { Button } from '@/components/ui/button'
import { normalizePhone, formatPhoneBR } from '@/lib/phone'
import { cn } from '@/lib/utils'

export type ClientSelection =
  | { kind: 'existing'; clientId: string; name: string }
  | { kind: 'new'; name: string; phone: string; email: string }
  | { kind: 'none' }

interface ClientPickerProps {
  clients: ClientWithStats[]
  value: ClientSelection
  onChange: (next: ClientSelection) => void
}

export function ClientPicker({ clients, value, onChange }: ClientPickerProps) {
  const [search, setSearch] = useState('')
  const [showList, setShowList] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = normalizePhone(q)
    if (!q) return clients.slice(0, 20)
    return clients
      .filter((c) => {
        if (c.name.toLowerCase().includes(q)) return true
        if (qDigits && c.phone && normalizePhone(c.phone).includes(qDigits)) return true
        return false
      })
      .slice(0, 20)
  }, [clients, search])

  // --- Modo: cliente novo ------------------------------------
  if (value.kind === 'new') {
    return (
      <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Novo cliente</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ kind: 'none' })}
          >
            Voltar
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="np-name">Nome</Label>
          <Input
            id="np-name"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="Como o cliente se chama"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="np-phone">Telefone</Label>
          <PhoneInput
            id="np-phone"
            value={value.phone}
            onChange={(digits) => onChange({ ...value, phone: digits })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="np-email">E-mail (opcional)</Label>
          <Input
            id="np-email"
            type="email"
            value={value.email}
            onChange={(e) => onChange({ ...value, email: e.target.value })}
          />
        </div>
      </div>
    )
  }

  // --- Modo: cliente existente escolhido ---------------------
  if (value.kind === 'existing') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-background p-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{value.name}</p>
          <p className="text-xs text-muted-foreground">Cliente cadastrado</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ kind: 'none' })}
        >
          Trocar
        </Button>
      </div>
    )
  }

  // --- Modo: nenhum selecionado — busca/lista ----------------
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          placeholder="Buscar cliente por nome ou telefone..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setShowList(true)
          }}
          onFocus={() => setShowList(true)}
          className="pl-9 pr-9"
        />
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>

      {showList && (
        <div className="max-h-56 overflow-y-auto rounded-xl border bg-background">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              Nenhum cliente encontrado.
            </p>
          ) : (
            <ul className="divide-y">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ kind: 'existing', clientId: c.id, name: c.name })
                      setShowList(false)
                      setSearch('')
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-accent/40',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {c.phone ? formatPhoneBR(c.phone) : '—'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => onChange({ kind: 'new', name: '', phone: '', email: '' })}
      >
        <UserPlus className="h-4 w-4" />
        <Plus className="-ml-1 h-3 w-3" />
        Novo cliente
      </Button>
    </div>
  )
}
