#!/usr/bin/env bash
# =============================================================
# dev.sh — Minha Agenda
# -------------------------------------------------------------
# Faz as validações mínimas antes de subir o dev server:
#   1. Node 18+ instalado
#   2. .env.local existe (cria a partir de .env.example se não)
#   3. VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY preenchidos
#      (recusa valores placeholder do .env.example)
#   4. node_modules presente (roda npm install se faltar)
#   5. Typecheck (npm run typecheck) — opcional via NO_TYPECHECK=1
#   6. Inicia o Vite (npm run dev)
#
# Uso:
#   ./dev.sh                 → tudo
#   NO_TYPECHECK=1 ./dev.sh  → pula typecheck
#   NO_INSTALL=1 ./dev.sh    → não roda npm install automaticamente
# =============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# --- Cores (desligadas se stdout não for TTY) ----------------
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_DIM=$'\033[2m';   C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_DIM=''; C_RESET=''
fi

info()  { printf '%s[info]%s  %s\n'  "$C_BLUE"   "$C_RESET" "$1"; }
ok()    { printf '%s[ ok ]%s  %s\n'  "$C_GREEN"  "$C_RESET" "$1"; }
warn()  { printf '%s[warn]%s  %s\n'  "$C_YELLOW" "$C_RESET" "$1"; }
die()   { printf '%s[fail]%s  %s\n'  "$C_RED"    "$C_RESET" "$1" >&2; exit 1; }

# --- 1. Node -------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js não encontrado no PATH. Instale Node 18+ e tente de novo."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node 18+ é necessário (versão atual: $(node -v))."
fi
ok "Node $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm não encontrado no PATH."

# --- 2. .env.local -------------------------------------------
if [ ! -f .env.local ]; then
  if [ -f .env.example ]; then
    cp .env.example .env.local
    warn ".env.local não existia — criei a partir de .env.example."
    warn "Abra o arquivo e preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY antes de continuar."
    exit 1
  else
    die ".env.local ausente e .env.example também. Veja o CONTEXT.md."
  fi
fi
ok ".env.local presente"

# --- 3. Variáveis obrigatórias -------------------------------
# Lê sem exportar nada no shell atual (segurança + não poluir ambiente).
get_env() {
  # grep da chave + corte do valor, tolerando aspas e espaços.
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" .env.local | tail -n1 || true)"
  if [ -z "$line" ]; then
    printf ''
    return
  fi
  local val="${line#*=}"
  # trim aspas e espaços
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  printf '%s' "$val"
}

check_var() {
  local name="$1"
  local placeholder_pattern="$2"
  local val
  val="$(get_env "$name")"
  if [ -z "$val" ]; then
    die "$name não está definido em .env.local"
  fi
  if printf '%s' "$val" | grep -Eq "$placeholder_pattern"; then
    die "$name ainda contém o valor placeholder de .env.example. Preencha com o valor real do seu projeto Supabase."
  fi
}

check_var VITE_SUPABASE_URL      '^https://SEU-PROJETO\.supabase\.co$'
check_var VITE_SUPABASE_ANON_KEY '^SUA_CHAVE_ANON$'

# Sanity extra: URL deve começar com https://
if ! printf '%s' "$(get_env VITE_SUPABASE_URL)" | grep -Eq '^https://.+\.supabase\.(co|in)$'; then
  warn "VITE_SUPABASE_URL não parece um endpoint Supabase válido (esperado: https://xxxxx.supabase.co)"
fi
ok "Variáveis Supabase preenchidas"

# --- 4. Dependências -----------------------------------------
if [ ! -d node_modules ]; then
  if [ "${NO_INSTALL:-0}" = "1" ]; then
    die "node_modules ausente e NO_INSTALL=1 — rode 'npm install' manualmente."
  fi
  info "Instalando dependências (npm install)..."
  npm install
  ok "Dependências instaladas"
else
  # package.json mais novo que node_modules → provável mudança de deps
  if [ package.json -nt node_modules ] && [ "${NO_INSTALL:-0}" != "1" ]; then
    warn "package.json foi modificado após o último install — rodando npm install..."
    npm install
  fi
  ok "node_modules presente"
fi

# --- 5. Typecheck --------------------------------------------
if [ "${NO_TYPECHECK:-0}" = "1" ]; then
  warn "Typecheck pulado (NO_TYPECHECK=1)"
else
  info "Rodando typecheck..."
  if npm run -s typecheck; then
    ok "Typecheck ok"
  else
    die "Typecheck falhou. Corrija os erros ou rode com NO_TYPECHECK=1 para pular."
  fi
fi

# --- 6. Dev server -------------------------------------------
printf '\n%s[dev ]%s  Iniciando Vite...%s\n\n' "$C_GREEN" "$C_DIM" "$C_RESET"
exec npm run dev
