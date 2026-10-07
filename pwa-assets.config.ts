import {
  defineConfig,
  minimal2023Preset,
} from '@vite-pwa/assets-generator/config'

/**
 * Gera os ícones PWA (192, 512, maskable 512, apple-touch 180, favicon)
 * a partir de UM SVG mestre. Rodar sob demanda com:
 *
 *   npx pwa-assets-generator
 *
 * O resultado vai pra `public/` e deve ser comitado. O manifesto do PWA
 * (configurado em `vite.config.ts`) referencia esses arquivos por nome.
 */
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: {
        ...minimal2023Preset.maskable.resizeOptions,
        // Cor do padding na versão maskable — bate com o fundo do SVG.
        background: '#0f172a',
      },
    },
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: {
        ...minimal2023Preset.apple.resizeOptions,
        background: '#0f172a',
      },
    },
  },
  images: ['public/icon.svg'],
  headLinkOptions: {
    preset: '2023',
  },
})
