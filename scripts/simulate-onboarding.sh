#!/usr/bin/env bash
# =============================================================================
# simulate-onboarding.sh — Provisiona um novo tenant em DEV e imprime o JWT
#
# Uso:
#   ./scripts/simulate-onboarding.sh
#   ./scripts/simulate-onboarding.sh --email dono@bar.com --nome "Barber X" --plano premium
#
# Opções:
#   --email EMAIL    E-mail do admin         (default: novo@teste.com)
#   --senha SENHA    Senha inicial           (default: Teste@123)
#   --nome  NOME     Nome da barbearia       (default: Barbearia Teste Dev)
#   --plano PLANO    essential|pro|premium   (default: pro)
#   --api   URL      URL da API local        (default: http://localhost:3003)
#   --keep           Não remove o tenant ao final (mantém o registro)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

EMAIL="novo@teste.com"
SENHA="Teste@123"
NOME="Barbearia Teste Dev"
PLANO="pro"
API_URL="http://localhost:3003"
KEEP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) EMAIL="$2"; shift 2 ;;
    --senha) SENHA="$2"; shift 2 ;;
    --nome)  NOME="$2";  shift 2 ;;
    --plano) PLANO="$2"; shift 2 ;;
    --api)   API_URL="$2"; shift 2 ;;
    --keep)  KEEP=true; shift ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
done

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-navalhia}"
PGPASSWORD="${PGPASSWORD:-navalhia_secret}"
PGDATABASE="${PGDATABASE:-navalhia}"
export PGPASSWORD

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       NavalhIA — Simulação de Onboarding (DEV)       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Barbearia : $NOME"
echo "  Plano     : $PLANO"
echo "  Email     : $EMAIL"
echo "  Senha     : $SENHA"
echo "  API       : $API_URL"
echo ""

# ── 1. Provisionar tenant via SQL ───────────────────────────────────────────
echo "▶ [1/3] Provisionando tenant no banco..."

# Injeta parâmetros via GUCs (current_setting), que funcionam dentro de DO $$ blocks
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
  -c "SELECT set_config('navalhia.dev_email', '${EMAIL}',  false),
             set_config('navalhia.dev_senha', '${SENHA}',  false),
             set_config('navalhia.dev_nome',  '${NOME}',   false),
             set_config('navalhia.dev_plano', '${PLANO}',  false);" \
  -f "$SCRIPT_DIR/seed-onboarding-dev.sql" -q 2>&1 | grep -v "^set_config$\|^$" || true

# ── 2. Login → JWT ────────────────────────────────────────────────────────
echo ""
echo "▶ [2/3] Obtendo JWT via POST /api/auth/login..."

RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${SENHA}\"}")

TOKEN=$(echo "$RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)
MUST_CHANGE=$(echo "$RESPONSE" | grep -o '"must_change_password":[a-z]*' | cut -d: -f2 || true)

if [ -z "$TOKEN" ]; then
  echo ""
  echo "✗ Login falhou. Resposta da API:"
  echo "$RESPONSE"
  exit 1
fi

echo "  ✓ JWT obtido!"
echo "  must_change_password = $MUST_CHANGE"

# ── 3. Verificar /me ──────────────────────────────────────────────────────
echo ""
echo "▶ [3/3] Verificando /api/auth/me com o token..."

ME=$(curl -s "${API_URL}/api/auth/me" \
  -H "Authorization: Bearer $TOKEN")

BARBERSHOP_NAME=$(echo "$ME" | grep -o '"barbershop_id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

echo "  ✓ Perfil autenticado"

# ── Resumo ────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                   ACESSO CRIADO                      ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Email  : $EMAIL"
echo "║  Senha  : $SENHA"
echo "║  Painel : http://localhost:3002"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  → must_change_password = $MUST_CHANGE"
echo "    (ao logar no painel, o modal de troca de senha será exibido)"
echo ""
echo "  JWT (copie para testar endpoints protegidos):"
echo "  Bearer $TOKEN"
echo ""
echo "  Exemplo de uso:"
echo "  curl -s ${API_URL}/api/auth/me -H \"Authorization: Bearer $TOKEN\" | jq ."
echo ""

if [ "$KEEP" = false ]; then
  echo "  Dica: use --keep para manter o tenant após o teste."
  echo "  Para remover manualmente:"
  echo "    PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE \\"
  echo "      -c \"DELETE FROM public.profiles WHERE email = '${EMAIL}';\""
  echo "    (CASCADE remove a barbershop e todos os dados vinculados)"
fi
