# CONTEXT.md — Minha Agenda

> **Documento mestre do projeto.** Toda decisão de arquitetura, modelagem,
> segurança e organização passa por aqui.
>
> **REGRA OBRIGATÓRIA DE MANUTENÇÃO**
> A cada alteração relevante no projeto — nova tabela, nova política RLS,
> nova rota, nova página, nova fase concluída, nova dependência, nova
> convenção, mudança de contrato — **este arquivo DEVE ser atualizado na
> mesma entrega** (mesmo PR / mesmo commit).
>
> Se uma mudança no código não refletir no CONTEXT.md, a entrega está
> incompleta. Trate este arquivo como código de produção.
>
> Seção específica mantida ao final: [Changelog](#changelog).

---

## 1. Visão do produto

SaaS de agendamento para profissionais autônomos e pequenos negócios
(barbeiros, cabeleireiros, nail designers, esteticistas, tatuadores,
massagistas, personal trainers etc).

Cada profissional possui:

- Área administrativa privada (`/dashboard/*`)
- Página pública própria (`/p/{slug}`)
- Base isolada de clientes, serviços, agendamentos, produtos e
  configurações

**Multi-tenant com isolamento garantido pelo banco (RLS).** O frontend
nunca é a última linha de defesa.

**Prioridades de design:**
`Segurança > Integridade dos dados > UX > Performance > Estética`.

---

## 2. Stack técnica

| Camada            | Tecnologia                                           |
| ----------------- | ---------------------------------------------------- |
| Build / Dev       | Vite                                                 |
| Linguagem         | TypeScript (modo estrito, sem `any`)                 |
| UI                | React 18 + React Router 6                            |
| Estilo            | Tailwind CSS                                         |
| Componentes       | shadcn/ui (padrão: Radix + CVA + tailwind-merge)     |
| Ícones            | lucide-react                                         |
| Datas             | date-fns                                             |
| Server state      | TanStack Query v5                                    |
| Forms + validação | react-hook-form + zod                                |
| Backend           | Supabase (Postgres + Auth + Storage + Edge Fns)      |

**Chaves Supabase:** apenas `anon` no frontend. `service_role` nunca sai
do servidor / Edge Functions.

---

## 3. Modelo de dados (PostgreSQL)

### 3.1 Diagrama lógico

```
auth.users (Supabase)
    │ 1:1
    ▼
profiles ──────────── booking_settings (1:1)
    │
    ├──── business_hours   (1:N)
    ├──── services         (1:N)
    ├──── products         (1:N)
    ├──── portfolio_items  (1:N)
    ├──── clients          (1:N)
    └──── appointments     (1:N) ──► clients (N:1)
                                └──► services (N:1)

auth.users ◄──── admin_users          (1:1 subset — "é admin da plataforma")
auth.users ◄──── subscriptions ──► plans   (1:1 user → N:1 plan)
                 admin_audit_log      (trilha imutável de ações admin)
```

Storage buckets (Supabase Storage):

```
avatars/{professional_id}/{random}.{ext}    — 2MB, JPG/PNG/WEBP
portfolio/{professional_id}/{random}.{ext}  — 5MB, JPG/PNG/WEBP
products/{professional_id}/{random}.{ext}   — 5MB, JPG/PNG/WEBP
```

Policies restringem escrita ao dono via `(storage.foldername(name))[1]`.

### 3.2 Tabelas

Chaves estrangeiras usam `ON DELETE CASCADE` quando a entidade filha não
faz sentido sem o pai (ex.: `business_hours` sem `profile`). Em
`appointments`, `service_id` e `client_id` usam `ON DELETE RESTRICT` para
proteger histórico.

#### `profiles`
Representa o profissional. 1-para-1 com `auth.users`.

| Coluna       | Tipo          | Observações                            |
| ------------ | ------------- | -------------------------------------- |
| id           | uuid PK       | `gen_random_uuid()`                    |
| user_id      | uuid UNIQUE   | FK `auth.users(id)` ON DELETE CASCADE  |
| slug         | text UNIQUE   | lowercase, `[a-z0-9-]+`, usado em `/p/`|
| name         | text          |                                        |
| bio          | text NULL     |                                        |
| avatar_url   | text NULL     |                                        |
| phone        | text NULL     |                                        |
| city         | text NULL     |                                        |
| timezone     | text          | default `America/Sao_Paulo`            |
| created_at   | timestamptz   | default `now()`                        |
| updated_at   | timestamptz   | default `now()` (trigger)              |

#### `services`

| Coluna            | Tipo        | Observações                        |
| ----------------- | ----------- | ---------------------------------- |
| id                | uuid PK     |                                    |
| professional_id   | uuid        | FK `profiles(id)` ON DELETE CASCADE|
| name              | text        |                                    |
| description       | text NULL   |                                    |
| price_cents       | integer     | Guardamos em centavos (`>= 0`)     |
| duration_minutes  | integer     | `> 0`                              |
| active            | boolean     | default `true`                     |
| created_at        | timestamptz |                                    |
| updated_at        | timestamptz |                                    |

> **Por que `price_cents`?** Evita o pesadelo de arredondamento com
> `numeric` e `float` para dinheiro. A UI formata para `R$`.

#### `clients`

| Coluna          | Tipo        | Observações                                   |
| --------------- | ----------- | --------------------------------------------- |
| id              | uuid PK     |                                               |
| professional_id | uuid        | FK `profiles(id)` ON DELETE CASCADE           |
| name            | text        |                                               |
| phone           | text NULL   | normalizado só com dígitos                    |
| email           | text NULL   |                                               |
| notes           | text NULL   | observações do profissional (privado)         |
| created_at      | timestamptz |                                               |
| updated_at      | timestamptz |                                               |

Índice único parcial: `UNIQUE (professional_id, phone) WHERE phone IS NOT NULL`.
Dois clientes do mesmo profissional não podem ter o mesmo telefone; isso
viabiliza o "upsert por telefone" no fluxo de agendamento público.

#### `appointments`

| Coluna                 | Tipo               | Observações                                           |
| ---------------------- | ------------------ | ----------------------------------------------------- |
| id                     | uuid PK            |                                                       |
| professional_id        | uuid               | FK `profiles(id)` ON DELETE CASCADE                   |
| client_id              | uuid               | FK `clients(id)` ON DELETE RESTRICT                   |
| service_id             | uuid               | **Serviço principal** (= primeiro). ON DELETE RESTRICT |
| start_at               | timestamptz        |                                                       |
| end_at                 | timestamptz        | `end_at > start_at` (CHECK)                           |
| status                 | appointment_status | enum (ver abaixo), default `pending`                  |
| notes                  | text NULL          |                                                       |
| total_price_cents      | integer            | Soma dos preços (snapshot)                            |
| total_duration_minutes | integer            | Soma das durações (snapshot)                          |
| created_at             | timestamptz        |                                                       |
| updated_at             | timestamptz        |                                                       |

Para a **lista completa** de serviços daquele agendamento, consultar
`appointment_services`.

#### `appointment_services`

Tabela associativa N:M entre `appointments` e `services`. Guarda
**snapshot** de preço e duração — se o profissional alterar o serviço
depois, o agendamento mantém o que foi cobrado originalmente.

| Coluna                       | Tipo        | Observações                               |
| ---------------------------- | ----------- | ----------------------------------------- |
| id                           | uuid PK     |                                           |
| appointment_id               | uuid        | FK `appointments(id)` ON DELETE CASCADE   |
| service_id                   | uuid        | FK `services(id)` ON DELETE RESTRICT      |
| price_cents_snapshot         | integer     | preço no momento da reserva               |
| duration_minutes_snapshot    | integer     | duração no momento da reserva             |
| position                     | integer     | ordem de seleção (0 = primeiro)           |
| created_at                   | timestamptz |                                           |

Enum `appointment_status`: `pending | confirmed | cancelled | completed | no_show`.

**Prevenção de conflitos (crítica).** Em vez de validar via SELECT
"existe algo entre X e Y?" (sujeito a race condition entre dois clientes
agendando simultaneamente), usamos uma `EXCLUDE` constraint com
`tstzrange` + `btree_gist`:

```sql
EXCLUDE USING gist (
  professional_id WITH =,
  tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (status IN ('pending','confirmed','completed'))
```

Garantia **do banco**: nunca haverá dois agendamentos ativos ou já
atendidos sobrepostos para o mesmo profissional. Qualquer tentativa
de INSERT concorrente que colida é rejeitada atomicamente.

**Por que `completed` entra no filtro?** Para que um horário já
atendido não possa ser reservado novamente — a agenda preserva o
histórico. Apenas `cancelled` e `no_show` liberam o slot.

#### `business_hours`

| Coluna          | Tipo    | Observações                              |
| --------------- | ------- | ---------------------------------------- |
| id              | uuid PK |                                          |
| professional_id | uuid    | FK CASCADE                               |
| weekday         | smallint| 0=Dom ... 6=Sáb                          |
| start_time      | time    |                                          |
| end_time        | time    | `end_time > start_time` (CHECK)          |
| active          | boolean | default `true`                           |

Multiplas linhas por `weekday` → suporta intervalos (ex.: 08–12 e 14–18).

#### `booking_settings`

1:1 com `profiles`. `UNIQUE(professional_id)`.

| Coluna                        | Tipo    | Default |
| ----------------------------- | ------- | ------- |
| minimum_advance_minutes       | integer | 120     |
| maximum_advance_days          | integer | 30      |
| require_confirmation          | boolean | false   |
| cancellation_enabled          | boolean | true    |
| cancellation_deadline_minutes | integer | 120     |
| default_interval_minutes      | integer | 15      |
| online_booking_enabled        | boolean | true    |

#### `portfolio_items`

Fotos de trabalhos realizados — alimenta a galeria em `/p/:slug`.

| Coluna          | Tipo        | Observações                            |
| --------------- | ----------- | -------------------------------------- |
| id              | uuid PK     |                                        |
| professional_id | uuid        | FK `profiles(id)` ON DELETE CASCADE    |
| image_url       | text        | URL pública do Storage                 |
| storage_path    | text        | Caminho para deletar o blob            |
| title           | text NULL   |                                        |
| description     | text NULL   |                                        |
| position        | integer     | Ordem (menor = primeiro)               |
| created_at      | timestamptz |                                        |

RLS: SELECT público (`using (true)`), demais operações só do dono.

#### `products`

| Coluna          | Tipo        | Observações          |
| --------------- | ----------- | -------------------- |
| id              | uuid PK     |                      |
| professional_id | uuid        | FK CASCADE           |
| name            | text        |                      |
| description     | text NULL   |                      |
| price_cents     | integer     | `>= 0`               |
| stock           | integer     | default `0` (`>= 0`) |
| sku             | text NULL   |                      |
| image_url       | text NULL   |                      |
| active          | boolean     | default `true`       |
| created_at      | timestamptz |                      |
| updated_at      | timestamptz |                      |

### 3.3 Serviços múltiplos por agendamento

Um appointment pode conter **1..N serviços**. O cliente seleciona uma
cesta no `BookingFlow`; a RPC `book_appointment` soma preços e
durações, grava os totais em `appointments.total_*` e cria uma linha
por serviço em `appointment_services` (com snapshot). O
`appointments.service_id` continua apontando para o primeiro — útil
para listas rápidas sem join.

### 3.4 Trigger de novo usuário

`on_auth_user_created` → função `handle_new_user()` cria `profile` +
`booking_settings` + horários default (seg–sex 08–18, sáb 08–13) assim
que `auth.users` recebe um novo registro. Slug default:
`nome-sanitizado-<6-chars-aleatórios>`; usuário edita depois.

### 3.5 Trigger de `updated_at`

Função genérica `set_updated_at()` disparada em `BEFORE UPDATE` nas
tabelas com essa coluna.

### 3.6 Área admin (0018)

Tabelas separadas do domínio do profissional:

#### `admin_users`

| Coluna      | Tipo        | Observações                                |
| ----------- | ----------- | ------------------------------------------ |
| id          | uuid PK     |                                            |
| user_id     | uuid UNIQUE | FK `auth.users(id)` ON DELETE CASCADE      |
| created_at  | timestamptz |                                            |
| created_by  | uuid NULL   | FK `auth.users(id)` ON DELETE SET NULL     |

#### `plans`

| Coluna                       | Tipo         | Observações                                 |
| ---------------------------- | ------------ | ------------------------------------------- |
| id                           | uuid PK      |                                             |
| code                         | text UNIQUE  | lowercase (`free`, `pro`, ...)              |
| name                         | text         |                                             |
| description                  | text NULL    |                                             |
| price_cents                  | integer      | `>= 0`                                      |
| billing_interval             | text         | `monthly` \| `yearly` \| `lifetime`         |
| features                     | jsonb        | lista de benefícios                         |
| max_services                 | integer NULL | NULL = sem limite                           |
| max_appointments_per_month   | integer NULL | NULL = sem limite                           |
| active                       | boolean      | SELECT público só quando `true`             |
| created_at / updated_at      | timestamptz  |                                             |

#### `subscriptions`

1:1 com `auth.users`.

| Coluna      | Tipo         | Observações                                             |
| ----------- | ------------ | ------------------------------------------------------- |
| id          | uuid PK      |                                                         |
| user_id     | uuid UNIQUE  | FK `auth.users(id)` ON DELETE CASCADE                   |
| plan_id     | uuid         | FK `plans(id)` ON DELETE RESTRICT                       |
| status      | text         | `active` \| `past_due` \| `cancelled` \| `trialing`     |
| started_at  | timestamptz  |                                                         |
| expires_at  | timestamptz NULL |                                                     |

#### `admin_audit_log`

Toda ação administrativa (criar/alterar plano, promover admin, editar
usuário) grava uma linha via `SECURITY DEFINER`. Fonte da verdade
imutável do "quem fez o quê e quando".

| Coluna         | Tipo        | Observações                              |
| -------------- | ----------- | ---------------------------------------- |
| id             | uuid PK     |                                          |
| admin_user_id  | uuid NULL   | FK `auth.users(id)` ON DELETE SET NULL   |
| action         | text        | `list_users`, `create_plan`, etc.        |
| target_type    | text NULL   |                                          |
| target_id      | text NULL   |                                          |
| metadata       | jsonb NULL  |                                          |
| created_at     | timestamptz |                                          |

---

## 4. Segurança: Row Level Security

**RLS habilitado em TODAS as tabelas de domínio.** Nada é "aberto por
padrão".

### 4.1 Regra central

Toda tabela com `professional_id` carrega políticas no padrão:

```sql
-- autor: só vê o que é seu
USING (professional_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))

-- escrita: idem
WITH CHECK (professional_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))
```

### 4.2 Exposição pública seletiva

A página `/p/{slug}` precisa ler **sem autenticação**:

| Tabela           | SELECT público permite                                             |
| ---------------- | ------------------------------------------------------------------ |
| profiles         | Linhas inteiras — não contém dado sensível                         |
| services         | Apenas `active = true`                                             |
| business_hours   | Apenas `active = true`                                             |
| booking_settings | Linhas inteiras (apenas flags de regras, nada sensível)            |
| products         | Apenas `active = true`                                             |
| clients          | **Nunca.** Zero acesso anônimo.                                    |
| appointments     | **Nunca** via SELECT direto. Reserva via RPC `book_appointment`.   |

### 4.3 RPC `book_appointment` (SECURITY DEFINER)

Único caminho pelo qual um visitante anônimo pode gravar em
`appointments` e `clients`. A função:

1. Resolve `profile` por `slug`;
2. Valida que `online_booking_enabled = true`;
3. Valida `service` ativo e pertencente ao profissional;
4. Calcula `end_at = start_at + duration`;
5. Valida que `start_at >= now() + minimum_advance_minutes`;
6. Valida que `start_at <= now() + maximum_advance_days`;
7. Valida que o intervalo cabe em `business_hours` daquele weekday;
8. Faz upsert de cliente por `(professional_id, phone)`;
9. Insere `appointment` (a `EXCLUDE` constraint resolve conflito);
10. Define `status = require_confirmation ? 'pending' : 'confirmed'`;
11. Retorna o id do agendamento + status.

**Erros são códigos previsíveis** (`'conflict'`, `'outside_hours'`,
`'too_soon'`, `'service_inactive'`, `'bookings_disabled'`,
`'too_far'`, `'profile_not_found'`) — o frontend traduz em mensagem
amigável. Nunca propagar `SQLSTATE` cru para o usuário.

### 4.4 O que NUNCA é exposto no frontend

- `service_role_key`
- Lista completa de clientes de qualquer forma anônima
- Observações de clientes
- Agendamentos de qualquer profissional, por qualquer rota pública

### 4.5 Área administrativa (0018)

**Dois conceitos distintos**, ambos exigidos para ação admin:

1. **"É admin"** — user_id presente em `public.admin_users`.
   Checado via `public.am_i_admin_user()`.
2. **"Sessão elevada"** — JWT com `aal = 'aal2'` (MFA TOTP
   verificada *nesta sessão*). Supabase gerencia; o frontend chama
   `auth.mfa.verify()` para elevar.

A função `public.is_admin()` exige **os dois**:

```sql
select
  coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
  and exists (select 1 from public.admin_users where user_id = auth.uid())
```

Toda RLS admin e TODA RPC `admin_*` começa com
`if not public.is_admin() then return 'forbidden'`. Defesa em
profundidade: mesmo se o guard do frontend falhasse, o banco rejeita.

**Fluxo de acesso** (ver `src/routes/AdminRoute.tsx`):

1. Sem sessão → `/login`.
2. Logado mas fora de `admin_users` → tela "Acesso restrito".
3. Admin sem fator TOTP cadastrado → `/admin/mfa/enroll` (QR + verify).
4. Admin com fator cadastrado em sessão AAL1 → `/admin/mfa/challenge`.
5. Admin + AAL2 → libera `/admin/*`.

**Trilha de auditoria** (`admin_audit_log`): toda ação admin
(`admin_create_plan`, `admin_set_user_plan`, `admin_set_admin_flag`,
`admin_update_user_profile`, etc.) insere via `SECURITY DEFINER`.
RLS da tabela só permite SELECT a admins elevados; INSERT acontece
somente dentro das RPCs.

**Bootstrap do primeiro admin** (único passo manual necessário):

```sql
-- SQL Editor do Supabase, logado como service_role:
insert into public.admin_users (user_id)
values ('<uuid-do-usuario>');
```

Depois, qualquer admin elevado promove outros pela UI
(`/admin/users/:id` → "Promover a admin").

---

## 5. Estrutura de pastas

```
minha-agenda/
├── CONTEXT.md                   ← este arquivo (sempre atualizado)
├── README.md
├── .env.example
├── package.json
├── tsconfig*.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── index.html
├── supabase/
│   └── migrations/
│       ├── 0001_initial_schema.sql
│       ├── 0002_rls_policies.sql
│       └── 0003_booking_rpc.sql
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── components/
    │   └── ui/                  ← primitivos shadcn-style
    ├── contexts/
    │   └── AuthContext.tsx
    ├── hooks/
    │   └── useAuth.ts
    ├── layouts/
    │   ├── DashboardLayout.tsx
    │   └── PublicLayout.tsx
    ├── lib/
    │   ├── supabase.ts          ← client único, chave anon
    │   ├── queryClient.ts       ← TanStack Query config
    │   └── utils.ts             ← cn(), formatters
    ├── pages/
    │   ├── auth/
    │   │   ├── LoginPage.tsx
    │   │   ├── SignupPage.tsx
    │   │   └── ForgotPasswordPage.tsx
    │   ├── dashboard/
    │   │   └── DashboardHomePage.tsx
    │   ├── public/
    │   │   └── ProfessionalPage.tsx
    │   └── NotFoundPage.tsx
    ├── routes/
    │   ├── AppRoutes.tsx
    │   └── ProtectedRoute.tsx
    ├── services/                ← chamadas Supabase por domínio (próximas fases)
    ├── types/
    │   ├── database.ts          ← tipos gerados / espelho do schema
    │   └── domain.ts            ← tipos de domínio e enums
    └── utils/                   ← helpers puros
```

**Separação de camadas:**

- `components/ui`: puros, sem regra de negócio
- `services/`: chamadas a Supabase, uma por domínio
- `hooks/`: wrappers de services com TanStack Query
- `pages/`: composição; sem queries diretas (usa hooks)
- `lib/`: integrações externas e utilitários globais

---

## 6. Roteamento

```
PÚBLICO
  /                       → landing pública (sempre; sem redirect automático)
  /login
  /signup
  /forgot-password
  /p/:slug                → página pública do profissional

PROTEGIDO (requer sessão)
  /dashboard              → visão geral
  /dashboard/agenda       → calendário (Fase 4)
  /dashboard/clientes     → lista + perfil (Fase 5)
  /dashboard/servicos     → CRUD (Fase 3)
  /dashboard/produtos     → CRUD (Fase 6)
  /dashboard/configuracoes
    /horarios             → business_hours
    /agendamento          → booking_settings
    /perfil               → profile
    /assinatura           → planos + checkout do próprio usuário

ADMIN (requer admin_users + MFA / AAL2 — ver §4.5)
  /admin                  → métricas da plataforma
  /admin/users            → lista paginada de usuários
  /admin/users/:id        → relatório + ações (editar, plano, admin)
  /admin/plans            → CRUD de planos de assinatura
  /admin/reports          → trilha de auditoria (admin_audit_log)
  /admin/mfa/enroll       → cadastro de TOTP (obrigatório na 1ª vez)
  /admin/mfa/challenge    → desafio TOTP a cada sessão nova

404
  *                       → NotFoundPage
```

Rotas protegidas passam por `<ProtectedRoute>` que lê o
`AuthContext` e redireciona para `/login` preservando `redirectTo`.

---

## 7. Fases de desenvolvimento

| Fase | Escopo                                               | Status     |
| ---- | ---------------------------------------------------- | ---------- |
| 1    | Fundação (projeto, Supabase, schema, RLS, auth base) | ✅         |
| 2    | Autenticação completa + Dashboard shell + Perfil     | ✅         |
| 3    | CRUD de serviços + primeira versão da página pública | ✅         |
| 4    | Agenda / calendário + fluxo completo de agendamento  | ✅         |
| 5    | Clientes (lista, perfil, histórico, observações)     | ✅         |
| 6    | Produtos (CRUD, estoque básico, imagens)             | ✅         |
| 7    | Refino: acessibilidade, SEO, performance, erros, UX  | 🟡 em andamento |

**Regra:** não avançar de fase sem a anterior estar funcional,
testada manualmente e com CONTEXT.md atualizado.

---

## 8. Convenções

- Nenhum `any`. Preferir `unknown` + narrowing, ou gerar tipos do schema.
- Chamadas ao Supabase moram em `services/<domínio>.ts`. Páginas não
  importam `supabase` diretamente.
- Formulários: `react-hook-form` + `zod` resolver.
- Datas em `timestamptz` no banco, formatadas na UI com `date-fns-tz`
  respeitando `profiles.timezone`.
- Dinheiro em centavos (int) no banco; formatação `R$ x,yz` só na UI.
- Toda ação destrutiva pede confirmação (modal ou AlertDialog).
- Mensagens de erro em português, orientadas ao usuário final —
  **nunca** vazar texto do Postgres.
- Commit messages em português, imperativo ("adiciona", "corrige").

---

## 9. Preparado para evolução (não implementado agora)

- Múltiplos funcionários por tenant (coluna `staff_id` em
  `appointments` já é compatível adicionando tabela `staff` no futuro,
  sem migração destrutiva).
- Pagamentos online (nova tabela `payments` ligada a `appointments`).
- WhatsApp / e-mail / push: fila `notification_outbox` + worker em
  Edge Function.
- Google Calendar: tabela `calendar_integrations` por profissional.
- Avaliações: tabela `reviews` ligada a `appointments`.
- Domínio personalizado: coluna `custom_domain` em `profiles`.
- Bloqueios/feriados: tabela `schedule_blocks` + merge na consulta de
  disponibilidade.

Nenhum "stub" ou mock dessas features é criado agora.

---

## 10. Como atualizar este documento

Quando você (ou um colaborador, humano ou IA) alterar o projeto:

1. **Durante** a alteração, abra este arquivo e ajuste as seções
   relevantes (schema, rotas, convenções, pastas).
2. Adicione uma linha em [Changelog](#changelog) com a data e
   descrição curta.
3. Entregue a mudança **de código e de contexto na mesma unidade**
   (mesmo PR / commit).

Se faltar atualização, considere a entrega incompleta.

---

## Changelog

- **2026-10-06** — **Webhook do MP: `notification_url` + fallback por
  duplo-check + lenient em topics acessórios.** Três ajustes no
  `mercadopago-webhook` depois de debugar o fluxo real:

  1. **`notification_url` na Preference.** `_shared/mercadopago.ts`
     passou a aceitar e enviar `notification_url` quando `SUPABASE_URL`
     está disponível, apontando pra própria edge. Sem isso, o MP não
     disparava o webhook pra pagamentos reais de **test mode** —
     simulate pelo painel funcionava, mas checkout real sumia.

  2. **`verifyWebhookSignature` tenta múltiplas variantes.**
     O MP calcula o manifesto HMAC usando `data.id` de forma
     inconsistente: às vezes vem na query (`?data.id=...`), às vezes
     no body JSON, às vezes em nenhum. O verifier agora testa 3
     variantes (`body`, `query`, `empty`) e loga qual bateu quando
     uma delas valida. Signature inválida só é definitiva se nenhuma
     bater.

  3. **Fallback por duplo-check (sem flag manual).** Se HMAC falhar
     num `topic=payment` (acontece em credenciais de teste do MP por
     bug conhecido com `notification_url` de Preference), o webhook
     NÃO rejeita direto. Em vez disso:
     - a. Chama `getPayment(id)` via `MP_ACCESS_TOKEN`. Se o MP
       devolve o resource, ele existe e pertence à nossa conta
       (atacante não forja payment real sem o access token).
     - b. Lê `external_reference` do payment, extrai `user_id`,
       verifica em `auth.users` via `auth.admin.getUserById`. Se
       existe, aceita como fallback.
     - c. Se qualquer um dos dois checks falha → 401 estrito.

     Combinação (a) + (b) protege até em prod: um atacante teria que
     ter um payment real da **nossa** conta MP **E** o user_id
     correspondente **E** o payment estaria originalmente associado
     a uma Preference que a gente mesmo criou. Pior cenário residual
     (replay de webhook legítimo) é absorvido pela trava de
     idempotência `payment_events UNIQUE (gateway, gateway_event_id)`.

     **Tentei antes:** gating por `payment.live_mode === true/false`.
     Fracassou porque credenciais de teste do MP devolvem
     `live_mode: true` em alguns setups — a heurística rejeitava
     payments de dev. Desenho atual é independente desse campo.

  4. **Topic auto-detect + topics não-payment silenciosos.** O MP
     usa nomes diferentes de campo (`type`, `topic`, `action`,
     query string) dependendo da versão/formato. Agora a edge testa
     todos. Se mesmo assim o topic vier vazio mas tiver `resourceId`,
     assume `payment` (único resource que este app cria). Topics
     não-payment (`merchant_order`, pings, etc.) deixaram de retornar
     401 — retornam `200 ok` silenciosamente pra evitar o MP
     reagendar o mesmo evento inútil várias vezes. Se HMAC bate,
     ainda são auditados em `payment_events`.

  **Também:** `SubscriptionPage` ganhou trava anti-duplicata — se
  `my_plan.subscription_status === 'active'` e `expires_at > now()`,
  os botões "Assinar" dos outros planos ficam `disabled` e um
  aviso em azul anuncia a data de liberação. Evita cobrança
  duplicada se o usuário clicar sem perceber que já pagou.

  **Arquivos tocados:**
  - `supabase/functions/_shared/mercadopago.ts` — `notification_url`
    no `PreferenceInput`, `verifyWebhookSignature` com múltiplas
    variantes de manifesto, `PaymentResponse.live_mode` adicionado
    (mantido como info, não como gate).
  - `supabase/functions/create-subscription/index.ts` — monta
    `notification_url` a partir de `SUPABASE_URL`.
  - `supabase/functions/mercadopago-webhook/index.ts` — refatorado:
    topic auto-detect, caminho crítico só pra `payment`, fallback
    duplo-check, tratamento silencioso de topics acessórios.
  - `src/pages/dashboard/settings/SubscriptionPage.tsx` — flag
    `hasActivePaidSub` + prop `lockedUntilExpire` em `PlanCard`.

  **Dívida assumida:** se um dia a doc do MP esclarecer o formato
  exato do manifesto HMAC em `notification_url` de Preference, dá
  pra reduzir a `verifyWebhookSignature` pra uma variante só.
  Por ora, "tenta todas" é a estratégia mais robusta.

- **2026-10-06** — **Assinatura dentro do app pra conta grátis.**
  Antes só dava pra assinar vindo da landing. Agora o usuário logado no
  plano `free` tem dois caminhos no próprio dashboard:
  1. Banner "Desbloqueie mais recursos" na `DashboardHomePage` (aparece
     só quando `my_plan.plan_code === 'free'`) → leva pra assinatura.
  2. Nova aba **Assinatura** em `/dashboard/configuracoes/assinatura`
     (`SubscriptionPage.tsx`) — lista plano atual + todos os planos
     ativos. Cards com permissões, quotas e benefícios no mesmo
     vocabulário dos cards da landing. Botão "Assinar <Plano>" chama
     `createCheckoutForPlan` e redireciona pro Mercado Pago (mesmo
     `init_point` já usado em `CheckoutRedirectPage`). Plano atual
     vira "Você está neste plano" (disabled). Plano grátis sempre
     "Plano padrão" (não dá pra "comprar" grátis — a trigger já assina
     por default).
  **Arquivos:**
  - Novo `src/pages/dashboard/settings/SubscriptionPage.tsx`.
  - `AppRoutes.tsx`: rota lazy `/dashboard/configuracoes/assinatura`.
  - `SettingsLayout.tsx`: aba "Assinatura" com ícone `CreditCard`.
  - `DashboardHomePage.tsx`: `UpgradeBanner` renderizado só pra
    `plan_code === 'free'`.
- **2026-10-06** — **Fluxo "intenção primeiro, auth no caminho" pro checkout.**
  Antes, visitante tinha que: landing → signup → confirmar email →
  voltar manualmente pra landing → clicar "Assinar". UX ruim.

  Agora o fluxo é:
  1. Visitante na landing clica "Criar conta e assinar" num plano
     pago → `<Link to="/signup?plan=pro">` (vai DIRETO pro signup —
     label e destino batem). Logado clica "Assinar" → vai direto
     pra `/checkout/:code`.
  2. SignupPage lê `?plan=` → reconstrói `redirectTo = /checkout/pro`
     e passa como `emailRedirectTo` absoluto no `signUp`.
  3. Email de confirmação do Supabase redireciona pra
     `/checkout/pro` — não pra `/` como padrão.
  4. `CheckoutRedirectPage` monta, chama a edge `create-subscription`
     e `window.location = init_point` → Mercado Pago.
  5. Pagou → `back_urls.success` traz de volta pro `/dashboard`.
  6. Quem já tem conta: clica em "Já tem conta? Entrar" dentro do
     signup → LoginPage recebe `redirectTo` via state → login →
     redirecionado pro `/checkout/pro`.

  **Arquivos:**
  - Novo `src/pages/CheckoutRedirectPage.tsx` — rota de passagem com
    `Loader2`, chama `createCheckoutForPlan(plan.id)` uma única vez
    (guard via `useRef` pra evitar double-fire do StrictMode). Erro
    mostra "Checkout indisponível" com link pra `/#planos`.
  - `AppRoutes.tsx`: rota `/checkout/:planCode` dentro de
    `ProtectedRoute`, FORA de `DashboardLayout` (full-screen).
  - `LandingPage.PricingCard`: CTAs pagas sempre linkam pra
    `/checkout/${plan.code}` (removeu `useStartCheckout` daqui).
    Label: "Assinar" (logado) ou "Criar conta e assinar" (visitante).
  - `AuthContext.signUp`: assinatura ganhou 4º parâmetro opcional
    `{ emailRedirectTo?: string }`, repassado pro Supabase.
  - `SignupPage`:
    - lê `redirectTo` de `location.state` (vindo do ProtectedRoute);
      fallback pra `?plan=<code>` → reconstrói `/checkout/<code>`;
    - passa `emailRedirectTo` absoluto ao `signUp`;
    - se o Supabase não exigir confirmação de email (session fica
      ativa no `signUp`), `useEffect` navega pro `redirectTo` direto;
    - link "Entrar" propaga `redirectTo` via state;
    - "Entrar nessa conta" (ramo already_registered) também propaga.
  - `LoginPage`: link "Criar conta" propaga `redirectTo` via state.

  **Trade-off aceito:** o fluxo depende do `emailRedirectTo` do
  Supabase funcionar — precisa que o domínio esteja whitelistado em
  **Supabase → Auth → URL Configuration → Redirect URLs**. Já é o
  caso (`https://seu-dominio.web.app/**`).
- **2026-10-06** — **Troca Preapproval → Checkout Preference (0023).**
  Motivação: **Preapproval do MP só aceita cartão de crédito**. Pra
  oferecer Pix (prioridade BR), migrado pro modelo Checkout Preference
  ("pagamento por período"): user paga 1 mês → webhook aprova →
  `current_period_end` estende em 1 mês → quando vence,
  `has_feature()` filtra via `expires_at > now()` (0019). Sem
  cobrança recorrente automática; renovação é manual (user paga de
  novo). Aceita **Pix + cartão + boleto** nativamente via
  `/checkout/preferences`.

  **Schema (0023_switch_to_preference.sql):**
  - DROP `plans.gateway_plan_id` + índice. Preference é criado
    on-the-fly a cada compra, sem template no MP.
  - `admin_update_plan` reescrito sem `p_gateway_plan_id`.
  - Resto do schema de pagamento (0021) **permanece**: tabela
    `payment_events`, campos `gateway_subscription_id` /
    `current_period_end` em subscriptions, RPCs
    `activate_subscription_from_webhook`, `mark_subscription_cancelled`,
    `my_subscription_detail`, `record_payment_event`.
  - `subscriptions.gateway_subscription_id` passa a guardar o
    `payment_id` da compra mais recente (não é mais preapproval_id).

  **Edge Functions:**
  - DELETADA `sync-plan-to-mp` — Preference dispensa pré-sincronização.
  - `_shared/mercadopago.ts` reescrito: só `createPreference`,
    `getPayment`, `verifyWebhookSignature`. Preference inclui
    `back_urls`, `auto_return: 'approved'`, `binary_mode: true`
    (sem estado "pending" ambíguo), `statement_descriptor: MINHA AGENDA`.
  - `create-subscription` cria Preference em vez de Preapproval.
    External reference segue `user_id:plan_id`.
  - `mercadopago-webhook` simplificado: só processa `type=payment`.
    Em `status=approved` → `activate_subscription_from_webhook`
    estendendo `current_period_end` em 1 mês. Outros topics
    ficam só na trilha de `payment_events` pra auditoria.
  - `supabase/config.toml` perdeu a entrada `[functions.sync-plan-to-mp]`.

  **Frontend:**
  - Removido `Plan.gateway_plan_id`, `syncPlanToMercadoPago`, badge
    "Sincronizado/Pendente", botão "Sincronizar MP" no admin.
  - `AdminPlansPage`: card do plano agora só mostra preço, benefícios,
    permissões e quotas — sem passo extra de sincronização.
  - `LandingPage.PricingCard`: CTAs simplificadas:
    - Grátis + logado → "Ir para o dashboard".
    - Grátis + visitante → "Começar grátis".
    - Pago + logado → **"Assinar"** (dispara checkout imediato).
    - Pago + visitante → **"Criar conta e assinar"** com legenda
      "Pix · cartão · boleto".
  - `RequirePermission.UpgradePrompt` deixa de filtrar por
    `gateway_plan_id` — qualquer plano pago ativo que libera a
    permissão vira CTA.
  - `CHECKOUT_ERROR_LABEL` sem `plan_not_synced`/`lifetime_not_supported`;
    adicionado `mp_token_missing`.

  **Deploy desta fase:**
  ```
  supabase db push                     # aplica 0023 (drop gateway_plan_id)
  supabase functions deploy create-subscription
  supabase functions deploy mercadopago-webhook
  # sync-plan-to-mp não existe mais — remova do painel se quiser
  ```
  Secrets inalterados (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`,
  `SITE_URL`).

  **Trade-off assumido**: cobrança não é automática. Mitigação
  prevista (não implementada ainda): job diário que envia email
  N dias antes de `current_period_end` com link pra renovar.
- **2026-10-05** — **Integração Mercado Pago (Preapproval) — 0021 + Edge Functions.**
  Modelo escolhido: **Preapproval** (assinatura recorrente nativa do MP),
  não "pagamento por período". Vantagem: MP cobra mensalmente, lida com
  retentativa de cartão. Vai mais código do nosso lado, mas UX de SaaS
  real.

  **Schema (0021_payments.sql):**
  - `plans.gateway_plan_id text` (UNIQUE WHERE NOT NULL) — id do
    `preapproval_plan` no MP.
  - `subscriptions`: + `gateway`, `gateway_subscription_id` (UNIQUE
    WHERE NOT NULL), `last_payment_at`, `current_period_end`,
    `cancel_at_period_end`.
  - `payment_events`: auditoria + idempotência via UNIQUE
    `(gateway, gateway_event_id)`. Owner lê os próprios; admin lê tudo.
    **Zero grant de INSERT** pra `authenticated` — só service_role.
  - RPCs `record_payment_event`, `activate_subscription_from_webhook`,
    `mark_subscription_cancelled` são `SECURITY DEFINER` sem grant pra
    `authenticated` (REVOKE explícito). Chamadas só pela edge com
    service_role. `my_subscription_detail()` é a RPC segura pro
    frontend ler status da própria assinatura.
  - `admin_update_plan` ganhou `p_gateway_plan_id text` (string vazia
    = limpar, null = não alterar).

  **Edge Functions (`supabase/functions/`):**
  - `_shared/mercadopago.ts` — wrapper de `/preapproval_plan`,
    `/preapproval`, `/v1/payments`, `/authorized_payments`.
    `verifyWebhookSignature()` implementa HMAC-SHA256 com comparação
    constant-time contra `x-signature` do MP.
  - `_shared/supabase.ts` — `serviceClient()` (bypassa RLS, usada no
    webhook) + `userClient(authHeader)` (respeita RLS do caller, usada
    pra verificar admin).
  - `sync-plan-to-mp`: autenticada, admin AAL2. Cria/atualiza
    `preapproval_plan` no MP, grava `plans.gateway_plan_id`.
  - `create-subscription`: autenticada, usuário comum. Cria
    `preapproval` com `external_reference = user_id:plan_id`, devolve
    `init_point` pro redirect.
  - `mercadopago-webhook`: pública (sem auth, segurança via signature).
    Processa `preapproval`, `authorized_payment`, `payment`. Grava
    tudo em `payment_events` (idempotente). Em `authorized` → chama
    `activate_subscription_from_webhook`; em `cancelled`/`paused` →
    `mark_subscription_cancelled`.

  **Frontend:**
  - `src/services/checkout.ts` — `createCheckoutForPlan`,
    `syncPlanToMercadoPago` chamam as edges via
    `supabase.functions.invoke`.
  - `src/hooks/useCheckout.ts` — `useStartCheckout()` mutation que faz
    `window.location.href = init_point` em caso de sucesso.
  - `LandingPage.PricingCard` — CTA condicional: visitante → `/signup`;
    logado + plano sincronizado → botão "Assinar" (dispara checkout);
    logado + plano NÃO sincronizado → "Em breve".
  - `RequirePermission` → `UpgradePrompt` ganhou CTA "Assinar <Plano>"
    que acha o primeiro plano pago+sync que libera a permissão
    bloqueada.
  - `AdminPlansPage` — cada plano pago mostra badge
    "Sincronizado/Pendente" + botão "Sincronizar MP" que chama a edge.
  - `Plan.gateway_plan_id` adicionado ao tipo TS.
  - `src/services/plans.ts` passa a selecionar `gateway_plan_id` pro
    frontend decidir qual botão mostrar.

  **Padrão de segurança (anotação revisada):** pricing dos services do
  profissional já é server-trusted — todas as RPCs
  (`book_appointment`, `admin_create_appointment`,
  `restore_require_confirmation`, `cancel_token`) lêem
  `v_service.price_cents` via `SELECT FROM services WHERE id = …` e
  gravam snapshot em `appointment_services.price_cents_snapshot`.
  **Nenhum caminho** aceita preço vindo do cliente. Mesmo padrão vale
  pra `plans.price_cents` → a edge `create-subscription` lê do DB
  (service_role) e passa pro MP; cliente não dita valor.

  **Configuração necessária no painel do Supabase (Settings → Edge
  Functions → Secrets):**
  - `MP_ACCESS_TOKEN` — token do app Mercado Pago (produção ou teste).
  - `MP_WEBHOOK_SECRET` — string aleatória forte (mesma que você
    configura no painel do MP em Webhooks → "Chave secreta").
  - `SITE_URL` — ex.: `https://seu-dominio.com` (usado no `back_url`
    do checkout).

  **Configuração no painel do Mercado Pago:**
  - Developers → Suas aplicações → criar app → pegar Access Token.
  - Webhooks → cadastrar URL
    `https://<projeto>.functions.supabase.co/mercadopago-webhook`
    com eventos `payment`, `preapproval`, `authorized_payment`.
  - Copiar a chave secreta gerada e colar em `MP_WEBHOOK_SECRET`.

  **Deploy das functions** (com `supabase CLI` configurado):
  ```
  supabase functions deploy sync-plan-to-mp
  supabase functions deploy create-subscription
  supabase functions deploy mercadopago-webhook
  ```
  **Todas as 3** rodam com `verify_jwt = false` (ver
  `supabase/config.toml`). Motivo: o gateway do Supabase valida o JWT
  ANTES do código rodar, e o `OPTIONS` preflight do browser não traz
  Authorization — resultado é 401 no preflight, CORS quebrado. A
  autenticação continua forte: `sync-plan-to-mp` e `create-subscription`
  checam o caller dentro da função via `admin_session_status` /
  `auth.getUser()`; o webhook valida via x-signature.

  **Próximas pendências abertas** (não bloqueantes):
  - Edge `cancel-subscription` + botão "Cancelar assinatura" nas
    Configurações do usuário.
  - Página `/dashboard/configuracoes/assinatura` mostrando
    `my_subscription_detail` + histórico de `payment_events`.
  - Lembrete por email N dias antes de `current_period_end`.
- **2026-10-05** — **Planos na landing + nota de plano no cadastro.**
  Nova seção `Pricing` em `LandingPage` lê planos ativos de
  `public.plans` via `usePublicPlans` (service `src/services/plans.ts`,
  staleTime 10min). Cards por plano mostram preço (BRL), benefícios
  do campo `features` (texto livre), permissões canônicas traduzidas
  via `usePermissionCatalog` e quotas (`max_services`,
  `max_appointments_per_month`). `id="planos"` migrou do `Finale`
  pra cá — o link do header que já apontava pra `#planos` agora
  entrega no lugar certo. CTAs: `price_cents === 0` → `/signup`;
  pagos → `/signup?plan=<code>` com badge "Pagamento em breve"
  (fluxo de checkout real fica para a próxima etapa). SignupPage
  consome o query param com `useSearchParams` e exibe
  `PlanIntentNotice`: se vier `?plan=pro`, texto diz "vamos criar sua
  conta no Gratuito e abrir o checkout quando disponível"; sem query
  param, apenas "você começa no Gratuito" com link `/#planos`.
  Trigger de signup (0019) continua assinando no `free` por default —
  nada mudou nos dados; a intenção fica só na URL por ora.
  **Próxima etapa:** integração real com gateway (Mercado Pago,
  Inter ou Stripe) — fluxo de checkout + webhook de confirmação +
  RPC `activate_subscription(plan_id, external_ref)`.
- **2026-10-05** — **Enforcement de quotas (0020).** Triggers
  `BEFORE INSERT` em `services` e `appointments` leem o plano ativo
  do dono (via `profiles → subscriptions → plans`) e levantam
  `raise exception ... using errcode = 'P0100'` quando ultrapassam
  `max_services` / `max_appointments_per_month`. Contagem:
  **services** inclui todas as linhas (ativas e inativas — desativar
  não libera slot); **appointments** conta somente linhas criadas no
  mês corrente (`date_trunc('month', now())`) com `status != 'cancelled'`.
  `book_appointment` e `admin_create_appointment` reescritos pra pegar
  `sqlstate 'P0100'` no bloco do INSERT e devolver
  `{error: 'quota_exceeded'}` em vez de propagar SQLSTATE cru. Nova
  RPC `my_usage()` devolve snapshot `{services_count, max_services,
  appointments_this_month, max_appointments_per_month}` para a UI.
  Frontend ganhou `getMyUsage`/`useMyUsage` (staleTime 30s),
  `isQuotaError(err)` em `services/permissions.ts` que detecta
  `code === 'P0100'`, e `BOOKING_ERROR_LABEL.quota_exceeded`. A
  `ServicesPage` mostra "X de Y serviços utilizados", desabilita o
  botão "Novo serviço" ao atingir o limite e traduz o erro ao tentar
  mesmo assim.
- **2026-10-05** — **UI de permissões no editor de plano.** O modal
  de criar/editar plano em `AdminPlansPage` agora renderiza o
  catálogo (`permission_catalog`) como checkboxes agrupadas por
  categoria. Novo hook `usePermissionCatalog` (staleTime infinito —
  catálogo é estático). Payload de create/update envia
  `permissions: string[]`. Card do plano exibe as permissões ativas
  como badges `<code>`. Com isso o loop fica fechado: admin edita o
  plano → RPC grava → trigger valida contra catálogo → `my_plan()`
  reflete no cliente afetado no próximo refetch (staleTime 5min).
- **2026-10-05** — **Permissões por plano (feature gating) — 0019.**
  Migration `0019_permissions.sql` introduz `public.permission_catalog`
  (code PK + categoria + nome + descrição) com 8 códigos seed, e
  acrescenta `plans.permissions text[]` com trigger validando contra
  catálogo + GIN index. Funções `has_feature(code)`, `my_permissions()`
  e `my_plan()` servem tanto RLS quanto frontend. Plano `free`
  criado como padrão; `handle_new_user` passa a chamar
  `ensure_free_subscription` após provisionar o profile, com backfill
  para usuários existentes. **Enforcement em duas camadas**: (a) RLS
  em `products` e `portfolio_items` reescrita — SELECT dono livre,
  INSERT/UPDATE/DELETE exigem `has_feature('products.manage')` /
  `has_feature('portfolio.manage')`; (b) frontend ganhou
  `src/lib/permissions.ts` (enum canônico), `src/services/permissions.ts`,
  `useMyPlan`/`usePermissions`, `RequirePermission` em `AppRoutes.tsx`
  nas rotas `/dashboard/produtos` e `/dashboard/portfolio`, e
  `DashboardLayout` oculta os itens correspondentes do sidebar. RPCs
  `admin_create_plan`/`admin_update_plan` passam a aceitar
  `p_permissions text[]` (opcional no update → preserva atual) e
  mapeiam `check_violation` para `invalid_permission`. `Plan.permissions`
  adicionado ao tipo TS. Admin UI de editor de plano ainda não
  renderiza as checkboxes de permissões — próximo passo.
- **2026-10-05** — **Home `/` sempre renderiza a landing.** Removido
  `src/routes/RootRedirect.tsx`; a rota raiz passa a montar
  `LandingPage` direto (lazy). Antes, visitante com sessão era
  redirecionado automaticamente para `/dashboard` ao abrir `/` — agora
  só entra no app quando clica em "Entrar" no header (como o link
  aponta para `/login` e `GuestOnlyRoute` manda sessão existente para
  `/dashboard`, o efeito segue sendo um "login automático" ao clicar).
- **2026-10-05** — **MFA: `unenroll` tolera 404.** `src/services/mfa.ts`
  trata `AuthApiError { status: 404 }` como sucesso (DELETE idempotente).
  Resolvia o caso em que `listFactors` devolvia um fator stale e o
  cleanup abortava o enroll antes de gerar o QR.
- **2026-10-05** — **Área administrativa + planos + MFA (0018).**
  Migration `0018_admin_and_plans.sql` adiciona tabelas `admin_users`,
  `plans`, `subscriptions` e `admin_audit_log`, com RLS exigindo
  `is_admin()`: função que combina presença em `admin_users` com
  JWT em `aal = 'aal2'` (TOTP verificada na sessão). RPCs
  `admin_metrics_overview`, `admin_list_users`, `admin_user_report`,
  `admin_update_user_profile`, `admin_set_admin_flag`,
  `admin_create_plan`/`update_plan`/`delete_plan`,
  `admin_set_user_plan`, `admin_list_plans` e `admin_audit_log_list`
  — todas `SECURITY DEFINER`, todas gravam na trilha de auditoria.
  Frontend: `AuthContext` passou a expor `aal` (lido do JWT) e
  `refreshAal()`. Novos services: `src/services/mfa.ts` (enroll/
  challenge/verify TOTP via `supabase.auth.mfa`) e
  `src/services/admin.ts`. Novo `AdminRoute` que redireciona admin
  sem fator para `/admin/mfa/enroll` e admin em AAL1 para
  `/admin/mfa/challenge`. Novo `AdminLayout` (slash-separado do
  dashboard) e páginas `/admin`, `/admin/users`, `/admin/users/:id`,
  `/admin/plans`, `/admin/reports`. Sidebar do dashboard ganha
  atalho "Área admin" (só visível para quem está em `admin_users`).
  Bootstrap: inserir manualmente o primeiro admin via SQL Editor
  (service_role) em `admin_users`; os próximos são promovidos pela UI.
- **2026-10-04** — **PortfolioPage (dashboard) redesenhada no mesmo
  vocabulário editorial da landing.** Novo header editorial (hairline
  eyebrow "Dashboard · Portfólio" + contador mono "NN peças", H1 serif
  "Portfólio.", subtítulo em serif itálico). Upload area com borda
  dashed hairline, prompt em serif e meta mono. Grid de tiles em
  aspect-[4/5] (portrait editorial) com overlay serif no hover,
  pills de ação (edit/delete) revelados no hover e meta mono abaixo
  da imagem (data no formato "04 out 2026"). Empty state tipográfico
  em vez de card neutro. `FileDrop` passou a aceitar override via
  `className` (já estava preparado via tailwind-merge).
- **2026-10-04** — **Numerações removidas da landing.** Fora os
  numerais romanos (I–VI) do SectionHead, os `01`–`06` do bento de
  features (substituídos por kickers conceituais: "Distribuição",
  "Integridade"…), os `01/02/03` gigantes dos passos do Process
  (viraram "Primeiro / Depois / Enfim" em mono eyebrow), os números
  da lista Audience, "N° 001" do masthead e "II./VI." dos eyebrows
  do Showcase/Finale. A hierarquia agora é 100% tipográfica —
  hairline + eyebrow mono + headline serif — sem numeração visível.
- **2026-10-04** — **Landing redesenhada: direção editorial-premium.**
  Fora os gradientes multicoloridos e os ícones com tint pastel —
  paleta agora é estritamente slate monocromática, 100% alinhada aos
  tokens do app (`--foreground`, `--muted-foreground`, `--border`).
  Display passou para **Instrument Serif** (serif editorial com
  itálico) e meta/eyebrows para **JetBrains Mono**; Inter segue como
  corpo. Composição assimétrica tipo revista: masthead "Est. 2026 ·
  N° 001", numeração romana por seção (I–VI), hero 7/5 com headline
  serif em 3 linhas e card-mockup com chrome de browser, manifesto
  tipográfico, bento assimétrico de features (span-4 + span-2),
  showcase em slate-950 com mock de dashboard preto-e-branco, process
  em tabela editorial com durações, audience como lista numerada com
  arrow-up-right no hover, pull-quote com aspa gigante, FAQ accordion
  (grid-template-rows animation), finale dark sóbrio sem gradiente.
  Novos utilitários em `index.css`: `.grain` (overlay SVG noise),
  `.hairline`, `.rise` (entrada staggered), `.link-underline` (growth
  no hover). `tailwind.config.ts` ganhou `font-serif` e `font-mono`.
  `index.html` carrega Instrument Serif + JetBrains Mono via Google
  Fonts (mesmo preconnect do Inter).
- **2026-10-04** — **Landing page pública em `/`.** Nova
  `src/pages/public/LandingPage.tsx` (lazy-loaded). `RootRedirect`
  deixa de mandar visitantes para `/login`: agora renderiza a landing;
  usuário autenticado continua indo para `/dashboard`. Atualizada a
  seção 6 (Roteamento) do CONTEXT.
- **2026-10-03** — Projeto iniciado. Fase 1 (fundação): scaffold Vite +
  React + TS + Tailwind, migrations iniciais (schema, RLS, RPC
  `book_appointment`), auth context, roteamento base, layouts
  placeholder, primitivos de UI.
- **2026-10-03** — Correção em `0001_initial_schema.sql`: ordem de
  `unaccent_coalesce` e `slugify` invertida. Funções `LANGUAGE sql`
  resolvem referências no momento do `CREATE`, então o helper precisa
  existir antes de quem o chama (`plpgsql` seria lazy; `sql` não é).
- **2026-10-03** — Adicionado `dev.sh` para iniciar o projeto com
  validações (Node 18+, `.env.local` presente e sem placeholders,
  dependências, typecheck). Flags: `NO_TYPECHECK=1`, `NO_INSTALL=1`.
- **2026-10-03** — Fase 2 parcial: service layer (`src/services/*`),
  hooks de query (`src/hooks/queries/*`), primitivos `Textarea` e
  `Switch`, e três páginas em `/dashboard/configuracoes` (perfil,
  horários, agendamento). Convenção reforçada: páginas não importam
  `supabase` direto — passam por services + hooks.
- **2026-10-03** — Signup detecta e-mail já cadastrado (via `error`
  explícito do Supabase ou via `data.user.identities = []` do fluxo
  anti-enumeration) e oferece "Entrar nessa conta" (com e-mail
  pré-preenchido no login) ou "Usar outro e-mail" (reinicia o form).
  `AuthContext.signUp` agora retorna `{ alreadyRegistered: boolean }`.
- **2026-10-03** — Novos guards de rota: `RootRedirect` manda `/`
  para `/dashboard` ou `/login` conforme sessão; `GuestOnlyRoute`
  impede usuários autenticados de verem `/login`, `/signup`,
  `/forgot-password` (redireciona para `/dashboard`). Corrige o bug
  em que "voltar para o início" após 404 jogava usuário autenticado
  para o login.
- **2026-10-03** — Tela "Confirme seu e-mail" reformulada em
  `src/pages/auth/components/ConfirmEmailScreen.tsx`: ícone, passos
  (caixa de entrada, spam, confirmar), botão de reenviar com
  cooldown de 60s (anti-rate-limit), opção "corrigir e-mail" que
  volta ao form sem recomeçar o nome, e tratamento de erros do
  Supabase (`rate limit` em mensagem amigável). Novo método
  `AuthContext.resendSignupEmail`.
- **2026-10-03** — Templates HTML/TXT do e-mail de confirmação em
  `supabase/email-templates/` (pt-BR, prontos para colar em Dashboard
  → Auth → Email Templates → Confirm signup). Variáveis documentadas,
  dicas de entregabilidade e nota sobre SMTP customizado para evitar
  spam. Templates adicionais (reset de senha, magic link, mudança de
  e-mail) virão em fases futuras.
- **2026-10-03** — Nova migration `0004_grants.sql`: GRANTs explícitos
  para `anon` e `authenticated`. RLS só filtra o que o GRANT permite;
  em projetos cujos *default privileges* do Supabase não "pegaram", a
  ausência de GRANT gera **HTTP 403** nas requisições autenticadas
  (sintoma visto nas páginas de configuração). `anon` só recebe
  SELECT nas tabelas expostas pela RLS pública; escritas anônimas
  continuam exclusivamente pela RPC `book_appointment`.
- **2026-10-03** — Nova migration `0005_backfill_profiles.sql`: extrai
  a lógica de provisionamento em `public.provision_profile_for_user()`
  (reutilizável e idempotente), refatora `handle_new_user` para
  delegar, e faz backfill de profile+settings+horários para qualquer
  usuário em `auth.users` sem profile. Resolve o caso de usuários
  cadastrados antes do trigger existir / funcionar corretamente.
- **2026-10-03** — Telefone BR: `src/lib/phone.ts` (normalize, format,
  validate, telLink, waLinkBR) + `PhoneInput` mascarado. ProfilePage
  valida 10/11 dígitos via zod e salva **só dígitos**. Página pública
  `/p/:slug` exibe telefone com botões "Ligar" (tel:) e "WhatsApp"
  (link `wa.me` com mensagem pré-pronta) — só se o telefone for válido.
- **2026-10-03** — **Upload real de imagens** via Supabase Storage.
  Migrations novas: `0006_portfolio.sql` (tabela `portfolio_items` com
  RLS pública/privada + GRANTs) e `0007_storage.sql` (buckets
  `avatars` 2MB e `portfolio` 5MB, com `allowed_mime_types` e policies
  por `professional_id` no prefixo do path). Services novos:
  `storage.ts` (upload/delete + validação de tipo/tamanho),
  `avatar.ts` (replace/remove com cleanup do blob antigo),
  `portfolio.ts` (list/add/update/delete). Primitivos: `AvatarUpload`
  (circular com preview) e `FileDrop` (drag-and-drop). ProfilePage
  substitui o campo URL por upload real. Nova página
  `/dashboard/portfolio` com grid, upload com título/descrição, edição
  e remoção. Menu lateral ganha "Portfólio".
- **2026-10-03** — **Redesign `/p/:slug` como portfólio.** Hero com
  faixa de gradiente, avatar grande (28/32), tipografia editorial.
  Nova seção de galeria em grid 2/3 colunas com overlay de título e
  lightbox fullscreen (dialog manual com Esc/clique no fundo).
  Serviços agora como lista agrupada (`divide-y`) em vez de cards
  separados. CTA sticky "Agendar horário" com gradiente de fundo que
  dá fade sobre o conteúdo.
- **2026-10-03** — Ajuste de layout desktop em `/p/:slug`. Container
  ampliado para `max-w-6xl`, hero com padding generoso e avatar
  40×40 em `lg`, galeria em `2/3/4` colunas, serviços em grid
  `md:grid-cols-2` (voltam a ser cards). CTA sticky com largura
  própria (`max-w-xl`) para não ocupar toda a tela — antes o
  gradiente delatava uma coluna estreita no centro do desktop.
- **2026-10-03** — Granularidade dos slots passa a ser a **duração do
  serviço** (migration `0009_slot_interval_by_service.sql` recria
  `get_available_slots`). Antes era `default_interval_minutes` das
  settings, o que gerava slots lógicos sobrepostos (filtrados depois
  pela checagem de colisão). Agora o passo = `service.duration_minutes`
  → slots consecutivos nunca se tocam. Coluna
  `booking_settings.default_interval_minutes` mantida no banco mas
  escondida da UI de settings — reservada para futuro "buffer entre
  atendimentos".
- **2026-10-03** — **Multi-serviço por agendamento.** Migration
  `0010_multi_service.sql`: nova tabela `appointment_services` (N:M
  com snapshot de preço/duração), colunas `appointments.total_price_cents`
  e `total_duration_minutes` (somas pré-calculadas no momento da
  reserva), backfill para dados existentes, RLS e GRANTs. Ambas as
  RPCs (`book_appointment` e `get_available_slots`) reescritas para
  receber `uuid[]`; o passo de disponibilidade vira a soma das
  durações. `appointments.service_id` continua apontando para o
  primeiro serviço (consulta rápida sem join). BookingFlow ganhou
  step de **seleção múltipla** (toggle checkbox-like, rodapé fixo com
  totais), e o resumo/sucesso listam todos os serviços escolhidos.
  Trocar os serviços invalida data+slot já escolhidos (duração total
  mudou).
- **2026-10-04** — **Fase 7 (refino) — primeira leva.**
  - **Dashboard home com stats reais**: novo `services/dashboard-stats.ts`
    + hook `useDashboardStats`. 4 queries paralelas (hoje,
    próximos 7 dias, mês atual, total de clientes) usando `count: 'exact'`
    e `head: true` quando possível para não puxar linhas desnecessárias.
    `DashboardHomePage` reescrita com saudação dinâmica (bom
    dia/tarde/noite), 4 StatCards (hoje + faturamento previsto,
    próximos 7 dias, clientes totais, faturamento concluído do mês)
    e grid de 4 atalhos (agenda, serviços, portfólio, produtos).
  - **Lazy loading por rota**: `AppRoutes` agora usa `React.lazy()`
    + `Suspense` para páginas de dashboard e públicas. Páginas de
    auth continuam estáticas (primeiro carregamento sem flash).
    Visitante que abre `/p/:slug` nunca baixa o bundle do dashboard
    e vice-versa.
  - **ErrorBoundary global**: novo `components/ErrorBoundary.tsx`
    envolve toda a aplicação em `App.tsx`. Qualquer throw em
    render agora vira tela amigável com botões "Tentar de novo"
    (reset do boundary) e "Recarregar página", em vez de tela
    branca. Loga o erro no console.
- **2026-10-04** — Após criar agendamento no `BookingFlow`, o cliente
  **é redirecionado** para `/p/:slug/a/:token?created=1` em vez de ver
  tela de sucesso no modal. O modal fecha, a URL do agendamento vira
  o navegador (favoritar, compartilhar, voltar depois). Novo
  `CreatedBanner` aparece no topo da `AppointmentDetailPublicPage`
  quando o query param `?created=1` está presente, com botão
  **Copiar link** e botão de fechar (remove o param via
  `useSearchParams`). Passo "success" e componente `SuccessStep` do
  `BookingFlow` removidos.
- **2026-10-04** — **Cancelamento pelo cliente via link único.**
  Migration `0017_cancel_token.sql`: nova coluna
  `appointments.cancel_token` (UUID único) com backfill. Duas RPCs
  públicas: `get_appointment_by_token(slug, token)` devolve a visão
  do agendamento (checa que o token pertence ao slug para evitar
  enumeration cross-tenant) e `cancel_appointment_by_token(slug, token)`
  respeita `cancellation_enabled` + `cancellation_deadline_minutes`.
  Códigos de erro novos: `not_found`, `not_cancellable`,
  `cancellation_disabled`, `cancel_deadline_passed`. `book_appointment`
  devolve `cancel_token` junto com `appointment_id`. Nova rota
  pública `/p/:slug/a/:token` em `AppointmentDetailPublicPage` com
  status, serviços (snapshot), contato do profissional (tel/WhatsApp),
  botão **Cancelar** respeitando as regras do settings. Tela de
  sucesso do `BookingFlow` exibe o link com **Copiar/Abrir** e aviso
  "Guarde este link".
- **2026-10-04** — Migration `0016_restore_require_confirmation.sql`
  **reverte** a 0015: `book_appointment` volta a respeitar
  `booking_settings.require_confirmation`. **Default da coluna muda
  para `TRUE`** — novos profissionais começam exigindo confirmação
  manual (coerente com a UX desejada), mas podem desligar pelo toggle
  (que volta à UI). Profissionais existentes mantêm o valor que já
  tinham (`ALTER DEFAULT` só afeta INSERTs futuros).
- **2026-10-04** — **Agendamento público agora sempre entra como
  `pending`**, independentemente de `booking_settings.require_confirmation`.
  Profissional confirma depois pelo dashboard. Migration
  `0015_public_booking_always_pending.sql` recria `book_appointment`
  com `status = 'pending'` fixo. Toggle "Exigir confirmação manual"
  removido da UI de settings (coluna no banco permanece, sem efeito).
  BookingFlow passa `requireConfirmation={true}` fixo para o
  texto/aviso refletirem a regra. **Agendamentos manuais** criados
  pelo profissional (`admin_create_appointment`) continuam podendo
  escolher o status via a página `/dashboard/agenda/novo`.
- **2026-10-04** — Agendamento manual migrado de Dialog para
  **página dedicada** em `/dashboard/agenda/novo` (query param `?date`
  pré-fill do dia selecionado). Layout 2 colunas (form + sidebar
  resumo/CTA sticky no desktop). Novos recursos: **sugestões de
  horários livres** via `get_available_slots` (opcional — toggle),
  **seleção de status inicial** (confirmado / pendente), resumo
  completo com totais calculados ao vivo. `NewAppointmentDialog`
  removido.
- **2026-10-04** — Validações no agendamento manual. Migration
  `0014_admin_create_validations.sql`: `start_at` precisa ser
  `>= now()` (tolerância de 1min) — novo código de erro
  `start_in_past`. Frontend complementar: input de data com `min=hoje`;
  horário com `min=agora` quando a data é hoje; validação local antes
  de enviar; mensagens de erro passam a logar o erro real no console
  e sugerem rodar a migration faltante se a RPC não existir.
- **2026-10-04** — Produtos ativos agora aparecem na página pública
  `/p/:slug` em seção dedicada (grid 2/3/4 cols) com imagem, nome,
  descrição e preço. Badge "Esgotado" quando `stock = 0`.
  `getPublicProfessional` passou a trazer `products: Product[]` junto.
- **2026-10-04** — **Fase 4 — criação manual de agendamento.**
  Migration `0013_admin_create_appointment.sql` cria RPC
  `admin_create_appointment` (SECURITY DEFINER com verificação do
  `current_professional_id()`). Aceita cliente existente ou payload
  para criar; **não valida business_hours** (profissional pode
  encaixar fora do expediente), mas EXCLUDE constraint continua
  barrando conflitos. Novo `services/appointments.ts/createAppointmentManual`
  encapsula a chamada. Componentes novos:
  `ClientPicker` (busca cliente existente com dropdown ou alterna
  para "novo cliente") e `NewAppointmentDialog` (seleção de cliente,
  múltiplos serviços com toggle, data e hora livres, observações,
  resumo com totais). Botão "Novo agendamento" na `AgendaPage`,
  usando a data selecionada como pré-fill.
- **2026-10-04** — **Fase 6 — produtos.** Migration
  `0012_products_bucket.sql` cria bucket `products` (5MB, mesma
  convenção dos outros). Novo `services/products.ts` com CRUD
  completo (`listProducts`, `createProduct`, `updateProduct` com
  substituição/remoção de imagem, `toggleProductActive`,
  `deleteProduct` com limpeza do blob). `services/storage.ts` ganhou
  `products` na `UploadBucket` + mapa `MAX_BY_BUCKET`. Hook
  `useProducts`. Página `/dashboard/produtos` com grid responsivo
  (2/3 cols), card por produto com imagem/fallback de ícone, badge
  "inativo", preço, estoque com alerta visual (sem estoque /
  baixo ≤ 3), switch de ativo e botões editar/excluir. `ProductForm`
  em Dialog com upload de imagem (preview, trocar, remover), preço
  em `CurrencyInput`, estoque numérico, SKU opcional e toggle ativo.
  Rota `/dashboard/produtos` conectada.
- **2026-10-04** — **Fase 5 — clientes.** Novo `services/clients.ts`
  com `listClients` (join com appointments para calcular stats por
  cliente no frontend), `getClient` (histórico completo com serviços
  snapshot) e `updateClientNotes`. Hooks `useClients` e `useClient`.
  Nova página `/dashboard/clientes` (lista com busca por
  nome/telefone/email, dígitos normalizados; mostra nome, contato,
  contagem, último atendimento e total gasto). Nova página
  `/dashboard/clientes/:id` com cabeçalho + botões `tel:`/WhatsApp,
  4 cards de stats (agendamentos, concluídos, total gasto,
  primeiro/último), bloco de **observações privadas** com salvar
  inline, e histórico ordenado desc (data, serviços, status, totais
  e observações do agendamento se houver). Reusa `StatusChip` da
  Fase 4.2. Agregação feita no cliente — para listas grandes,
  migrar para view/RPC no futuro.
  agendamentos `completed` passam a bloquear o slot (não liberam para
  nova reserva). Afeta EXCLUDE constraint e filtro de conflito da RPC
  de slots. Apenas `cancelled` e `no_show` liberam o horário.
  Frontend complementar: botões **Concluir** e **Não compareceu** só
  habilitam após `end_at <= now()` — evita baixa precoce com texto
  explicativo quando ainda não acabou.
- **2026-10-04** — Fix no `AgendaPage`: o Dialog de detalhes recebia
  o appointment como snapshot (via `useState<AppointmentDetails>`), e
  depois de mudar o status, a prop ficava desatualizada → botões
  continuavam habilitados com o status antigo. Agora o state guarda
  apenas `openedId: string | null` e o appointment é derivado da query
  a cada render (`appointments.find(a => a.id === openedId)`). Após a
  invalidation, o dialog reflete o status novo automaticamente.
- **2026-10-04** — **Fase 4.2 — agenda do profissional.** Novo
  `services/appointments.ts` com `listAppointmentsRange` (join com
  `clients` + `appointment_services` + `services`) e
  `updateAppointmentStatus`. Hook `useAppointmentsRange` com cache
  por `(professional, from, to)`. Nova página `/dashboard/agenda`
  com `MiniCalendar` mensal (marca dias com agendamento, nav de mês,
  botão "Hoje") + lista do dia selecionado com cliente, resumo de
  serviços, horário e totais. Dialog `AppointmentDetailsDialog` com
  dados do cliente (botões `tel:` e WhatsApp), lista de serviços
  (snapshot), observações e ações contextuais de status
  (confirmar/concluir/não compareceu/cancelar — este último via
  `ConfirmDialog`). `StatusChip` reusável com paleta por estado.
  Criação manual fica para a próxima iteração.
- **2026-10-03** — Fix: forms dentro do `Dialog` (`<dialog>` nativo)
  precisam ser renderizados condicionalmente (`{open && <Form/>}`) ou
  via `key`. O dialog nativo só esconde visualmente — os children
  continuam montados, mantendo state do form entre aberturas. Aplicado
  em `ServicesPage` (form de serviço) e `PortfolioPage` (editar item).
- **2026-10-03** — **Fase 4.1 — fluxo público de agendamento.**
  Nova migration `0008_available_slots.sql` com RPC
  `get_available_slots(slug, service_id, date)` (`SECURITY DEFINER`,
  retorna só timestamps livres). Services: `booking.ts` com
  `getAvailableSlots` e `bookAppointment` (traduzindo códigos de
  erro via `BOOKING_ERROR_LABEL`). Novo hook `useAvailableSlots`.
  Componente `BookingFlow` (stepper em Dialog) com passos
  Serviço → Quando (DateStrip horizontal + SlotsGrid) → Dados
  (nome/telefone/email/notas, usando `PhoneInput`) → Sucesso
  (confirmado ou pendente, conforme `require_confirmation`).
  Botão sticky "Agendar horário" na `/p/:slug` agora abre o fluxo.
  Após fechar, invalida o cache do profissional via `refetch()`.
- **2026-10-03** — **Fase 3 concluída**. Novidades:
  - `services/services.ts` + `useServices` — CRUD completo (list,
    create, update, toggleActive, delete) com tratamento de FK
    violation em delete (serviço com agendamentos sugere desativar
    em vez de excluir).
  - Primitivos: `Dialog` (sobre `<dialog>` nativo — foco trap, Esc,
    backdrop sem dep nova), `ConfirmDialog`, `CurrencyInput` (BRL,
    guarda centavos int).
  - Página `/dashboard/servicos`: lista com switch ativo/inativo,
    edição e exclusão via dialog, empty state, estados de loading.
  - `services/public-profile.ts` + `usePublicProfessional` — busca
    profile + settings + serviços ativos por slug (chave anon, RLS
    pública).
  - Página `/p/:slug`: hero (avatar, nome, bio, cidade), lista de
    serviços com preço/duração, botão sticky "Agendar" (placeholder
    para Fase 4), estados loading/404/sem-serviços. SEO dinâmico
    via novo `useDocumentHead` (title, description, OG tags).
