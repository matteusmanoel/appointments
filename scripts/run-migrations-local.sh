#!/usr/bin/env bash
# Aplica todas as migrations do Supabase no Postgres local (Docker).
# Uso: ./scripts/run-migrations-local.sh
# Requer: docker compose com serviço 'db' rodando.

set -e
cd "$(dirname "$0")/.."
MIGRATIONS_DIR="supabase/migrations"
DB_USER="${POSTGRES_USER:-navalhia}"
DB_NAME="${POSTGRES_DB:-navalhia}"

if ! docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
  echo "Erro: container db não está acessível. Suba com: docker compose up -d db"
  exit 1
fi

echo "Aplicando migrations em $MIGRATIONS_DIR (ordem por nome)..."
for f in $(ls -1 "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  name=$(basename "$f")
  echo "  $name"
  docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" < "$f"
done
echo "Migrations aplicadas. Reinicie a API: docker compose up -d api"
