// Helpers de telefone (BR). Guardamos sempre só dígitos no banco;
// formatação é camada de apresentação.

/** Mantém apenas dígitos. */
export function normalizePhone(input: string | null | undefined): string {
  if (!input) return ''
  return input.replace(/\D/g, '')
}

/**
 * Formato BR legível a partir dos dígitos puros.
 *  - 11 dígitos: (11) 99999-9999 (celular)
 *  - 10 dígitos: (11) 9999-9999  (fixo)
 *  - Parcial: aplica a máscara até onde deu, útil durante a digitação
 *  - Vazio ou inválido: retorna o próprio input (ou vazio)
 */
export function formatPhoneBR(digits: string): string {
  const d = normalizePhone(digits)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6, 10)}`
  }
  // 11 dígitos — 5 no primeiro bloco (celular)
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
}

/** `true` se tem DDD + número (10 ou 11 dígitos). */
export function isValidPhoneBR(digits: string): boolean {
  const d = normalizePhone(digits)
  return d.length === 10 || d.length === 11
}

/**
 * Monta um link WhatsApp a partir dos dígitos. Inclui o DDI 55 (BR)
 * quando a entrada veio só com DDD + número.
 */
export function waLinkBR(digits: string, message?: string): string {
  const d = normalizePhone(digits)
  if (!d) return '#'
  const withCountry = d.startsWith('55') ? d : `55${d}`
  const url = `https://wa.me/${withCountry}`
  return message ? `${url}?text=${encodeURIComponent(message)}` : url
}

/** tel: para marcar discagem direta em celulares. */
export function telLink(digits: string): string {
  const d = normalizePhone(digits)
  if (!d) return '#'
  return d.startsWith('55') ? `tel:+${d}` : `tel:+55${d}`
}
