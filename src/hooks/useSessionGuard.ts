import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

/**
 * Enforce "um usuário logado em UM device por vez". Fluxo:
 *
 *  1. Login detectado (user vira non-null) → se não há claim local
 *     deste user, gera um session_id novo (crypto.randomUUID), grava
 *     em `localStorage` e em `public.user_sessions`.
 *  2. Login detectado com claim local do MESMO user → verifica se o
 *     `user_sessions.session_id` ainda bate com o local. Se bater,
 *     este é o device ativo; segue. Se não bater, outro device logou
 *     e assumiu — kicka.
 *  3. Heartbeat de 60s: re-verifica DB vs local. Em caso de mismatch,
 *     kicka.
 *
 * `localStorage` é COMPARTILHADO entre abas do mesmo browser — abas
 * convivem. Já `sessionStorage` NÃO serviria (abas teriam ids
 * diferentes e se chutariam).
 */

const LOCAL_KEY = 'minha-agenda:session-claim'
const HEARTBEAT_MS = 60 * 1000

// Durante sessão de recovery (link do email), não rodamos o guard. Dois
// motivos: (1) o claim local antigo pode diferir do DB (outro device
// legitimamente logado) e o overlay "sessão encerrada" cobriria a tela
// antes do user conseguir trocar a senha; (2) se claim-arrmos aqui,
// sobrescrevemos o session_id e derrubamos o device legítimo mesmo que
// o user nem complete o reset. Flag vem do AuthContext (evento
// `PASSWORD_RECOVERY` do Supabase). Depois do `updateUser` o fluxo
// força signOut → próximo login reclaim-a normalmente.

interface Stored {
  userId: string
  sessionId: string
}

function readLocal(): Stored | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (!parsed?.userId || !parsed?.sessionId) return null
    return parsed
  } catch {
    return null
  }
}

function writeLocal(entry: Stored): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(entry))
  } catch {
    /* storage cheio / modo privado — ignorar */
  }
}

function clearLocal(): void {
  try {
    localStorage.removeItem(LOCAL_KEY)
  } catch {
    /* ignore */
  }
}

type DbReadResult =
  | { kind: 'row'; sessionId: string }
  | { kind: 'missing' }
  | { kind: 'error' }

async function readDbSessionId(userId: string): Promise<DbReadResult> {
  const { data, error } = await supabase
    .from('user_sessions')
    .select('session_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    // Erro de rede / RLS / etc — NÃO interpretar como "linha apagada",
    // senão offline rápido fazia kick falso. Caller trata como no-op.
    console.warn('[session-guard] falha ao ler user_sessions:', error.message)
    return { kind: 'error' }
  }
  const sid = data?.session_id as string | null | undefined
  if (!sid) return { kind: 'missing' }
  return { kind: 'row', sessionId: sid }
}

async function claimSession(userId: string, sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('user_sessions')
    .upsert(
      { user_id: userId, session_id: sessionId },
      { onConflict: 'user_id' },
    )
  if (error) {
    console.warn('[session-guard] falha ao gravar user_sessions:', error.message)
  }
}

export function useSessionGuard(): { kicked: boolean } {
  const { user, loading, isRecoverySession } = useAuth()
  const [kicked, setKicked] = useState(false)
  const localIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (loading) return

    if (isRecoverySession) {
      // Sessão de recovery (link do email) — não claim nem heartbeat.
      // Também garante que o overlay suma se o user navegou pra cá
      // depois de ter sido kickado em outra rota.
      setKicked(false)
      return
    }

    if (!user) {
      // Deslogado — limpa claim local e reseta estado pra próximo login.
      clearLocal()
      localIdRef.current = null
      setKicked(false)
      return
    }

    let cancelled = false
    let timer: number | undefined

    async function init() {
      const stored = readLocal()
      let localId: string

      if (stored && stored.userId === user!.id) {
        // Mesmo user que já estava — reutiliza o session_id local,
        // mas confirma com o DB antes de considerar "ativo".
        localId = stored.sessionId
        const result = await readDbSessionId(user!.id)
        if (cancelled) return
        if (result.kind === 'missing') {
          // Linha apagada = alguém (reset de senha ou signOut com
          // scope=global em outro device) invalidou a sessão deste
          // user. Kicka — reclaim mascararia a invalidação legítima.
          setKicked(true)
          return
        } else if (result.kind === 'row' && result.sessionId !== localId) {
          // Outro device assumiu enquanto estávamos fora/offline.
          setKicked(true)
          return
        }
        // kind === 'error' → trata como no-op (não kicka em erro
        // transiente de rede/RLS). Heartbeat tenta de novo.
      } else {
        // User diferente (ou primeira vez neste browser) → novo claim.
        localId =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : // Fallback bobo mas suficiente — a probabilidade de
              // colidir com outro uuid v4 ainda é desprezível.
              `${Date.now()}-${Math.random().toString(36).slice(2)}`
        writeLocal({ userId: user!.id, sessionId: localId })
        await claimSession(user!.id, localId)
      }

      if (cancelled) return
      localIdRef.current = localId

      // Heartbeat
      timer = window.setInterval(() => {
        void heartbeat()
      }, HEARTBEAT_MS)
    }

    async function heartbeat() {
      if (!user || !localIdRef.current) return
      const result = await readDbSessionId(user.id)
      if (cancelled) return
      // Mismatch OU linha apagada → kicka. Erro transiente de rede/RLS
      // é no-op (tenta de novo no próximo tick).
      const shouldKick =
        (result.kind === 'row' && result.sessionId !== localIdRef.current) ||
        result.kind === 'missing'
      if (shouldKick) {
        setKicked(true)
        if (timer !== undefined) {
          clearInterval(timer)
          timer = undefined
        }
      }
    }

    void init()

    return () => {
      cancelled = true
      if (timer !== undefined) clearInterval(timer)
    }
  }, [user, loading, isRecoverySession])

  return { kicked }
}
