import { useEffect } from 'react'

interface DocumentHead {
  title: string
  description?: string
  ogImage?: string
}

/**
 * Atualiza <title>, meta description e Open Graph durante a vida do
 * componente. Restaura os valores anteriores no unmount — útil para
 * SPAs onde várias páginas competem pelo head.
 *
 * Para SEO forte (crawlers que não executam JS), seria necessário
 * SSR/SSG. Esta versão cobre bem compartilhamento no WhatsApp/Twitter
 * (que fazem GET sem JS, mas lêem OG tags já presentes se houver
 * pré-render) e navegação dentro do app.
 */
export function useDocumentHead({ title, description, ogImage }: DocumentHead) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = title

    const descMeta = setMeta('name', 'description', description ?? '')
    const ogTitleMeta = setMeta('property', 'og:title', title)
    const ogDescMeta = setMeta('property', 'og:description', description ?? '')
    const ogTypeMeta = setMeta('property', 'og:type', 'profile')
    const ogImageMeta = ogImage
      ? setMeta('property', 'og:image', ogImage)
      : null

    return () => {
      document.title = prevTitle
      descMeta?.remove()
      ogTitleMeta?.remove()
      ogDescMeta?.remove()
      ogTypeMeta?.remove()
      ogImageMeta?.remove()
    }
  }, [title, description, ogImage])
}

function setMeta(
  attr: 'name' | 'property',
  key: string,
  value: string,
): HTMLMetaElement | null {
  if (!value) return null
  const existing = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  )
  if (existing) {
    existing.setAttribute('content', value)
    // existing é propriedade da aplicação; não o removemos no cleanup
    return null
  }
  const el = document.createElement('meta')
  el.setAttribute(attr, key)
  el.setAttribute('content', value)
  document.head.appendChild(el)
  return el
}
