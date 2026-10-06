// Headers CORS compartilhados por todas as edge functions chamadas
// pelo frontend. O webhook do MP não precisa (chamado server-to-server).

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ status: 'error', error }, status)
}
