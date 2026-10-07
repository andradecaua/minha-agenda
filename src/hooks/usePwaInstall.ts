import { useEffect, useState } from 'react'

/**
 * Hook em cima do evento `beforeinstallprompt` (Chrome, Edge, Samsung
 * Internet, etc). Expõe:
 *
 *   - `canInstall`: `true` só quando o browser disparou o prompt E o
 *     app ainda não está rodando em modo standalone.
 *   - `install()`: dispara o diálogo nativo e aguarda a escolha.
 *   - `isStandalone`: útil pra esconder promoções/CTAs de instalação.
 *
 * **iOS Safari** não dispara `beforeinstallprompt` — a instalação lá
 * é manual (Compartilhar → Adicionar à Tela de Início). O botão
 * simplesmente não aparece nesse browser; se virar prioridade,
 * adiciona uma instrução estática por detecção de UA.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface UsePwaInstall {
  canInstall: boolean
  isStandalone: boolean
  install: () => Promise<boolean>
}

export function usePwaInstall(): UsePwaInstall {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [standalone, setStandalone] = useState(isStandalone)

  useEffect(() => {
    function onPrompt(event: Event) {
      // Impede o mini-infobar automático do Chrome — queremos controlar
      // quando o diálogo aparece (botão na sidebar).
      event.preventDefault()
      setPrompt(event as BeforeInstallPromptEvent)
    }

    function onInstalled() {
      setPrompt(null)
      setStandalone(true)
    }

    const mq = window.matchMedia('(display-mode: standalone)')
    function onDisplayModeChange() {
      setStandalone(isStandalone())
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    mq.addEventListener('change', onDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      mq.removeEventListener('change', onDisplayModeChange)
    }
  }, [])

  async function install(): Promise<boolean> {
    if (!prompt) return false
    await prompt.prompt()
    const choice = await prompt.userChoice
    // Chrome descarta o evento depois do `prompt()` — nullificar
    // garante que o botão suma depois da escolha.
    setPrompt(null)
    return choice.outcome === 'accepted'
  }

  return {
    canInstall: !!prompt && !standalone,
    isStandalone: standalone,
    install,
  }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari expõe `navigator.standalone` (non-standard, legacy).
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}
