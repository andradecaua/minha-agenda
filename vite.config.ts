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
      // `injectManifest` (em vez de `generateSW`) porque o SW tem
      // handlers custom de `push` + `notificationclick` pra Web Push
      // (0041). O arquivo-fonte vive em `src/sw/sw.ts` e importa os
      // módulos workbox que antes eram declarativos no bloco
      // `workbox` abaixo (que agora alimenta `injectManifest`).
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      // 'prompt': novo SW instala em background mas aguarda confirmação
      // pra ativar. O frontend usa `useRegisterSW` em
      // `PwaUpdateBanner` pra mostrar "Nova versão disponível" com um
      // botão "Atualizar". Melhor UX que o `autoUpdate` silencioso —
      // o user vê que algo mudou, e pode escolher o momento de recarregar
      // sem perder trabalho em formulários/thread aberta.
      registerType: 'prompt',
      // Registro manual via hook (`useRegisterSW`). Impedir o
      // auto-registro evita duplicata e deixa o hook controlar o ciclo.
      injectRegister: null,
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
      injectManifest: {
        // Precache do shell (index.html + bundles do Vite + CSS + ícones).
        // Cada novo build gera hashes diferentes → o SW baixa só o que
        // mudou e substitui atomicamente. Runtime caching e navigation
        // fallback agora vivem no `src/sw/sw.ts` como código.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
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
