// Clientes Supabase para edge functions.
//
// `serviceClient()`: bypassa RLS, usado nos webhooks e para gravar
// `plans.gateway_plan_id`. NUNCA exposto ao frontend.
//
// `userClient(authHeader)`: respeita RLS do caller. Usado para checar
// permissões (ex.: "o caller é admin elevado?") antes de operar.

// Import direto por URL — o runtime das edge functions do Supabase
// não resolve o imports map do deno.json ao bundlear. Usar esm.sh
// é o padrão recomendado nas docs oficiais.
import {
  createClient,
  type SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function userClient(authorizationHeader: string | null): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL ou SUPABASE_ANON_KEY ausentes')
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: authorizationHeader ? { Authorization: authorizationHeader } : {},
    },
  })
}
