# Minha Agenda

SaaS de agendamento para profissionais autônomos (barbeiros,
cabeleireiros, nail designers, esteticistas, tatuadores, personal
trainers etc).

> **Antes de qualquer coisa, leia o [CONTEXT.md](./CONTEXT.md).**
> Ele é o documento mestre: arquitetura, schema, RLS, convenções e
> fases. Toda mudança no projeto exige atualização correspondente no
> CONTEXT.md.

## Stack

React + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query +
React Router + Supabase (Postgres, Auth, RLS, Edge Functions).

## Setup

Caminho rápido com validações automáticas (recomendado):

```bash
./dev.sh
```

O script checa Node 18+, cria `.env.local` a partir de `.env.example` se
faltar, recusa valores placeholder, instala dependências se necessário,
roda `typecheck` e sobe o Vite.

Flags úteis:

- `NO_TYPECHECK=1 ./dev.sh` — pula o typecheck
- `NO_INSTALL=1 ./dev.sh` — não roda `npm install` automaticamente

Setup manual (equivalente):

```bash
cp .env.example .env.local
# preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run typecheck
npm run dev
```

## Banco de dados

As migrations SQL estão em `supabase/migrations/` e devem ser aplicadas
na ordem (via Supabase CLI ou pelo SQL Editor do dashboard):

1. `0001_initial_schema.sql` — tabelas, enums, triggers, EXCLUDE
   constraint
2. `0002_rls_policies.sql` — RLS habilitado e policies
3. `0003_booking_rpc.sql` — RPC `book_appointment` (SECURITY DEFINER)

## Scripts

| Comando           | O que faz                           |
| ----------------- | ----------------------------------- |
| `npm run dev`     | Dev server Vite                     |
| `npm run build`   | Build de produção (typecheck + bundle) |
| `npm run preview` | Serve o build local                 |
| `npm run typecheck` | Só o TS, sem bundle               |

## Fase atual

**Fase 1 — Fundação.** Ver [CONTEXT.md §7](./CONTEXT.md#7-fases-de-desenvolvimento).
