// Wrapper mínimo da API do Mercado Pago usada pelas edge functions.
//
// Modelo: Checkout Preference ("pagamento por período"). Cada compra
// cria uma Preference nova, o user paga via Pix / cartão / boleto no
// checkout hospedado, e o webhook `payment.updated` nos avisa quando
// a cobrança é aprovada. Preapproval (débito recorrente em cartão)
// NÃO é usado porque não aceita Pix.
//
// Endpoints usados:
//   POST /checkout/preferences  — cria a sessão de checkout
//   GET  /v1/payments/{id}      — detalhe de pagamento (payload do webhook)
//
// Doc: https://www.mercadopago.com.br/developers/pt/reference

const MP_BASE = 'https://api.mercadopago.com'

function accessToken(): string {
  const token = Deno.env.get('MP_ACCESS_TOKEN')
  if (!token) throw new Error('MP_ACCESS_TOKEN não configurado')
  return token
}

async function mpFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${MP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `MP ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 500)}`,
    )
  }
  return text ? (JSON.parse(text) as T) : (null as unknown as T)
}

// =============================================================
// Checkout Preference (sessão de pagamento)
// -------------------------------------------------------------
// `init_point` é a URL do checkout hospedado. O `back_urls.success`
// recebe o usuário de volta após pagar. `auto_return: approved` faz
// o retorno automático só quando o pagamento é aprovado.
// =============================================================
export interface PreferenceInput {
  title: string          // "Minha Agenda — Plano Pro"
  description?: string   // texto que aparece na tela do MP
  amountCents: number    // valor em centavos
  externalReference: string
  backUrlBase: string    // ex.: https://app.exemplo.com/dashboard
  notificationUrl?: string // webhook por-preference; mais confiável em test mode
  payerEmail?: string    // opcional; MP coleta na tela se omitido
  currencyId?: 'BRL'
}

export interface PreferenceResponse {
  id: string
  init_point: string
  sandbox_init_point?: string
  items?: Array<{ title: string; unit_price: number }>
  external_reference?: string | null
}

export async function createPreference(
  input: PreferenceInput,
): Promise<PreferenceResponse> {
  const body: Record<string, unknown> = {
    items: [
      {
        title: input.title,
        description: input.description,
        quantity: 1,
        currency_id: input.currencyId ?? 'BRL',
        unit_price: input.amountCents / 100,
      },
    ],
    external_reference: input.externalReference,
    back_urls: {
      success: `${input.backUrlBase}?checkout=success`,
      pending: `${input.backUrlBase}?checkout=pending`,
      failure: `${input.backUrlBase}?checkout=failure`,
    },
    auto_return: 'approved',
    // ATENÇÃO: NÃO use `binary_mode: true` aqui.
    //   - Pix e boleto começam como `pending` (QR fica aberto até
    //     o pagador escanear).
    //   - `binary_mode: true` filtra métodos pending → tira Pix e
    //     boleto da tela do checkout, deixando só cartão.
    // Nossa webhook já lida bem com estados: só ativa em `approved`,
    // ignora `pending`/`rejected` (apenas audita).
    //
    // `statement_descriptor` aparece na fatura do cartão.
    statement_descriptor: 'MINHA AGENDA',
  }

  if (input.notificationUrl) {
    // Webhook por-preference. Em test mode, o MP não dispara o webhook
    // global de forma confiável; o notification_url explícito aqui
    // garante que a função mercadopago-webhook seja chamada após o
    // pagamento. Em prod, serve de fallback — se o global falhar, este
    // ainda roda.
    body.notification_url = input.notificationUrl
  }

  if (input.payerEmail) {
    body.payer = { email: input.payerEmail }
  }

  return mpFetch('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// =============================================================
// Pagamento (webhook payment.updated → GET /v1/payments/{id})
// =============================================================
export interface PaymentResponse {
  id: number | string
  status: 'pending' | 'approved' | 'authorized' | 'in_process' | 'in_mediation'
    | 'rejected' | 'cancelled' | 'refunded' | 'charged_back'
  status_detail?: string
  transaction_amount: number
  currency_id: string
  external_reference?: string | null
  payment_method_id?: string   // "pix", "visa", "bolbradesco", etc.
  payment_type_id?: string     // "credit_card", "bank_transfer", "ticket"
  date_approved?: string | null
  date_created?: string | null
  /** true = produção real; false = sandbox/credenciais de teste. */
  live_mode?: boolean
}

export async function getPayment(id: string): Promise<PaymentResponse> {
  return mpFetch(`/v1/payments/${id}`)
}

// =============================================================
// Verificação de assinatura do webhook (HMAC-SHA256).
// Doc: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks#bookmark_valida%C3%A7%C3%A3o_de_origem
//
// Em notificações via `notification_url` de Preference, o `data.id`
// pode vir **só no body** ou **só na query** dependendo da versão do
// MP. A doc oficial é ambígua. A gente tenta todas as variantes
// razoáveis — se nenhuma bater, retorna false. Em sucesso loga qual
// variante funcionou pra deixar documentado qual a MP está usando.
// =============================================================
export interface VerifyInput {
  xSignature: string | null
  xRequestId: string | null
  /** `data.id` extraído da URL query (`?data.id=...`); pode ser null. */
  idFromQuery: string | null
  /** `data.id` extraído do body JSON; pode ser null. */
  idFromBody: string | null
  secret: string
}

export async function verifyWebhookSignature(input: VerifyInput): Promise<boolean> {
  const { xSignature, xRequestId, idFromQuery, idFromBody, secret } = input
  if (!xSignature || !xRequestId) return false

  const parts = Object.fromEntries(
    xSignature.split(',').map((kv) => {
      const [k, v] = kv.split('=')
      return [k.trim(), v?.trim() ?? '']
    }),
  )
  const ts = parts.ts
  const v1 = parts.v1
  if (!ts || !v1) return false

  // Candidatos ordenados pela prevalência observada em prod.
  // 1. body: quando `notification_url` é per-preference
  // 2. query: quando é webhook global do painel (traz `?data.id=`)
  // 3. empty: alguns clientes do MP omitem o id no manifesto
  const candidates: Array<{ label: string; id: string }> = []
  if (idFromBody) candidates.push({ label: 'body', id: idFromBody })
  if (idFromQuery) candidates.push({ label: 'query', id: idFromQuery })
  candidates.push({ label: 'empty', id: '' })

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  for (const c of candidates) {
    const manifest = `id:${c.id};request-id:${xRequestId};ts:${ts};`
    const sigBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(manifest),
    )
    const computed = Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    if (computed.length === v1.length) {
      let diff = 0
      for (let i = 0; i < computed.length; i++) {
        diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i)
      }
      if (diff === 0) {
        console.log('[webhook] signature matched variant=', c.label)
        return true
      }
    }
  }

  return false
}
