# Templates de e-mail — Supabase Auth

Esses arquivos são o conteúdo pronto para colar nos templates de e-mail
do **dashboard do Supabase**. O Supabase **não** permite configurar
templates via SQL / migrations — a edição é no painel.

## Como aplicar

1. Abra o dashboard do seu projeto no Supabase.
2. Vá em **Authentication → Emails → Email Templates**.
3. Selecione o template correspondente (ver tabela abaixo).
4. Cole o conteúdo HTML no campo **Message (HTML)**.
5. Em alguns planos / regiões o Supabase também permite editar o
   **Subject** (assunto) — use o sugerido ao lado.
6. Salve.

## Templates disponíveis

| Arquivo                   | Template no Supabase    | Assunto sugerido                   |
| ------------------------- | ----------------------- | ---------------------------------- |
| `confirm-signup.html`     | **Confirm signup**      | Confirme seu e-mail · Minha Agenda |
| `confirm-signup.txt`      | fallback texto          | (idem)                             |
| `recovery.html`           | **Reset password**      | Redefinir sua senha · Minha Agenda |
| `recovery.txt`            | fallback texto          | (idem)                             |

> Mais templates (magic link, mudança de e-mail) virão quando houver
> fluxo que precise.

### Importante — `redirectTo` do recovery

Pra o template de **Reset password** funcionar sem bugar o redirect
do app, o `{{ .ConfirmationURL }}` precisa levar o usuário pra
`/reset-password` (fora do `GuestOnlyRoute`). O frontend já passa
isso em `AuthContext.sendPasswordReset()`:

```ts
supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/reset-password`,
})
```

Não precisa configurar nada manualmente no painel do Supabase além
de colar o template — o `redirectTo` é injetado pelo frontend a cada
chamada e o Supabase anexa à URL final.

## Variáveis disponíveis

O Supabase expande variáveis Go-template no corpo do e-mail. As usadas
aqui:

| Variável                  | O que é                                        |
| ------------------------- | ---------------------------------------------- |
| `{{ .ConfirmationURL }}`  | URL completa com token para confirmar o e-mail |
| `{{ .Email }}`            | E-mail do destinatário                         |
| `{{ .SiteURL }}`          | URL base configurada no projeto                |
| `{{ .Token }}` / `.TokenHash` | Token/hash puros (uso avançado)             |

Documentação oficial:
<https://supabase.com/docs/guides/auth/auth-email-templates>

## Dicas de entregabilidade

- Configure um **domínio customizado** para envio (SMTP próprio) no
  Supabase — e-mails do remetente padrão `noreply@mail.app.supabase.io`
  são mais propensos a cair em spam.
- Mantenha o preheader curto (primeira linha visível na preview).
- Evite excesso de imagens — o HTML atual é só texto estilizado, o que
  tende a passar melhor em filtros antispam.
