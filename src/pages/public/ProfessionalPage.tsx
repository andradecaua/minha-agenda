import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarCheck,
  Clock,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Scissors,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { usePublicProfessional } from '@/hooks/queries/usePublicProfessional'
import { useDocumentHead } from '@/hooks/useDocumentHead'
import { formatCurrencyBRL, formatMinutesDuration } from '@/lib/utils'
import { formatPhoneBR, isValidPhoneBR, telLink, waLinkBR } from '@/lib/phone'
import { getIcon } from '@/lib/icons'
import type { PortfolioItem, Product, Service } from '@/types/database'
import { getPublicProfessional } from '@/services/public-profile'
import {
  BookingFlow,
  type BookingProChoice,
} from '@/pages/public/booking/BookingFlow'

export function ProfessionalPage() {
  const { slug } = useParams<{ slug: string }>()
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = usePublicProfessional(slug)

  // Slug do pro que o visitante quer reservar. `null` = modal fechado.
  // No open inicial é o dono da página (profile.slug). Quando a
  // equipe tem múltiplos membros, o BookingFlow permite trocar — a
  // callback `onPickPro` troca essa flag e re-renderiza com os dados
  // do novo pro. Carrega lazy via usePublicProfessional.
  const [bookingProSlug, setBookingProSlug] = useState<string | null>(null)
  const bookingProQuery = usePublicProfessional(bookingProSlug ?? undefined)

  const headTitle = data
    ? `${data.profile.name} · Minha Agenda`
    : 'Minha Agenda'
  const headDesc = data?.profile.bio
    ? data.profile.bio.slice(0, 160)
    : data
      ? `Reserve seu horário com ${data.profile.name} online.`
      : undefined
  useDocumentHead({
    title: headTitle,
    description: headDesc,
    ogImage: data?.profile.avatar_url ?? data?.portfolio[0]?.image_url ?? undefined,
  })

  // Pré-carrega dados dos membros da equipe pra que a troca de pro
  // dentro do BookingFlow (passo `professional`) seja instantânea —
  // settings/business_hours de cada pro já ficam quentes no cache.
  const isOwnerOfMultiTeam =
    !!data?.team &&
    data.team.members.length > 1 &&
    data.team.owner_user_id === data.profile.user_id
  useEffect(() => {
    if (!isOwnerOfMultiTeam || !data?.team) return
    for (const m of data.team.members) {
      if (m.slug === slug) continue // já carregado como profile principal
      void qc.prefetchQuery({
        queryKey: ['public-professional', m.slug],
        queryFn: () => getPublicProfessional(m.slug),
        staleTime: 2 * 60 * 1000,
      })
    }
  }, [isOwnerOfMultiTeam, data, slug, qc])

  if (isLoading) {
    return <PublicShell><LoadingState /></PublicShell>
  }

  if (isError || !data) {
    return <PublicShell><NotFoundState slug={slug} /></PublicShell>
  }

  const { profile, team, services, settings, portfolio, products } = data

  // Membro de uma equipe multi NÃO tem página individual: a "página
  // dele" é a página do time (do slug do dono). Redireciona pra lá
  // pra que a vitrine do time seja a única URL pública.
  if (team && team.members.length > 1 && team.owner_user_id !== profile.user_id) {
    const ownerSlug =
      team.members.find((m) => m.role === 'owner')?.slug ?? team.slug
    return <Navigate to={`/p/${ownerSlug}`} replace />
  }

  // A página do owner (seja solo ou time multi) é sempre o layout
  // individual: hero + portfolio + services + CTA. Quando o time
  // tem 2+ membros, o BookingFlow mostra um passo de seleção de
  // profissional (não há mais vitrine com cards).
  const bookingDisabled =
    !settings?.online_booking_enabled || services.length === 0
  const bookingMembers: BookingProChoice[] | undefined =
    team && team.members.length > 1
      ? team.members.map((m) => ({
          slug: m.slug,
          name: m.name,
          avatar_url: m.avatar_url,
        }))
      : undefined

  return (
    <PublicShell>
      <Hero
        avatarUrl={profile.avatar_url}
        name={profile.name}
        bio={profile.bio}
        city={profile.city}
        phone={profile.phone}
        backgroundUrl={team?.background_url ?? null}
      />

      <div className="mx-auto w-full max-w-6xl px-4 pb-32 sm:px-6 lg:px-8">
        {portfolio.length > 0 && <PortfolioGallery items={portfolio} />}
        <ServicesSection services={services} />
        {products.length > 0 && <ProductsSection products={products} />}

        <footer className="pt-10 text-center text-xs text-muted-foreground">
          Agende com segurança · Minha Agenda
        </footer>
      </div>

      {/* CTA sticky */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20">
        <div className="pointer-events-auto bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-4 pt-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-xl">
            <Button
              size="lg"
              className="w-full shadow-xl"
              disabled={bookingDisabled}
              onClick={() => setBookingProSlug(profile.slug)}
            >
              <CalendarCheck className="h-5 w-5" />
              {bookingDisabled
                ? settings?.online_booking_enabled
                  ? 'Sem horários disponíveis'
                  : 'Agendamento indisponível'
                : 'Agendar horário'}
            </Button>
          </div>
        </div>
      </div>

      <BookingPortal
        data={bookingProQuery.data ?? null}
        members={bookingMembers}
        onPickPro={(nextSlug) => setBookingProSlug(nextSlug)}
        onClose={() => {
          setBookingProSlug(null)
          void refetch()
        }}
      />
    </PublicShell>
  )
}

/**
 * Wrapper fino do BookingFlow que só monta quando os dados do pro
 * alvo estão prontos. Previne flash de modal vazio enquanto o
 * `usePublicProfessional` busca o pro escolhido (seja o owner no
 * primeiro open, seja outro membro quando o visitante troca no
 * passo `professional`).
 */
function BookingPortal({
  data,
  members,
  onPickPro,
  onClose,
}: {
  data: Awaited<ReturnType<typeof getPublicProfessional>> | null
  members?: BookingProChoice[]
  onPickPro?: (slug: string) => void
  onClose: () => void
}) {
  if (!data) return null
  return (
    <BookingFlow
      open
      onClose={onClose}
      slug={data.profile.slug}
      professionalName={data.profile.name}
      services={data.services}
      settings={data.settings}
      members={members}
      onPickPro={onPickPro}
    />
  )
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>
}

/* ============================================================
 * HERO
 * ============================================================ */

interface HeroProps {
  avatarUrl: string | null
  name: string
  bio: string | null
  city: string | null
  phone: string | null
  backgroundUrl: string | null
}

function Hero({ avatarUrl, name, bio, city, phone, backgroundUrl }: HeroProps) {
  const phoneValid = !!phone && isValidPhoneBR(phone)

  return (
    <header className="relative overflow-hidden">
      {/* Faixa de fundo: imagem do time quando configurada, senão gradient. */}
      {backgroundUrl ? (
        <div
          className="absolute inset-x-0 top-0 h-64 overflow-hidden sm:h-72 lg:h-80"
          aria-hidden="true"
        >
          <img
            src={backgroundUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/60 to-background" />
        </div>
      ) : (
        <div
          className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent sm:h-72 lg:h-80"
          aria-hidden="true"
        />
      )}

      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 pt-12 pb-8 text-center sm:px-6 sm:pt-16 lg:px-8 lg:pt-20 lg:pb-10">
        <Avatar url={avatarUrl} name={name} />
        <h1 className="mt-6 break-words text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
          {name}
        </h1>
        {city && (
          <p className="mt-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {city}
          </p>
        )}
        {bio && (
          <p className="mt-5 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground lg:text-lg">
            {bio}
          </p>
        )}
        {phoneValid && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={telLink(phone!)} aria-label={`Ligar para ${name}`}>
                <Phone className="h-4 w-4" />
                {formatPhoneBR(phone!)}
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a
                href={waLinkBR(phone!, `Olá, ${name}! Vim pela sua página de agendamentos.`)}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

  if (url) {
    return (
      <div className="relative">
        <img
          src={url}
          alt={`Foto de ${name}`}
          className="h-28 w-28 rounded-full border-4 border-background bg-muted object-cover shadow-xl sm:h-36 sm:w-36 lg:h-40 lg:w-40"
          loading="eager"
        />
      </div>
    )
  }
  return (
    <div
      className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-background bg-primary/10 text-3xl font-semibold text-primary shadow-xl sm:h-36 sm:w-36 sm:text-4xl lg:h-40 lg:w-40 lg:text-5xl"
      aria-hidden="true"
    >
      {initials || '?'}
    </div>
  )
}

/* ============================================================
 * PORTFÓLIO
 * ============================================================ */

function PortfolioGallery({ items }: { items: PortfolioItem[] }) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section aria-labelledby="portfolio-heading" className="py-10 lg:py-14">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2
            id="portfolio-heading"
            className="text-2xl font-semibold tracking-tight lg:text-3xl"
          >
            Trabalhos
          </h2>
          <p className="text-sm text-muted-foreground">
            Alguns resultados recentes.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? 'foto' : 'fotos'}
        </span>
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {items.map((item, idx) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => setOpen(idx)}
              className="group relative block aspect-square w-full overflow-hidden rounded-xl border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={item.title ?? `Trabalho ${idx + 1}`}
            >
              <img
                src={item.image_url}
                alt={item.title ?? ''}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
              {item.title && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-left">
                  <p className="truncate text-sm font-medium text-white">
                    {item.title}
                  </p>
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>

      <Lightbox
        items={items}
        openIndex={open}
        onClose={() => setOpen(null)}
      />
    </section>
  )
}

interface LightboxProps {
  items: PortfolioItem[]
  openIndex: number | null
  onClose: () => void
}

function Lightbox({ items, openIndex, onClose }: LightboxProps) {
  if (openIndex === null) return null
  const item = items[openIndex]
  if (!item) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={item.title ?? 'Imagem em destaque'}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white backdrop-blur hover:bg-white/20"
        aria-label="Fechar"
      >
        <X className="h-5 w-5" />
      </button>

      <figure
        className="max-h-full max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={item.image_url}
          alt={item.title ?? ''}
          className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
        />
        {(item.title || item.description) && (
          <figcaption className="mt-3 text-center text-sm text-white/90">
            {item.title && <p className="font-medium">{item.title}</p>}
            {item.description && (
              <p className="mt-1 text-white/70">{item.description}</p>
            )}
          </figcaption>
        )}
      </figure>
    </div>
  )
}

/* ============================================================
 * SERVIÇOS
 * ============================================================ */

function ServicesSection({ services }: { services: Service[] }) {
  return (
    <section aria-labelledby="services-heading" className="py-10 lg:py-14">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2
            id="services-heading"
            className="text-2xl font-semibold tracking-tight lg:text-3xl"
          >
            Serviços
          </h2>
          <p className="text-sm text-muted-foreground">
            Escolha o que você precisa.
          </p>
        </div>
        {services.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {services.length} disponíveis
          </span>
        )}
      </div>

      {services.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
          <Scissors className="mb-2 h-6 w-6" aria-hidden="true" />
          Nenhum serviço disponível no momento.
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {services.map((svc) => (
            <li key={svc.id}>
              <ServiceCard service={svc} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ServiceCard({ service }: { service: Service }) {
  const Icon = getIcon(service.icon)
  const showThumb = !!service.image_url || !!Icon

  return (
    <div className="flex h-full items-start gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40">
      {showThumb && (
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
          {service.image_url ? (
            <img
              src={service.image_url}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : Icon ? (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-tight break-words">{service.name}</p>
        {service.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {service.description}
          </p>
        )}
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {formatMinutesDuration(service.duration_minutes)}
        </p>
      </div>
      <p className="shrink-0 text-right text-base font-semibold">
        {formatCurrencyBRL(service.price_cents)}
      </p>
    </div>
  )
}

/* ============================================================
 * PRODUTOS
 * ============================================================ */

function ProductsSection({ products }: { products: Product[] }) {
  return (
    <section aria-labelledby="products-heading" className="py-10 lg:py-14">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2
            id="products-heading"
            className="text-2xl font-semibold tracking-tight lg:text-3xl"
          >
            Produtos
          </h2>
          <p className="text-sm text-muted-foreground">
            O que você pode levar junto.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {products.length} disponíveis
        </span>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProductCard({ product }: { product: Product }) {
  const outOfStock = product.stock === 0
  const Icon = getIcon(product.icon) ?? Package
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
      <div className="relative aspect-square bg-muted">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Icon className="h-7 w-7" aria-hidden="true" />
          </div>
        )}
        {outOfStock && (
          <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium backdrop-blur">
            Esgotado
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-snug">
          {product.name}
        </p>
        {product.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {product.description}
          </p>
        )}
        <p className="mt-1 text-base font-semibold">
          {formatCurrencyBRL(product.price_cents)}
        </p>
      </div>
    </div>
  )
}

/* ============================================================
 * ESTADOS
 * ============================================================ */

function LoadingState() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse space-y-10 px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-col items-center space-y-4">
        <div className="h-28 w-28 rounded-full bg-muted sm:h-36 sm:w-36 lg:h-40 lg:w-40" />
        <div className="h-8 w-64 rounded bg-muted" />
        <div className="h-3 w-32 rounded bg-muted" />
        <div className="h-4 w-96 max-w-full rounded bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="aspect-square rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  )
}

function NotFoundState({ slug }: { slug: string | undefined }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {slug ? (
          <>
            Nenhum profissional foi encontrado em{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">/p/{slug}</code>.
          </>
        ) : (
          'Link inválido.'
        )}
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/">Voltar</Link>
      </Button>
    </div>
  )
}
