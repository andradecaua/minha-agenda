import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Injeta a versão do package.json no SW pra ajudar a identificar
// qual revision está rodando num device. Bumpar a versão a cada
// deploy é parte do fluxo — ver CONTEXT.md § PWA.
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, './package.json'), 'utf-8'),
) as { version: string }

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      // Auto-registra o SW e aplica atualização SEM pedir confirmação.
      // Como só cacheamos o shell (JS/CSS/fontes/ícones), aplicar
      // update automaticamente é seguro — dados do Supabase sempre
      // vêm do servidor.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Inclui os assets do /public no precache (ícones e favicon).
      includeAssets: [
        'favicon.ico',
        'favicon.svg',
        'icon.svg',
        'apple-touch-icon-180x180.png',
      ],
      manifest: {
        id: '/',
        name: 'Minha Agenda',
        short_name: 'Minha Agenda',
        description:
          'Agenda online para profissionais autônomos — gerencie clientes, serviços e reservas.',
        lang: 'pt-BR',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        // Fallbacks explícitos — alguns Chromes Android no fluxo WebAPK
        // consultam `display_override` antes de `display` e rejeitam o
        // manifest se ambos não concordarem.
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        // start_url público — rotas autenticadas como `/dashboard` fazem o
        // validador do WebAPK (Android) hesitar; a landing responde sem
        // redirect e dispara o SPA que já sabe pra onde mandar o user.
        start_url: '/',
        scope: '/',
        prefer_related_applications: false,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache do shell (index.html + bundles do Vite + CSS + ícones).
        // Cada novo build gera hashes diferentes → o SW baixa só o que
        // mudou e substitui atomicamente.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Fontes do Google são buscadas via rede → cache first com TTL
        // generoso. Melhora o 2º carregamento sem travar atualizações.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Navegações desconhecidas (`/dashboard/*`) sempre caem no
        // index.html precacheado — isso faz o SPA abrir offline mesmo
        // em deep-links. O App Router cuida do resto.
        navigateFallback: '/index.html',
        // Exceções: deixa requests pro Supabase e pra funções passarem
        // direto pra rede — nunca servir dados stale sem awareness.
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /\/functions\//],
      },
      devOptions: {
        // Em dev o SW fica desligado por padrão — habilitar sob demanda
        // só pra testar fluxo de instalação localmente.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
})
