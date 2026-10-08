import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  CalendarCheck,
  Clock,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Scissors,
  Users2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { usePublicProfessional } from '@/hooks/queries/usePublicProfessional'
import { useDocumentHead } from '@/hooks/useDocumentHead'
import { formatCurrencyBRL, formatMinutesDuration } from '@/lib/utils'
import { formatPhoneBR, isValidPhoneBR, telLink, waLinkBR } from '@/lib/phone'
import { getIcon } from '@/lib/icons'
import type { PortfolioItem, Product, Service } from '@/types/database'
import type { PublicTeamSummary } from '@/services/public-profile'
import { BookingFlow } from '@/pages/public/booking/BookingFlow'

export function ProfessionalPage() {
  const { slug } = useParams<{ slug: string }>()
  const [search] = useSearchParams()
  const { data, isLoading, isError, refetch } = usePublicProfessional(slug)
  const [bookingOpen, setBookingOpen] = useState(false)

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

  if (isLoading) {
    return <PublicShell><LoadingState /></PublicShell>
  }

  if (isError || !data) {
    return <PublicShell><NotFoundState slug={slug} /></PublicShell>
  }

  const { profile, team, services, settings, portfolio, products } = data
  const bookingDisabled =
    !settings?.online_booking_enabled || services.length === 0

  // Visita no slug do OWNER de uma equipe com múltiplos membros:
  // mostra o overview "escolha um profissional" em vez do booking
  // dele direto. Exceção: `?book=1` força o booking (usado quando
  // o próprio owner clica no card dele no overview).
  const isTeamOwnerLandingPage =
    !!team &&
    team.members.length > 1 &&
    team.owner_user_id === profile.user_id &&
    search.get('book') !== '1'

  if (isTeamOwnerLandingPage) {
    return (
      <PublicShell>
        <TeamOverview team={team!} portfolio={portfolio} />
      </PublicShell>
    )
  }

  const isInMultiTeam = !!team && team.members.length > 1

  return (
    <PublicShell>
      {isInMultiTeam && (
        <TeamBreadcrumb
          teamName={team!.name}
          ownerSlug={
            team!.members.find((m) => m.role === 'owner')?.slug ?? team!.slug
          }
        />
      )}

      <Hero
        avatarUrl={profile.avatar_url}
        name={profile.name}
        bio={profile.bio}
        city={profile.city}
        phone={profile.phone}
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
              onClick={() => setBookingOpen(true)}
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

      <BookingFlow
        open={bookingOpen}
        onClose={() => {
          setBookingOpen(false)
          // Após uma reserva, o próximo visitante não deve ver o mesmo
          // slot livre. Invalida cache local do profissional.
          void refetch()
        }}
        slug={profile.slug}
        professionalName={profile.name}
        services={services}
        settings={settings}
      />
    </PublicShell>
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
}

function Hero({ avatarUrl, name, bio, city, phone }: HeroProps) {
  const phoneValid = !!phone && isValidPhoneBR(phone)

  return (
    <header className="relative overflow-hidden">
      {/* Faixa de fundo decorativa — full-bleed */}
      <div
        className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent sm:h-72 lg:h-80"
        aria-hidden="true"
      />

      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 pt-12 pb-8 text-center sm:px-6 sm:pt-16 lg:px-8 lg:pt-20 lg:pb-10">
        <Avatar url={avatarUrl} name={name} />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
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
 * EQUIPE — overview "pick a professional"
 * ============================================================ */

function TeamBreadcrumb({ teamName, ownerSlug }: { teamName: string; ownerSlug: string }) {
  return (
    <div className="border-b bg-muted/40">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-xs text-muted-foreground sm:px-6 lg:px-8">
        <Users2 className="h-3.5 w-3.5" aria-hidden="true" />
        Faz parte da equipe{' '}
        <Link to={`/p/${ownerSlug}`} className="font-medium text-foreground hover:underline">
          {teamName}
        </Link>
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
        <Link to={`/p/${ownerSlug}`} className="hover:underline">
          Ver todos os profissionais
        </Link>
      </div>
    </div>
  )
}

interface TeamOverviewProps {
  team: PublicTeamSummary
  portfolio: PortfolioItem[]
}

function TeamOverview({ team, portfolio }: TeamOverviewProps) {
  return (
    <>
      <header className="relative overflow-hidden">
        <div
          className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent sm:h-72 lg:h-80"
          aria-hidden="true"
        />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 pt-12 pb-6 text-center sm:px-6 sm:pt-16 lg:px-8 lg:pt-20">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xl sm:h-24 sm:w-24"
            aria-hidden="true"
          >
            <Users2 className="h-10 w-10 sm:h-12 sm:w-12" />
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            {team.name}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            Escolha um profissional pra reservar.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
        {portfolio.length > 0 && <PortfolioGallery items={portfolio} />}

        <section className="pt-6 lg:pt-10">
          <h2 className="mb-5 text-2xl font-semibold tracking-tight lg:text-3xl">
            Profissionais
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {team.members.map((m) => {
              const isOwner = m.role === 'owner'
              const href = isOwner ? `/p/${m.slug}?book=1` : `/p/${m.slug}`
              return (
                <li key={m.user_id}>
                  <Link
                    to={href}
                    className="group flex h-full flex-col items-center rounded-xl border bg-background p-5 text-center transition-colors hover:border-primary/40 hover:bg-accent/40"
                  >
                    <ProAvatar name={m.name} url={m.avatar_url} />
                    <div className="mt-3 flex items-center gap-2">
                      <h3 className="font-medium">{m.name}</h3>
                      {isOwner && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          Dono
                        </span>
                      )}
                    </div>
                    {m.city && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" aria-hidden="true" />
                        {m.city}
                      </p>
                    )}
                    {m.bio && (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        {m.bio}
                      </p>
                    )}
                    <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                      Reservar com {m.name.split(' ')[0]}
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>

        <footer className="pt-10 text-center text-xs text-muted-foreground">
          Agende com segurança · Minha Agenda
        </footer>
      </div>
    </>
  )
}

function ProAvatar({ name, url }: { name: string; url: string | null }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-16 w-16 rounded-full border bg-muted object-cover"
        loading="lazy"
      />
    )
  }
  return (
    <div
      className="flex h-16 w-16 items-center justify-center rounded-full border bg-primary/10 text-lg font-semibold text-primary"
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
        <p className="font-medium leading-tight">{service.name}</p>
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
