/// <reference lib="webworker" />
/**
 * Service Worker custom (modo `injectManifest`).
 *
 * Mantém o comportamento do `generateSW` anterior (precache do app
 * shell + cache de Google Fonts + fallback de navegação) e adiciona:
 *
 *  - `push`              → showNotification com `title`/`body`/`tag`/`url`
 *  - `notificationclick` → foca uma aba existente ou abre a `url`
 *
 * O manifest de precache é injetado em build (`__WB_MANIFEST`). As
 * configurações declarativas que estavam em `workbox` dentro do
 * `vite.config.ts` passam a viver aqui como código.
 */

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope

interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
}

// 1) Precache do shell (gerado pelo Vite PWA)
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// 2) Fallback de navegação (SPA deep-links offline)
const navDenylist = [/^\/api\//, /^\/auth\//, /\/functions\//]
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: navDenylist,
  }),
)

// 3) Google Fonts — stylesheet
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-stylesheets',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
)

// 4) Google Fonts — webfonts (precisa de CacheableResponse pra opaque)
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
)

// 5) Permite que o cliente peça o skip-waiting (usado pelo PwaUpdateBanner)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// 6) Força ativação imediata — primeira vez que esse SW instala, ou
//    sempre que uma versão nova chega, não ficamos presos em `waiting`.
//    O PwaUpdateBanner continua funcionando pra avisar o user; ele só
//    não é mais BLOQUEANTE pra features novas (ex: push) que precisam
//    do SW novo pra funcionar no mesmo instante.
self.addEventListener('install', () => {
  void self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// 7) Push handler
self.addEventListener('push', (event) => {
  const payload = parsePayload(event.data)
  if (!payload) return

  const options: NotificationOptions = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-64x64.png',
    tag: payload.tag,
    data: { url: payload.url ?? '/dashboard/agenda' },
  }
  event.waitUntil(self.registration.showNotification(payload.title, options))
})

// 8) Click na notificação — foca aba existente ou abre
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data as { url?: string } | null)?.url ?? '/dashboard/agenda'

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of all) {
        const u = new URL(client.url)
        if (u.pathname.startsWith('/dashboard')) {
          await client.focus()
          if ('navigate' in client) {
            try {
              await client.navigate(target)
            } catch {
              // alguns browsers rejeitam navigate cross-doc; ignora.
            }
          }
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})

function parsePayload(data: PushMessageData | null): PushPayload | null {
  if (!data) return null
  try {
    const p = data.json() as PushPayload
    if (p && typeof p.title === 'string' && typeof p.body === 'string') {
      return p
    }
    return null
  } catch {
    const text = data.text()
    if (!text) return null
    return { title: 'Minha Agenda', body: text }
  }
}
