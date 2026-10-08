import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { useMyPlan } from '@/hooks/queries/useMyPermissions'
import {
  teamMembersKey,
  useMyTeam,
  useTeamMembers,
} from '@/hooks/queries/useMyTeam'
import { teamInvitesKey, useTeamInvites } from '@/hooks/queries/useTeamInvites'
import { leaveTeam, removeTeamMember } from '@/services/teams'
import {
  createInvite,
  revokeInvite,
  type TeamInvite,
} from '@/services/team-invites'

/**
 * `/dashboard/equipe` — centro de controle da equipe. Visibilidade:
 *   - Plano individual (max_team_members null ou < 2): mostra nudge
 *     de upgrade.
 *   - Plano de equipe: lista membros + convites pendentes. Owner
 *     tem botões de convidar/remover/cancelar convite; member só vê.
 */
export function TeamSettingsPage() {
  const { user } = useAuth()
  const { data: team, isLoading: teamLoading } = useMyTeam()
  const { data: plan } = useMyPlan()
  const { data: members, isLoading: membersLoading } = useTeamMembers(team?.id)
  const { data: invites } = useTeamInvites(team?.id)

  const qc = useQueryClient()
  const isOwner = !!team && !!user && team.owner_user_id === user.id
  const planAllowsTeam = (plan?.max_team_members ?? 0) >= 2

  const [inviteOpen, setInviteOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const removeMut = useMutation({
    mutationFn: (userId: string) => removeTeamMember(userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamMembersKey(team?.id) })
      setConfirmRemove(null)
    },
  })

  const leaveMut = useMutation({
    mutationFn: () => leaveTeam(),
    onSuccess: () => {
      // Membro saiu → recarrega tudo pra pegar o novo solo team.
      setConfirmLeave(false)
      window.location.href = '/dashboard'
    },
  })

  if (teamLoading || !team) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando equipe...
        </CardContent>
      </Card>
    )
  }

  const pendingInvites = (invites ?? []).filter(
    (i) => i.status === 'pending' && new Date(i.expires_at) > new Date(),
  )
  const seatsCap = plan?.max_team_members ?? null
  const seatsUsed = (members?.length ?? 0) + pendingInvites.length

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Users2 className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-semibold tracking-tight">Equipe</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          <strong>{team.name}</strong> ·{' '}
          {planAllowsTeam
            ? `${seatsUsed} de ${seatsCap} vagas em uso`
            : 'Plano individual'}
        </p>
      </header>

      {!planAllowsTeam && (
        <Card>
          <CardContent className="flex items-start gap-3 py-6">
            <AlertCircle className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                Seu plano atual não inclui equipe.
              </p>
              <p className="text-muted-foreground">
                Faça upgrade pra um plano de equipe pra convidar outros
                profissionais e compartilhar o portfólio.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => (window.location.href = '/dashboard/configuracoes/assinatura')}
              >
                Ver planos
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Membros ------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Membros
          </h2>
          {planAllowsTeam && isOwner && (
            <Button
              size="sm"
              onClick={() => setInviteOpen(true)}
              disabled={seatsCap !== null && seatsUsed >= seatsCap}
            >
              <UserPlus className="h-4 w-4" />
              Convidar
            </Button>
          )}
        </div>
        {membersLoading ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando membros...
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {(members ?? []).map((m) => (
              <li
                key={m.user_id}
                className="flex items-center gap-3 rounded-xl border bg-background p-3"
              >
                <Avatar name={m.profile?.name ?? '?'} src={m.profile?.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {m.profile?.name ?? 'Sem nome'}
                    </span>
                    {m.role === 'owner' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        Dono
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    @{m.profile?.slug ?? '—'} · entrou {formatDateBR(m.joined_at)}
                  </p>
                </div>
                {isOwner && m.role === 'member' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setConfirmRemove({
                        userId: m.user_id,
                        name: m.profile?.name ?? 'esse membro',
                      })
                    }
                    aria-label={`Remover ${m.profile?.name ?? 'membro'}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Convites pendentes ------------------------------------- */}
      {planAllowsTeam && isOwner && pendingInvites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Convites pendentes
          </h2>
          <ul className="space-y-2">
            {pendingInvites.map((inv) => (
              <PendingInviteRow
                key={inv.id}
                invite={inv}
                onRevoked={() => {
                  void qc.invalidateQueries({ queryKey: teamInvitesKey(team.id) })
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Sair da equipe (member) --------------------------------- */}
      {!isOwner && (
        <section className="space-y-3 border-t pt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Deixar a equipe
          </h2>
          <p className="text-xs text-muted-foreground">
            Você sairá da equipe <strong>{team.name}</strong> e voltará ao plano
            grátis individual. Suas fotos no portfólio compartilhado ficam com
            a equipe. Sua agenda, serviços e clientes continuam seus.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmLeave(true)}
          >
            <LogOut className="h-4 w-4" />
            Sair da equipe
          </Button>
        </section>
      )}

      {/* Dialogs ------------------------------------------------- */}
      {inviteOpen && (
        <InviteDialog
          teamId={team.id}
          onClose={() => setInviteOpen(false)}
          onSent={() => {
            setInviteOpen(false)
            void qc.invalidateQueries({ queryKey: teamInvitesKey(team.id) })
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && removeMut.mutate(confirmRemove.userId)}
        title={`Remover ${confirmRemove?.name}?`}
        description="A pessoa sai da equipe e volta pro plano grátis individual. As fotos que ela subiu ficam com a equipe."
        confirmLabel="Remover"
        destructive
        loading={removeMut.isPending}
      />

      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => leaveMut.mutate()}
        title="Sair da equipe?"
        description="Você perde acesso ao portfólio compartilhado e volta ao plano grátis. Agenda, serviços e clientes continuam seus."
        confirmLabel="Sair"
        destructive
        loading={leaveMut.isPending}
      />
    </div>
  )
}

interface PendingInviteRowProps {
  invite: TeamInvite
  onRevoked: () => void
}

function PendingInviteRow({ invite, onRevoked }: PendingInviteRowProps) {
  const [busy, setBusy] = useState(false)
  async function handleRevoke() {
    setBusy(true)
    try {
      await revokeInvite(invite.id)
      onRevoked()
    } catch (err) {
      console.error(err)
      setBusy(false)
    }
  }
  return (
    <li className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
      <div className="rounded-full bg-background p-2">
        <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{invite.email}</p>
        <p className="truncate text-xs text-muted-foreground">
          Convidado em {formatDateBR(invite.created_at)} · expira em{' '}
          {formatDateBR(invite.expires_at)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleRevoke}
        disabled={busy}
        aria-label="Cancelar convite"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
      </Button>
    </li>
  )
}

interface InviteDialogProps {
  teamId: string
  onClose: () => void
  onSent: () => void
}

function InviteDialog({ onClose, onSent }: InviteDialogProps) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!email.includes('@')) {
      setErr('Digite um email válido.')
      return
    }
    setSubmitting(true)
    try {
      await createInvite(email.trim().toLowerCase())
      onSent()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível convidar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={submitting ? () => undefined : onClose}
      title="Convidar membro"
      description="Enviamos um email com link pra pessoa definir a senha e entrar na equipe."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colega@exemplo.com"
            required
            disabled={submitting}
          />
        </div>
        {err && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enviar convite
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function Avatar({ name, src }: { name: string; src: string | null | undefined }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-9 w-9 rounded-full border object-cover"
        loading="lazy"
      />
    )
  }
  const initials = name
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {initials}
    </div>
  )
}

function formatDateBR(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d)
}
