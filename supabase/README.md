# Supabase — Minha Agenda

Migrations em ordem numérica. Aplicação:

## Via Supabase CLI (recomendado)

```bash
# com o Supabase CLI configurado e logado:
supabase db push
```

## Via SQL Editor (dashboard)

Copie e execute o conteúdo de cada arquivo em `migrations/` na ordem:

1. `0001_initial_schema.sql` — tabelas, enums, triggers,
   EXCLUDE constraint para prevenir conflito de agendamento.
2. `0002_rls_policies.sql` — habilita RLS e cria todas as policies.
3. `0003_booking_rpc.sql` — RPC `book_appointment` usada pelo fluxo
   público (SECURITY DEFINER).
4. `0004_grants.sql` — GRANTs explícitos para `anon` e `authenticated`.
   Sem isso, projetos cujos *default privileges* não "pegaram"
   respondem **HTTP 403** mesmo com RLS correto.
5. `0005_backfill_profiles.sql` — Extrai o provisionamento em
   `provision_profile_for_user()`, refatora `handle_new_user` para
   delegar, e cria profile + settings + horários default para
   qualquer usuário em `auth.users` que ainda não tenha. Idempotente —
   seguro rodar várias vezes.
6. `0006_portfolio.sql` — Tabela `portfolio_items` + RLS pública (SELECT)
   e privada (ALL por dono) + GRANTs.
7. `0007_storage.sql` — Buckets `avatars` (2MB) e `portfolio` (5MB)
   com `allowed_mime_types` restrito a JPG/PNG/WEBP. Policies
   em `storage.objects`: SELECT público; INSERT/UPDATE/DELETE
   apenas quando o primeiro segmento do path é o `professional_id`
   do usuário autenticado (`(storage.foldername(name))[1]`).
8. `0008_available_slots.sql` — RPC `get_available_slots(slug, service_id, date)`
   `setof timestamptz`. Calcula horários livres respeitando
   business_hours (com timezone do profissional), duração do serviço,
   intervalo padrão, antecedência min/max e conflitos com
   appointments ativos. `SECURITY DEFINER` — expõe só o início de
   cada slot, nunca os dados de agendamentos existentes.
9. `0009_slot_interval_by_service.sql` — Recria `get_available_slots`
   usando a **duração do serviço** como passo (antes era
   `default_interval_minutes`). Slots consecutivos nunca se sobrepõem
   logicamente.
10. `0010_multi_service.sql` — Multi-serviço por agendamento. Adiciona
    `appointment_services` (N:M com snapshot), `appointments.total_*`,
    backfill, RLS e GRANTs. Reescreve `book_appointment` e
    `get_available_slots` para receber `uuid[]`. **Drop** das
    assinaturas antigas (`uuid` único) — se seu código chamar as RPCs
    com a assinatura antiga, falhará; esta migration só com código
    novo (0010 em diante).
11. `0011_completed_blocks_slot.sql` — Agendamentos `completed` passam
    a ocupar o horário (não liberam o slot). Altera a EXCLUDE
    constraint e o filtro de conflito da RPC de slots para incluir
    `completed` junto com `pending`/`confirmed`.
12. `0012_products_bucket.sql` — Novo bucket público `products` (5MB,
    JPG/PNG/WEBP) com policies por prefixo `professional_id`,
    coerente com `avatars`/`portfolio`.
13. `0013_admin_create_appointment.sql` — RPC
    `admin_create_appointment(service_ids[], start_at, client_id?,
    client_name?, client_phone?, client_email?, notes?, status?)`
    para criação manual pelo profissional. Autenticada (checa
    `current_professional_id()`), aceita cliente existente ou
    cria/atualiza por telefone, não exige `online_booking_enabled`
    nem respeita business_hours (profissional pode encaixar). EXCLUDE
    constraint continua barrando conflitos.
14. `0014_admin_create_validations.sql` — recria
    `admin_create_appointment` adicionando validação de
    `start_at >= now()` (código de erro `start_in_past`).
15. `0015_public_booking_always_pending.sql` — todo agendamento feito
    pelo cliente via RPC pública entra como `pending`, independente
    do `booking_settings.require_confirmation`. Coluna fica no banco
    para compat mas deixa de ser consultada; o toggle da UI foi
    removido.
16. `0016_restore_require_confirmation.sql` — **reverte** o 0015:
    `book_appointment` volta a respeitar `require_confirmation`.
    Default da coluna muda para `TRUE` (novos profissionais começam
    exigindo confirmação); profissionais existentes mantêm o valor
    que já tinham. Toggle volta à UI.
17. `0017_cancel_token.sql` — Cancelamento pelo cliente via link
    único. Adiciona `appointments.cancel_token UUID` (único, default
    `gen_random_uuid()`), com backfill. Novas RPCs:
    `get_appointment_by_token(slug, token)` e
    `cancel_appointment_by_token(slug, token)` (SECURITY DEFINER,
    checam slug + flags `cancellation_enabled` e
    `cancellation_deadline_minutes`). `book_appointment` passa a
    devolver `cancel_token`.

## Templates de e-mail

O conteúdo pronto dos e-mails transacionais do Supabase Auth está em
[`email-templates/`](./email-templates/README.md). Aplicação é manual no
dashboard (não há como versionar via SQL).

## Pontos de atenção

- **`btree_gist`** é necessário para a `EXCLUDE` constraint em
  `appointments`. Deve estar disponível em projetos Supabase.
- A trigger `on_auth_user_created` cria `profile`, `booking_settings` e
  horários default assim que um usuário se registra. Garanta que o
  schema `auth` existe antes de rodar — ele sempre existe em projetos
  Supabase.
- Em nenhum momento essas migrations assumem acesso a tabelas
  específicas do dashboard do Supabase; são SQL Postgres puro.
