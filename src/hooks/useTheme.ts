import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'theme'

function readStored(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignora: SSR, Safari privado, etc. */
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  )
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return pref
}

function applyToDom(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
}

/**
 * Preferência de tema persistida em localStorage. O inline script em
 * index.html já aplica a classe no primeiro paint pra evitar flash —
 * este hook mantém sincronizado durante a sessão e expõe o setter.
 */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => readStored())
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readStored()))

  useEffect(() => {
    const r = resolve(pref)
    setResolved(r)
    applyToDom(r)
    try {
      localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      /* ignora */
    }
  }, [pref])

  // Se o usuário escolheu "system", acompanha mudanças do OS em
  // tempo real (ex.: dark auto no sunset).
  useEffect(() => {
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const r: ResolvedTheme = mq.matches ? 'dark' : 'light'
      setResolved(r)
      applyToDom(r)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const toggle = useCallback(() => {
    setPref((prev) => (resolve(prev) === 'dark' ? 'light' : 'dark'))
  }, [])

  return { pref, resolved, setPref, toggle }
}
