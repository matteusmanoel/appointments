#!/usr/bin/env bash
# Testa conectividade: health, login, API com JWT e tools com X-API-Key.
# Uso: ./scripts/test-connectivity.sh [BASE_URL]
# Ex.: ./scripts/test-connectivity.sh http://localhost:3003

set -e
BASE="${1:-http://localhost:3003}"
API_KEY="${TOOLS_API_KEY:-6ae1003dc53975cc8cf7fa441a6e7760da5262d6ee1981d0c97f5dac4e34469f}"

echo "=== 1. Health ==="
curl -s -w "\nHTTP %{http_code}\n" "$BASE/health"
echo ""

echo "=== 2. Login (POST /api/auth/login) ==="
LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@navalhia.com.br","password":"admin123"}')
if echo "$LOGIN" | grep -q '"token"'; then
  echo "OK (token received)"
  TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
else
  echo "$LOGIN"
  exit 1
fi

echo ""
echo "=== 3. GET /api/services (JWT) ==="
curl -s -w "\nHTTP %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$BASE/api/services" | head -c 300
echo "..."

echo ""
echo "=== 4. GET /api/barbers (JWT) ==="
curl -s -w "\nHTTP %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$BASE/api/barbers" | head -c 300
echo "..."

echo ""
echo "=== 5. GET /api/tools/list_services (X-API-Key) ==="
curl -s -w "\nHTTP %{http_code}\n" -H "X-API-Key: $API_KEY" "$BASE/api/tools/list_services" | head -c 400
echo "..."

echo ""
echo "=== 6. GET /api/tools/list_appointments (X-API-Key) ==="
TOMORROW=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d tomorrow +%Y-%m-%d 2>/dev/null)
curl -s -w "\nHTTP %{http_code}\n" -H "X-API-Key: $API_KEY" "$BASE/api/tools/list_appointments?date=$TOMORROW" | head -c 300
echo "..."

echo ""
echo "=== 7. GET /api/reports/top_services e revenue_by_day (JWT) ==="
CODE_TOP=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/api/reports/top_services?from=2026-02-01&to=2026-02-28&limit=5")
CODE_REV=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/api/reports/revenue_by_day?from=2026-02-06&to=2026-02-12")
echo "top_services: HTTP $CODE_TOP | revenue_by_day: HTTP $CODE_REV"
if [ "$CODE_TOP" = "200" ] && [ "$CODE_REV" = "200" ]; then
  echo "OK (reports routes available)"
else
  echo "Se 404: reconstrua a imagem da API (docker compose build api --no-cache && docker compose up -d api) e confira RUNBOOK seção 9."
fi

echo ""
echo "Connectivity tests finished."
