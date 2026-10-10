import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Check,
  Clock,
  Info,
  Loader2,
  Minus,
  Plus,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn, formatCurrencyBRL } from '@/lib/utils'
import { usePublicPlans } from '@/hooks/queries/usePublicPlans'
import { useMyPlan } from '@/hooks/queries/useMyPermissions'
import { usePermissionCatalog } from '@/hooks/queries/usePermissionCatalog'
import { useAuth } from '@/hooks/useAuth'
import type { Plan } from '@/types/admin'

/**
 * Landing pública (/) para visitantes não autenticados.
 * Direção: editorial-minimalista, monocromática em slate (alinhada ao
 * design system do app). Display em Instrument Serif, body em Inter,
 * meta/eyebrows em JetBrains Mono.
 */
export function LandingPage() {
  return (
    <div className="relative min-h-screen bg-background text-foreground antialiased">
      <TopBanner />
      <SiteHeader />
      <main>
        <Hero />
        <Manifesto />
        <Features />
        <Showcase />
        <Process />
        <Audience />
        <Pricing />
        <Testimonial />
        <Faq />
        <Finale />
      </main>
      <SiteFooter />
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Barra superior — "newspaper masthead"                            */
/* ──────────────────────────────────────────────────────────────── */

function TopBanner() {
  return (
    <div className="border-b border-border/70 bg-background">
      <div className="mx-auto flex h-9 max-w-[1200px] items-center justify-between gap-6 px-6 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        <span className="truncate">
          Agendamento online para profissionais autônomos
        </span>
        <div className="hidden items-center gap-6 sm:flex">
          <span>Brasil · pt-BR</span>
          <span className="hidden md:inline">Feito à mão</span>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Header                                                            */
/* ──────────────────────────────────────────────────────────────── */

function SiteHeader() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 10)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const links = [
    { href: '#recursos', label: 'Recursos' },
    { href: '#como-funciona', label: 'Processo' },
    { href: '#para-quem', label: 'Para quem' },
    { href: '#planos', label: 'Planos' },
  ]

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b transition-all duration-300',
        scrolled
          ? 'border-border/80 bg-background/90 backdrop-blur-md'
          : 'border-transparent bg-background',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2.5 group">
          <Wordmark />
          <span className="text-[15px] font-medium tracking-tight">
            Minha Agenda
          </span>
        </Link>

        <nav className="hidden items-center gap-10 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[13px] text-foreground/80 transition-colors hover:text-foreground link-underline"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            to="/login"
            className="text-[13px] text-foreground/80 transition-colors hover:text-foreground link-underline"
          >
            Entrar
          </Link>
          <Button
            asChild
            size="sm"
            className="h-9 rounded-full px-4 text-[13px] font-medium"
          >
            <Link to="/signup">
              Criar conta
              <ArrowRight className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
            </Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Alternar menu"
          aria-expanded={open}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border md:hidden"
        >
          {open ? (
            <Minus className="h-4 w-4" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/80 bg-background md:hidden">
          <nav className="mx-auto flex max-w-[1200px] flex-col gap-1 px-6 py-5">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="py-2 text-sm"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-border/80 pt-4">
              <Button asChild variant="outline" className="w-full rounded-full">
                <Link to="/login" onClick={() => setOpen(false)}>
                  Entrar
                </Link>
              </Button>
              <Button asChild className="w-full rounded-full">
                <Link to="/signup" onClick={() => setOpen(false)}>
                  Criar conta
                </Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}

function Wordmark() {
  return (
    <span
      aria-hidden
      className="relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-[9px] bg-foreground text-background"
    >
      <span className="font-serif text-[18px] leading-none">M</span>
      <span className="absolute inset-y-1 right-1 w-px bg-background/30" />
    </span>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Hero — editorial, asymmetric 7/5                                  */
/* ──────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="grain relative overflow-hidden border-b border-border/70">
      {/* Vinhetas sutis — nada de blob colorido */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--muted))_0%,transparent_60%)] opacity-70"
      />
      <div className="relative mx-auto max-w-[1200px] px-6 pb-20 pt-16 sm:pt-24 lg:pb-28 lg:pt-28">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-7">
            <Eyebrow>Agendamento Online · pt-BR</Eyebrow>

            <h1
              className="rise mt-8 font-serif text-[clamp(2.75rem,7.5vw,6rem)] font-normal leading-[1.05] text-foreground text-balance"
              style={{ animationDelay: '60ms' }}
            >
              A sua agenda,
              <br />
              em um{' '}
              <span className="italic text-foreground/70">único</span> link.
            </h1>

            <p
              className="rise mt-8 max-w-[46ch] text-[15px] leading-[1.7] text-muted-foreground"
              style={{ animationDelay: '220ms' }}
            >
              Compartilhe{' '}
              <span className="font-medium text-foreground">
                minha-agenda.app/p/seu-nome
              </span>{' '}
              e deixe clientes marcarem horário em segundos. Sem apps, sem
              cadastro, sem bagunça no WhatsApp. Você só confirma.
            </p>

            <div
              className="rise mt-10 flex flex-wrap items-center gap-x-5 gap-y-3"
              style={{ animationDelay: '380ms' }}
            >
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full px-6 text-[14px]"
              >
                <Link to="/signup">
                  Começar grátis
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <a
                href="#como-funciona"
                className="group inline-flex items-center gap-2 text-[14px] font-medium text-foreground"
              >
                <span className="link-underline">Ver como funciona</span>
                <ArrowUpRight
                  className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </a>
            </div>

            <div
              className="rise mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-border/70 pt-8"
              style={{ animationDelay: '540ms' }}
            >
              <MetricInline value="2 min" label="setup médio" />
              <MetricInline value="0" label="conflitos de horário" />
              <MetricInline value="R$ 0" label="para começar" />
            </div>
          </div>

          <div className="lg:col-span-5 lg:pl-6">
            <div
              className="rise relative"
              style={{ animationDelay: '280ms' }}
            >
              <HeroCard />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px w-6 bg-foreground/40" aria-hidden />
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {children}
      </span>
    </div>
  )
}

function MetricInline({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-serif text-3xl leading-none">
        {value}
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

/* Mock editorial da página pública /p/:slug — strict mono palette */
function HeroCard() {
  return (
    <div className="relative">
      {/* Marker tipográfico atrás do card, estilo revista */}
      <div
        aria-hidden
        className="absolute -left-6 -top-10 select-none font-serif text-[7rem] leading-none text-foreground/5 sm:text-[9rem]"
      >
        /p/
      </div>

      <div className="relative overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_30px_80px_-30px_rgba(15,23,42,0.25)]">
        {/* Chrome do navegador */}
        <div className="flex items-center gap-2 border-b border-border/80 bg-muted/40 px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
          </div>
          <div className="ml-2 flex-1 truncate rounded-[6px] bg-background px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground">
            minha-agenda.app/p/ana-silva
          </div>
        </div>

        {/* Conteúdo */}
        <div className="p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-foreground text-background ring-1 ring-border">
              <div className="flex h-full w-full items-center justify-center font-serif text-xl">
                A
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-serif text-xl leading-snug">
                Ana Silva
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Nail Designer — São Paulo
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-border/70 pt-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Serviços
            </div>
            <div className="mt-3 divide-y divide-border/60">
              <HeroService name="Manicure completa" dur="45 min" price="R$ 60" />
              <HeroService name="Alongamento em gel" dur="2h" price="R$ 180" />
              <HeroService
                name="Esmaltação em gel"
                dur="1h"
                price="R$ 90"
              />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between rounded-[10px] bg-foreground px-4 py-3 text-background">
            <div className="flex items-center gap-2.5">
              <Calendar className="h-4 w-4" aria-hidden strokeWidth={1.8} />
              <span className="text-[13px] font-medium">Agendar horário</span>
            </div>
            <ArrowRight className="h-4 w-4" aria-hidden strokeWidth={1.8} />
          </div>
        </div>
      </div>

      {/* Pill informativa — minúscula, hairline */}
      <div className="absolute -bottom-4 right-6 hidden items-center gap-2 border border-border bg-background px-3 py-2 shadow-sm sm:flex">
        <Check
          className="h-3.5 w-3.5 text-foreground"
          aria-hidden
          strokeWidth={2}
        />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em]">
          Reservado · 14:30
        </span>
      </div>
    </div>
  )
}

function HeroService({
  name,
  dur,
  price,
}: {
  name: string
  dur: string
  price: string
}) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium">{name}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {dur}
        </div>
      </div>
      <div className="font-serif text-[18px]">{price}</div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Manifesto — faixa de alto contraste tipográfica                   */
/* ──────────────────────────────────────────────────────────────── */

function Manifesto() {
  return (
    <section className="border-b border-border/70">
      <div className="mx-auto max-w-[1200px] px-6 py-20 sm:py-24">
        <div className="grid gap-10 md:grid-cols-12 md:items-end">
          <div className="md:col-span-7">
            <Eyebrow>Manifesto</Eyebrow>
            <p className="mt-6 font-serif text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.25] text-foreground text-balance">
              Você vende tempo.
              <br />
              <span className="italic text-muted-foreground">
                Então sua ferramenta de agendamento{' '}
              </span>
              não deveria custá-lo.
            </p>
          </div>
          <div className="md:col-span-5">
            <p className="text-[14.5px] leading-[1.8] text-muted-foreground">
              Minha Agenda é construída em cima de uma ideia simples: o
              profissional cuida do atendimento, o software cuida do resto.
              Reservas sem conta, sem conflito, sem WhatsApp às cegas — para
              que a sua agenda deixe de ser um problema todo começo de
              semana.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Features — bento assimétrico, numerado                           */
/* ──────────────────────────────────────────────────────────────── */

function Features() {
  return (
    <section id="recursos" className="border-b border-border/70">
      <div className="mx-auto max-w-[1200px] px-6 py-24 sm:py-28">
        <SectionHead
          eyebrow="Recursos"
          title={
            <>
              Essencial, nada supérfluo.
              <br />
              <span className="italic text-muted-foreground">
                Tudo integrado.
              </span>
            </>
          }
        />

        <div className="mt-16 grid grid-cols-1 gap-px bg-border/70 md:grid-cols-6">
          <FeatureCell
            kicker="Distribuição"
            title="Link personalizado"
            desc="Compartilhe sua página pública no Instagram, WhatsApp ou cartão. Clientes agendam direto do navegador."
            className="md:col-span-4"
            featured
          />
          <FeatureCell
            kicker="Integridade"
            title="Zero conflito"
            desc="Validação no banco impede dois agendamentos no mesmo horário — mesmo em cliques simultâneos."
            className="md:col-span-2"
          />
          <FeatureCell
            kicker="Reserva"
            title="Multi-serviço"
            desc="O cliente escolhe uma combinação (corte + barba) e a duração é somada automaticamente."
            className="md:col-span-2"
          />
          <FeatureCell
            kicker="Vitrine"
            title="Portfólio integrado"
            desc="Galeria com upload direto, sem terceiros. Seu melhor trabalho na mesma página do agendamento."
            className="md:col-span-2"
          />
          <FeatureCell
            kicker="Comércio"
            title="Produtos à venda"
            desc="Divulgue produtos com imagem, preço e controle de estoque, no mesmo lugar."
            className="md:col-span-2"
          />
          <FeatureCell
            kicker="Autonomia"
            title="Cancelamento sem fricção"
            desc="Cada reserva gera um link único. O cliente cancela sozinho, dentro das regras que você define."
            className="md:col-span-6"
          />
        </div>
      </div>
    </section>
  )
}

function FeatureCell({
  kicker,
  title,
  desc,
  className,
  featured,
}: {
  kicker: string
  title: string
  desc: string
  className?: string
  featured?: boolean
}) {
  return (
    <article
      className={cn(
        'group relative flex flex-col justify-between gap-10 bg-background p-8 transition-colors hover:bg-muted/40 sm:p-10',
        featured && 'sm:min-h-[340px]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {kicker}
        </span>
        <ArrowUpRight
          className="h-4 w-4 text-muted-foreground/40 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
          aria-hidden
          strokeWidth={1.8}
        />
      </div>
      <div>
        <h3
          className={cn(
            'font-serif leading-snug text-foreground text-balance',
            featured ? 'text-[clamp(1.75rem,3vw,2.5rem)]' : 'text-2xl',
          )}
        >
          {title}
        </h3>
        <p
          className={cn(
            'mt-3 max-w-[52ch] text-[13.5px] leading-[1.7] text-muted-foreground',
            featured && 'text-[14.5px]',
          )}
        >
          {desc}
        </p>
      </div>
    </article>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Showcase — dark editorial                                         */
/* ──────────────────────────────────────────────────────────────── */

function Showcase() {
  return (
    <section className="grain grain-dark relative overflow-hidden border-b border-slate-900 bg-slate-950 text-slate-100">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06)_0%,transparent_55%)]"
      />
      <div className="relative mx-auto max-w-[1200px] px-6 py-24 sm:py-28">
        <div className="grid gap-14 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-3">
              <span className="h-px w-6 bg-slate-500" aria-hidden />
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Painel
              </span>
            </div>
            <h2 className="mt-6 font-serif text-[clamp(2.25rem,4.5vw,3.5rem)] leading-[1.15] text-balance">
              Seu dia inteiro,
              <br />
              <span className="italic text-slate-400">
                em um painel só.
              </span>
            </h2>
            <p className="mt-6 max-w-md text-[14.5px] leading-[1.75] text-slate-300">
              Agendamentos de hoje, próximos sete dias, faturamento previsto e
              base de clientes — assim que você abre o app. Sem passar por
              dez telas para entender como está sua semana.
            </p>
            <ul className="mt-10 space-y-4 border-l border-slate-800 pl-5">
              {[
                'Confirme, conclua ou cancele em dois cliques',
                'Encaixe horários manualmente, fora do expediente',
                'Histórico completo por cliente',
                'Observações privadas que só você vê',
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 text-[13.5px] text-slate-200"
                >
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-7">
            <DashboardMock />
          </div>
        </div>
      </div>
    </section>
  )
}

function DashboardMock() {
  return (
    <div className="relative">
      <div className="overflow-hidden rounded-[14px] border border-slate-800 bg-slate-900/60 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] backdrop-blur">
        {/* top chrome */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 rounded-[7px] bg-slate-800 ring-1 ring-slate-700" />
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-slate-400">
              Minha Agenda · Dashboard
            </span>
          </div>
          <span className="font-mono text-[10.5px] text-slate-500">
            sex, 04 out
          </span>
        </div>

        <div className="p-6 sm:p-7">
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                Boa tarde,
              </div>
              <div className="mt-1 font-serif text-3xl leading-snug">
                Ana.
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-slate-300">
                Online
              </span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] bg-slate-800 lg:grid-cols-4">
            <DarkStat label="Hoje" value="06" sub="agendamentos" />
            <DarkStat label="7 dias" value="18" sub="próximos" />
            <DarkStat label="Receita" value="R$ 2.4k" sub="prevista" />
            <DarkStat label="Clientes" value="142" sub="cadastrados" />
          </div>

          <div className="mt-6 rounded-[12px] border border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-slate-400">
                Próximos horários
              </span>
              <span className="font-mono text-[10.5px] text-slate-500">
                03 de 06
              </span>
            </div>
            <div className="divide-y divide-slate-800">
              {[
                {
                  time: '14:30',
                  client: 'Carla Mendes',
                  service: 'Manicure + Esmaltação',
                },
                {
                  time: '15:30',
                  client: 'João Pereira',
                  service: 'Corte + Barba',
                },
                {
                  time: '17:00',
                  client: 'Patrícia R.',
                  service: 'Alongamento em gel',
                },
              ].map((a) => (
                <div
                  key={a.time}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="font-mono text-[12px] font-medium text-slate-100">
                      {a.time}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium">
                        {a.client}
                      </div>
                      <div className="truncate text-[11.5px] text-slate-400">
                        {a.service}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
                    Confirmado
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DarkStat({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="bg-slate-900 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 font-serif text-[32px] leading-none">
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-slate-500">{sub}</div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Process — tabela editorial 01/02/03                              */
/* ──────────────────────────────────────────────────────────────── */

function Process() {
  const steps = [
    {
      kicker: 'Primeiro',
      title: 'Crie sua conta',
      desc: 'Em menos de 2 minutos. Escolha seu link, foto e uma bio curta.',
      time: '2 min',
    },
    {
      kicker: 'Depois',
      title: 'Cadastre serviços e horários',
      desc: 'Nome, duração, preço. Defina sua disponibilidade por dia da semana.',
      time: '5 min',
    },
    {
      kicker: 'Enfim',
      title: 'Compartilhe seu link',
      desc: 'Cole no Instagram, WhatsApp, cartão. Clientes agendam, você confirma.',
      time: 'sem fim',
    },
  ]
  return (
    <section
      id="como-funciona"
      className="border-b border-border/70 bg-muted/40"
    >
      <div className="mx-auto max-w-[1200px] px-6 py-24 sm:py-28">
        <SectionHead
          eyebrow="Processo"
          title={
            <>
              Três passos.{' '}
              <span className="italic text-muted-foreground">
                Nenhum superior a 5 minutos.
              </span>
            </>
          }
        />

        <div className="mt-16 overflow-hidden rounded-[14px] border border-border bg-background">
          {steps.map((s, i) => (
            <div
              key={s.kicker}
              className={cn(
                'group grid grid-cols-[auto_1fr_auto] items-start gap-6 px-6 py-8 transition-colors hover:bg-muted/40 sm:grid-cols-[140px_1fr_120px] sm:px-10 sm:py-10',
                i < steps.length - 1 && 'border-b border-border/70',
              )}
            >
              <span className="whitespace-nowrap pt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {s.kicker}
              </span>
              <div>
                <h3 className="font-serif text-[1.75rem] leading-snug sm:text-[2rem]">
                  {s.title}
                </h3>
                <p className="mt-2 max-w-[52ch] text-[14px] leading-[1.7] text-muted-foreground">
                  {s.desc}
                </p>
              </div>
              <div className="flex items-center gap-2 justify-self-end whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <Clock className="h-3.5 w-3.5" aria-hidden strokeWidth={1.6} />
                {s.time}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Audience — composição editorial com lista                        */
/* ──────────────────────────────────────────────────────────────── */

function Audience() {
  const list = [
    'Barbearias',
    'Salões de beleza',
    'Nail designers',
    'Esteticistas',
    'Tatuadores',
    'Personal trainers',
    'Massoterapeutas',
    'Studios de pilates',
  ]
  return (
    <section id="para-quem" className="border-b border-border/70">
      <div className="mx-auto max-w-[1200px] px-6 py-24 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-5">
            <SectionHead
              eyebrow="Para quem"
              align="left"
              title={
                <>
                  Para quem{' '}
                  <span className="italic text-muted-foreground">
                    atende por horário.
                  </span>
                </>
              }
            />
            <p className="mt-6 max-w-md text-[14.5px] leading-[1.7] text-muted-foreground">
              Se você vende tempo e precisa parar de perder horário
              remarcando no WhatsApp, a Minha Agenda foi desenhada
              exatamente para o seu caso.
            </p>
          </div>

          <ul className="lg:col-span-7">
            {list.map((item) => (
              <li
                key={item}
                className="group grid grid-cols-[1fr_auto] items-center gap-6 border-t border-border/70 py-5 transition-colors hover:bg-muted/40 last:border-b"
              >
                <span className="font-serif text-[1.5rem] leading-snug sm:text-[1.75rem]">
                  {item}
                </span>
                <ArrowUpRight
                  className="h-4 w-4 text-muted-foreground/40 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
                  aria-hidden
                  strokeWidth={1.6}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Pricing — planos lidos do banco                                   */
/* ──────────────────────────────────────────────────────────────── */

function Pricing() {
  const { data: plans, isLoading } = usePublicPlans()
  const { data: catalog } = usePermissionCatalog()
  const { data: myPlan } = useMyPlan()
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')

  // Nome amigável de cada permissão. Fallback: o próprio código.
  const permissionNameByCode = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of catalog ?? []) map.set(entry.code, entry.name)
    return map
  }, [catalog])

  // Trava anti-duplicata (mesma lógica da SubscriptionPage): se já há
  // assinatura paga ativa e não expirada, bloqueia qualquer "Assinar"
  // novo direto da landing. `cancelled`/`past_due` liberam de novo —
  // é o caminho de retomar/renovar manualmente.
  const expiresAt = myPlan?.expires_at ? new Date(myPlan.expires_at) : null
  const hasActivePaidSub =
    myPlan?.subscription_status === 'active' &&
    myPlan?.plan_code !== null &&
    myPlan?.plan_code !== 'free' &&
    expiresAt !== null &&
    expiresAt > new Date()

  // Toggle só aparece se pelo menos um plano oferece anual.
  const hasYearlyOption = plans?.some((p) => p.price_yearly_cents != null) ?? false

  return (
    <section id="planos" className="border-b border-border/70">
      <div className="mx-auto max-w-[1200px] px-6 py-24 sm:py-28">
        <SectionHead
          eyebrow="Planos"
          align="center"
          title={
            <>
              Comece de graça.{' '}
              <span className="italic text-muted-foreground">
                Suba de plano quando crescer.
              </span>
            </>
          }
        />

        {hasActivePaidSub && expiresAt && (
          <div
            role="status"
            className="mx-auto mt-10 flex max-w-2xl items-start gap-3 rounded-[10px] border border-border bg-muted/40 px-4 py-3 text-[13px]"
          >
            <Info
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-foreground"
              aria-hidden="true"
            />
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">
                Você já tem uma assinatura ativa.
              </p>
              <p className="text-muted-foreground">
                Novas assinaturas serão liberadas após{' '}
                <span className="font-medium text-foreground">
                  {formatDateBR(expiresAt.toISOString())}
                </span>
                . Para gerenciar seu plano, acesse{' '}
                <Link
                  to="/dashboard/configuracoes/assinatura"
                  className="font-medium text-foreground link-underline"
                >
                  minha assinatura
                </Link>
                .
              </p>
            </div>
          </div>
        )}

        {hasYearlyOption && (
          <div className="mt-10 flex justify-center">
            <IntervalToggle value={interval} onChange={setInterval} />
          </div>
        )}

        <div className="mt-14">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando planos…
            </div>
          ) : !plans || plans.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum plano disponível no momento.
            </p>
          ) : (
            <div
              className={cn(
                'mx-auto grid gap-6',
                plans.length === 1 && 'max-w-md',
                plans.length === 2 && 'max-w-3xl md:grid-cols-2',
                plans.length >= 3 && 'max-w-5xl md:grid-cols-3',
              )}
            >
              {plans.map((plan, i) => (
                <PricingCard
                  key={plan.id}
                  plan={plan}
                  featured={plans.length > 1 && i === plans.length - 1}
                  interval={interval}
                  isCurrent={myPlan?.plan_code === plan.code}
                  lockedUntilExpire={hasActivePaidSub}
                  permissionName={(code) =>
                    permissionNameByCode.get(code) ?? code
                  }
                />
              ))}
            </div>
          )}
        </div>

        <p className="mx-auto mt-10 max-w-md text-center text-[12px] text-muted-foreground">
          Pague com Pix, cartão ou boleto. Renova {interval === 'yearly' ? 'anualmente' : 'mensalmente'} — você paga de novo quando o período acabar.
        </p>
      </div>
    </section>
  )
}

interface PricingCardProps {
  plan: Plan
  featured: boolean
  /** Intervalo selecionado no toggle da seção. */
  interval: 'monthly' | 'yearly'
  /** Plano que o usuário logado assina hoje (match por `code`). */
  isCurrent: boolean
  /** Já existe assinatura paga vigente — bloqueia novo "Assinar". */
  lockedUntilExpire: boolean
  permissionName: (code: string) => string
}

function PricingCard({
  plan,
  featured,
  interval,
  isCurrent,
  lockedUntilExpire,
  permissionName,
}: PricingCardProps) {
  const { session } = useAuth()
  const isFree = plan.price_cents === 0
  const benefits = Array.isArray(plan.features) ? (plan.features as string[]) : []
  const permissions = plan.permissions ?? []
  const isLoggedIn = !!session

  // Para o plano grátis: logado → dashboard; visitante → signup
  // simples (sem query param, cai direto no plano free via trigger).
  const signupHref = '/signup'

  // Só mostramos preço anual se o plano oferece E o toggle tá nessa opção.
  const showYearly =
    interval === 'yearly' && plan.price_yearly_cents != null && plan.price_yearly_cents > 0
  const discountPct = showYearly
    ? Math.round(
        ((plan.price_cents * 12 - (plan.price_yearly_cents ?? 0)) /
          (plan.price_cents * 12)) *
          100,
      )
    : 0

  // CTA de pago passa ?interval=yearly quando aplicável. Pra visitante
  // (signup), passa plan+interval em query. Pra logado, direto no checkout.
  const checkoutQuery = showYearly ? '?interval=yearly' : ''
  const signupQuery = showYearly ? `?plan=${plan.code}&interval=yearly` : `?plan=${plan.code}`

  return (
    <article
      className={cn(
        'relative flex h-full flex-col gap-6 rounded-[14px] border p-7 transition-colors',
        featured
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background hover:bg-muted/40',
      )}
    >
      {featured && (
        <span
          className={cn(
            'absolute -top-2.5 left-7 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]',
            'bg-background text-foreground',
          )}
        >
          Recomendado
        </span>
      )}
      {showYearly && discountPct > 0 && (
        <span className="absolute -top-2.5 right-7 rounded-full bg-emerald-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white">
          -{discountPct}%
        </span>
      )}

      <header className="space-y-1">
        <div
          className={cn(
            'font-mono text-[11px] uppercase tracking-[0.18em]',
            featured ? 'text-background/60' : 'text-muted-foreground',
          )}
        >
          {plan.code}
        </div>
        <h3 className="font-serif text-[1.75rem] leading-snug">
          {plan.name}
        </h3>
        {plan.description && (
          <p
            className={cn(
              'text-[13px] leading-relaxed',
              featured ? 'text-background/70' : 'text-muted-foreground',
            )}
          >
            {plan.description}
          </p>
        )}
      </header>

      <div className="space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[2.75rem] leading-none">
            {isFree
              ? 'R$ 0'
              : showYearly
                ? formatCurrencyBRL((plan.price_yearly_cents ?? 0) / 12)
                : formatCurrencyBRL(plan.price_cents)}
          </span>
          <span
            className={cn(
              'font-mono text-[11px] uppercase tracking-[0.14em]',
              featured ? 'text-background/60' : 'text-muted-foreground',
            )}
          >
            /mês
          </span>
        </div>
        {showYearly && (
          <p
            className={cn(
              'text-[12px]',
              featured ? 'text-background/70' : 'text-muted-foreground',
            )}
          >
            Cobrado anualmente:{' '}
            <span
              className={cn(
                'font-medium',
                featured ? 'text-background' : 'text-foreground',
              )}
            >
              {formatCurrencyBRL(plan.price_yearly_cents ?? 0)}
            </span>
          </p>
        )}
      </div>

      {benefits.length > 0 && (
        <ul className="space-y-2 text-[13px]">
          {benefits.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <Check
                className={cn(
                  'mt-0.5 h-3.5 w-3.5 flex-shrink-0',
                  featured ? 'text-background' : 'text-foreground',
                )}
                aria-hidden="true"
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {permissions.length > 0 && (
        <div
          className={cn(
            'space-y-2 border-t pt-4',
            featured ? 'border-background/20' : 'border-border/70',
          )}
        >
          <div
            className={cn(
              'font-mono text-[10px] uppercase tracking-[0.14em]',
              featured ? 'text-background/60' : 'text-muted-foreground',
            )}
          >
            Inclui
          </div>
          <ul className="space-y-1 text-[12px]">
            {permissions.map((code) => (
              <li key={code} className="flex items-start gap-2">
                <span
                  className={cn(
                    'mt-1 h-1 w-1 flex-shrink-0 rounded-full',
                    featured ? 'bg-background/60' : 'bg-foreground/40',
                  )}
                  aria-hidden="true"
                />
                <span>{permissionName(code)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(plan.max_services !== null ||
        plan.max_appointments_per_month !== null) && (
        <div
          className={cn(
            'flex flex-wrap gap-x-4 gap-y-1 border-t pt-4 font-mono text-[10.5px] uppercase tracking-[0.14em]',
            featured
              ? 'border-background/20 text-background/60'
              : 'border-border/70 text-muted-foreground',
          )}
        >
          <span>
            {plan.max_services !== null
              ? `${plan.max_services} serviços`
              : 'serviços ilimitados'}
          </span>
          <span>
            {plan.max_appointments_per_month !== null
              ? `${plan.max_appointments_per_month} agendamentos/mês`
              : 'agendamentos ilimitados'}
          </span>
        </div>
      )}

      <div className="mt-auto space-y-2 pt-2">
        {isFree ? (
          <Button
            asChild
            className={cn(
              'h-11 w-full rounded-full',
              featured && 'bg-background text-foreground hover:bg-background/90',
            )}
          >
            <Link to={isLoggedIn ? '/dashboard' : signupHref}>
              {isLoggedIn ? 'Ir para o dashboard' : 'Começar grátis'}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        ) : isLoggedIn && isCurrent ? (
          // Já é o plano assinado: leva pra gerenciar em vez de
          // disparar um checkout duplicado.
          <Button
            asChild
            variant="outline"
            className={cn(
              'h-11 w-full rounded-full',
              featured &&
                'border-background/30 bg-transparent text-background hover:bg-background/10',
            )}
          >
            <Link to="/dashboard/configuracoes/assinatura">
              Você está neste plano
            </Link>
          </Button>
        ) : isLoggedIn && lockedUntilExpire ? (
          // Outro plano pago já está vigente — bloqueia pra não cobrar
          // duas vezes no mesmo período. Encaminha pra gestão.
          <Button
            asChild
            variant="outline"
            className={cn(
              'h-11 w-full rounded-full',
              featured &&
                'border-background/30 bg-transparent text-background hover:bg-background/10',
            )}
          >
            <Link to="/dashboard/configuracoes/assinatura">
              Assinatura ativa em outro plano
            </Link>
          </Button>
        ) : (
          <>
            {/* Pago:
                - logado   → `/checkout/:code` dispara direto.
                - visitante → `/signup?plan=:code` (signup PRIMEIRO,
                  faz mais sentido que forçar login). Quem já tem
                  conta usa o link "Já tem conta? Entrar" dentro do
                  signup, que preserva o redirectTo. */}
            <Button
              asChild
              className={cn(
                'h-11 w-full rounded-full',
                featured && 'bg-background text-foreground hover:bg-background/90',
              )}
            >
              <Link
                to={
                  isLoggedIn
                    ? `/checkout/${plan.code}${checkoutQuery}`
                    : `/signup${signupQuery}`
                }
              >
                {isLoggedIn
                  ? showYearly
                    ? 'Assinar anual'
                    : 'Assinar'
                  : showYearly
                    ? 'Criar conta e assinar (anual)'
                    : 'Criar conta e assinar'}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <p
              className={cn(
                'text-center text-[10.5px] font-mono uppercase tracking-[0.14em]',
                featured ? 'text-background/50' : 'text-muted-foreground',
              )}
            >
              Pix · cartão · boleto
            </p>
          </>
        )}
      </div>
    </article>
  )
}

function IntervalToggle({
  value,
  onChange,
}: {
  value: 'monthly' | 'yearly'
  onChange: (next: 'monthly' | 'yearly') => void
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-background p-0.5">
      <button
        type="button"
        onClick={() => onChange('monthly')}
        className={cn(
          'rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors',
          value === 'monthly'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Mensal
      </button>
      <button
        type="button"
        onClick={() => onChange('yearly')}
        className={cn(
          'rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors',
          value === 'yearly'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Anual
      </button>
    </div>
  )
}

function formatDateBR(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

/* ──────────────────────────────────────────────────────────────── */
/* Testimonial — pull-quote editorial                                */
/* ──────────────────────────────────────────────────────────────── */

function Testimonial() {
  return (
    <section className="border-b border-border/70 bg-muted/30">
      <div className="mx-auto max-w-[1200px] px-6 py-24 sm:py-28">
        <figure className="mx-auto max-w-4xl">
          <span className="block font-serif text-[8rem] leading-none text-foreground/15 sm:text-[10rem]">
            “
          </span>
          <blockquote className="-mt-10 font-serif text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.3] sm:-mt-14">
            Antes eu perdia uma hora por dia confirmando no WhatsApp.
            Coloquei o link no Instagram e os clientes passaram a marcar
            sozinhos.{' '}
            <span className="italic text-muted-foreground">
              Hoje eu só olho o painel.
            </span>
          </blockquote>
          <figcaption className="mt-10 flex items-center gap-4 border-t border-border/70 pt-6">
            <div className="h-11 w-11 overflow-hidden rounded-full bg-foreground text-background">
              <div className="flex h-full w-full items-center justify-center font-serif text-lg">
                C
              </div>
            </div>
            <div>
              <div className="text-[14px] font-medium">Carla Mendes</div>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Nail Designer · São Paulo
              </div>
            </div>
          </figcaption>
        </figure>
      </div>
    </section>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* FAQ — accordion simples (details nativo)                          */
/* ──────────────────────────────────────────────────────────────── */

function Faq() {
  const items = [
    {
      q: 'Preciso de cartão de crédito para começar?',
      a: 'Não. Você cria a conta, cadastra seus serviços e já pode receber agendamentos no plano gratuito, por tempo indeterminado.',
    },
    {
      q: 'Meus clientes precisam criar uma conta?',
      a: 'Não. Eles agendam direto pelo seu link, informando apenas nome e telefone. Cada reserva gera um link único de acompanhamento e cancelamento.',
    },
    {
      q: 'Como vocês evitam que dois clientes marquem o mesmo horário?',
      a: 'A verificação é feita diretamente no banco de dados (constraint de exclusão). Mesmo que dois cliques aconteçam no mesmo milissegundo, só um é aceito.',
    },
    {
      q: 'Posso bloquear horários ou encaixar fora do expediente?',
      a: 'Sim. Pelo painel você cria agendamentos manuais em qualquer horário, inclusive fora da janela padrão de atendimento.',
    },
    {
      q: 'E se meu cliente quiser cancelar?',
      a: 'Cada agendamento tem um link próprio. Dentro das regras que você define (prazo mínimo, cancelamento habilitado ou não), o próprio cliente cancela sem precisar falar com você.',
    },
  ]
  return (
    <section className="border-b border-border/70">
      <div className="mx-auto max-w-[1200px] px-6 py-24 sm:py-28">
        <div className="grid gap-14 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <SectionHead
              eyebrow="Perguntas"
              align="left"
              title={
                <>
                  Dúvidas{' '}
                  <span className="italic text-muted-foreground">
                    frequentes.
                  </span>
                </>
              }
            />
          </div>
          <div className="lg:col-span-8">
            <div className="border-t border-border/70">
              {items.map((it) => (
                <FaqItem key={it.q} q={it.q} a={it.a} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className="border-b border-border/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start justify-between gap-6 py-6 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="font-serif text-[1.25rem] leading-snug sm:text-[1.4rem]">
          {q}
        </span>
        <span
          className={cn(
            'mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border transition-transform motion-reduce:transition-none',
            open && 'rotate-45',
          )}
          aria-hidden="true"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="pb-6 pr-10"
      >
        <p className="max-w-[62ch] text-[14px] leading-[1.75] text-muted-foreground">
          {a}
        </p>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Finale — CTA dark, sóbrio                                         */
/* ──────────────────────────────────────────────────────────────── */

function Finale() {
  return (
    <section
      id="comecar"
      className="grain grain-dark relative overflow-hidden bg-slate-950 text-slate-100"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08)_0%,transparent_60%)]"
      />
      <div className="relative mx-auto max-w-[1200px] px-6 py-28 sm:py-36 text-center">
        <div className="flex items-center justify-center gap-3">
          <span className="h-px w-6 bg-slate-500" aria-hidden />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Começar
          </span>
          <span className="h-px w-6 bg-slate-500" aria-hidden />
        </div>

        <h2 className="mx-auto mt-8 max-w-4xl font-serif text-[clamp(2.5rem,6vw,5rem)] leading-[1.1] text-balance">
          Comece grátis hoje.{' '}
          <span className="italic text-slate-400">
            Suba de plano quando precisar.
          </span>
        </h2>

        <p className="mx-auto mt-8 max-w-xl text-[14.5px] leading-[1.75] text-slate-300">
          Sem cartão de crédito. Sem limite de tempo no plano gratuito.
          Você só paga quando quiser recursos avançados.
        </p>

        <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
          <Button
            asChild
            size="lg"
            className="h-12 rounded-full bg-white px-7 text-[14px] text-slate-950 hover:bg-slate-100"
          >
            <Link to="/signup">
              Criar minha conta
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Link
            to="/login"
            className="group inline-flex items-center gap-2 text-[14px] text-slate-300 hover:text-white"
          >
            <span className="link-underline">Já tenho conta</span>
            <ArrowUpRight
              className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </div>

        <div className="mt-20 grid grid-cols-2 gap-10 border-t border-slate-800 pt-10 text-left sm:grid-cols-4">
          {[
            ['Grátis', 'para começar'],
            ['Ilimitados', 'agendamentos'],
            ['Zero', 'cartão de crédito'],
            ['2 min', 'de setup'],
          ].map(([v, l]) => (
            <div key={l}>
              <div className="font-serif text-3xl leading-none">
                {v}
              </div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                {l}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Footer                                                            */
/* ──────────────────────────────────────────────────────────────── */

function SiteFooter() {
  return (
    <footer className="bg-background">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-16 sm:grid-cols-12">
        <div className="sm:col-span-5">
          <Link to="/" className="flex items-center gap-2.5">
            <Wordmark />
            <span className="text-[15px] font-medium tracking-tight">
              Minha Agenda
            </span>
          </Link>
          <p className="mt-5 max-w-xs text-[13px] leading-[1.7] text-muted-foreground">
            Agendamento online para quem vende tempo. Projetado no Brasil,
            sem bullshit.
          </p>
        </div>

        <div className="sm:col-span-3">
          <FooterTitle>Produto</FooterTitle>
          <ul className="mt-4 space-y-2.5 text-[13px]">
            <FooterLink href="#recursos">Recursos</FooterLink>
            <FooterLink href="#como-funciona">Processo</FooterLink>
            <FooterLink href="#planos">Planos</FooterLink>
          </ul>
        </div>

        <div className="sm:col-span-2">
          <FooterTitle>Conta</FooterTitle>
          <ul className="mt-4 space-y-2.5 text-[13px]">
            <li>
              <Link
                to="/login"
                className="text-foreground/80 hover:text-foreground"
              >
                Entrar
              </Link>
            </li>
            <li>
              <Link
                to="/signup"
                className="text-foreground/80 hover:text-foreground"
              >
                Criar conta
              </Link>
            </li>
          </ul>
        </div>

        <div className="sm:col-span-2">
          <FooterTitle>Legal</FooterTitle>
          <ul className="mt-4 space-y-2.5 text-[13px] text-muted-foreground">
            <li>
              <span className="opacity-60">Termos</span>
              <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                em breve
              </span>
            </li>
            <li>
              <span className="opacity-60">Privacidade</span>
              <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                em breve
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border/70">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-3 px-6 py-6 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Minha Agenda</span>
          <span>Feito no Brasil · pt-BR</span>
        </div>
      </div>
    </footer>
  )
}

function FooterTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </div>
  )
}

function FooterLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <li>
      <a href={href} className="text-foreground/80 hover:text-foreground">
        {children}
      </a>
    </li>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Section head reutilizável                                         */
/* ──────────────────────────────────────────────────────────────── */

function SectionHead({
  eyebrow,
  title,
  align = 'left',
}: {
  eyebrow: string
  title: React.ReactNode
  align?: 'left' | 'center'
}) {
  return (
    <div className={cn(align === 'center' && 'mx-auto max-w-3xl text-center')}>
      <div
        className={cn(
          'flex items-center gap-3',
          align === 'center' && 'justify-center',
        )}
      >
        <span className="h-px w-6 bg-foreground/30" aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </span>
      </div>
      <h2 className="mt-6 max-w-3xl font-serif text-[clamp(2.25rem,5vw,4rem)] leading-[1.1] text-balance">
        {title}
      </h2>
    </div>
  )
}
