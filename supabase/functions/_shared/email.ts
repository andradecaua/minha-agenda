// Envio de email transacional via SMTP (edge functions).
//
// Agnóstico de provedor: funciona com qualquer SMTP (Gmail hoje,
// Resend amanhã) — basta ajustar os secrets. Variáveis esperadas:
//
//   SMTP_HOST     ex.: smtp.gmail.com | smtp.resend.com
//   SMTP_PORT     ex.: 465 (SSL implícito) ou 587 (STARTTLS)
//   SMTP_USER     login SMTP
//   SMTP_PASS     senha SMTP (no Gmail: "App Password")
//   SMTP_FROM     opcional; default = SMTP_USER
//   SMTP_FROM_NAME opcional; nome amigável do remetente
//
// Para Gmail: ativar 2FA na conta → criar App Password → usar como
// SMTP_PASS. Senha normal NÃO funciona.

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const host = Deno.env.get('SMTP_HOST')
  const portStr = Deno.env.get('SMTP_PORT') ?? '465'
  const user = Deno.env.get('SMTP_USER')
  const pass = Deno.env.get('SMTP_PASS')
  const fromAddr = Deno.env.get('SMTP_FROM') ?? user
  const fromName = Deno.env.get('SMTP_FROM_NAME') ?? 'Minha Agenda'

  if (!host || !user || !pass || !fromAddr) {
    throw new Error('smtp_config_missing')
  }

  const port = Number(portStr)
  if (!Number.isFinite(port)) throw new Error('smtp_port_invalid')

  // Convenção comum: 465 = TLS implícito; 587 = STARTTLS.
  // denomailer trata `tls: true` como implícito. Para STARTTLS,
  // deixar `tls: false` que a lib faz o upgrade automaticamente.
  const client = new SMTPClient({
    connection: {
      hostname: host,
      port,
      tls: port === 465,
      auth: { username: user, password: pass },
    },
  })

  try {
    await client.send({
      from: `${fromName} <${fromAddr}>`,
      to: opts.to,
      subject: opts.subject,
      content: opts.text ?? stripHtml(opts.html),
      html: opts.html,
    })
  } finally {
    await client.close()
  }
}

/** Fallback mínimo: remove tags HTML pro conteúdo text/plain. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
