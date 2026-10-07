import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Banner global que avisa quando uma nova versão do PWA foi baixada
 * e está esperando pra ativar. Clicar em "Atualizar" chama
 * `updateServiceWorker(true)` — o novo SW assume (skipWaiting) e a
 * página recarrega sozinha pra servir o shell novo.
 *
 * O vite-plugin-pwa chama a função retornada pelo hook pra registrar
 * o SW manualmente (modo `prompt`). Também fazemos poll periódico
 * (`checkForUpdates`): a cada 60min o browser pergunta ao servidor
 * se tem `sw.js` novo. Em instâncias deixadas abertas dias a fio
 * isso garante que o banner apareça sem precisar fechar e reabrir.
 */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

export function PwaUpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      // Poll de atualização enquanto o app está aberto.
      setInterval(() => {
        void registration.update()
      }, UPDATE_CHECK_INTERVAL_MS)
    },
    onRegisterError(err) {
      console.warn('[pwa] registro do SW falhou:', err)
    },
  })

  // Dispara 1 check assim que o componente monta — útil quando o user
  // acaba de abrir o app e um deploy aconteceu segundos antes.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg) void reg.update()
    })
  }, [])

  if (!needRefresh) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-primary/20 bg-primary text-primary-foreground shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        <span className="flex-1">
          Nova versão do Minha Agenda disponível.
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void updateServiceWorker(true)}
        >
          Atualizar agora
        </Button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          aria-label="Dispensar"
          className="rounded-md p-1 text-primary-foreground/80 hover:bg-primary-foreground/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
