/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Versão do app, injetada em build-time pelo vite.config.ts a partir
 *  do package.json. Usada pra identificar a versão rodando no cliente. */
declare const __APP_VERSION__: string
