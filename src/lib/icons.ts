// Catálogo curado de ícones para cadastro de serviço e produto.
//
// Decisão deliberada de NÃO expor o lucide-react inteiro (~1k ícones
// nos sobrecarregariam no form picker). A lista abaixo cobre os
// nichos principais do app (barbearia, salão, estética, tatuagem,
// manicure, fitness, bem-estar) sem gerar paralisia de escolha.
//
// Formato do valor salvo no banco: string com o NOME do componente
// (ex.: 'Scissors'). O helper `getIcon(name)` resolve pro componente
// via lookup — fica em UM lugar só; se o ícone não existir mais no
// pacote (ex.: tree-shaking), devolvemos `null` sem crashar.

import {
  Activity,
  Brush,
  Camera,
  Clock,
  Coffee,
  Crown,
  Droplet,
  Dumbbell,
  Flower,
  Flower2,
  Gem,
  Gift,
  Heart,
  Music,
  Package,
  Palette,
  Scissors,
  ShoppingBag,
  Smile,
  Sparkles,
  Star,
  Sun,
  Tag,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export interface IconOption {
  name: string
  label: string
  component: LucideIcon
}

/** Catálogo curado — mesma lista pra serviços e produtos. */
export const ICON_CATALOG: readonly IconOption[] = [
  { name: 'Scissors', label: 'Tesoura', component: Scissors },
  { name: 'Brush', label: 'Pincel', component: Brush },
  { name: 'Palette', label: 'Paleta', component: Palette },
  { name: 'Sparkles', label: 'Brilho', component: Sparkles },
  { name: 'Gem', label: 'Joia', component: Gem },
  { name: 'Crown', label: 'Coroa', component: Crown },
  { name: 'Smile', label: 'Sorriso', component: Smile },
  { name: 'Heart', label: 'Coração', component: Heart },
  { name: 'Flower', label: 'Flor', component: Flower },
  { name: 'Flower2', label: 'Flor 2', component: Flower2 },
  { name: 'Sun', label: 'Sol', component: Sun },
  { name: 'Droplet', label: 'Gota', component: Droplet },
  { name: 'Dumbbell', label: 'Halter', component: Dumbbell },
  { name: 'Activity', label: 'Energia', component: Activity },
  { name: 'Zap', label: 'Raio', component: Zap },
  { name: 'Star', label: 'Estrela', component: Star },
  { name: 'Gift', label: 'Presente', component: Gift },
  { name: 'Tag', label: 'Etiqueta', component: Tag },
  { name: 'Package', label: 'Pacote', component: Package },
  { name: 'ShoppingBag', label: 'Sacola', component: ShoppingBag },
  { name: 'Coffee', label: 'Café', component: Coffee },
  { name: 'Clock', label: 'Relógio', component: Clock },
  { name: 'Camera', label: 'Câmera', component: Camera },
  { name: 'Music', label: 'Música', component: Music },
]

const ICON_BY_NAME = new Map(ICON_CATALOG.map((i) => [i.name, i]))

/**
 * Resolve um ícone salvo no banco pro seu componente React.
 * Devolve `null` quando o nome é inválido ou NULL — chamadores
 * decidem o fallback (nenhum ícone, texto inicial, etc).
 */
export function getIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null
  return ICON_BY_NAME.get(name)?.component ?? null
}
