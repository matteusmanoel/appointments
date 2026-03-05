#!/usr/bin/env bash
# =============================================================================
# Executa reset (mantém apenas admin@navalhia.com.br) e em seguida seed completo.
# Uso:
#   Com Docker: ./scripts/run-reset-and-seed.sh
#   Com psql local: PGPASSWORD=xxx PGHOST=localhost PGUSER=navalhia PGDATABASE=navalhia ./scripts/run-reset-and-seed.sh
# =============================================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if command -v docker >/dev/null 2>&1 && docker compose -f "$ROOT_DIR/docker-compose.yml" ps -q db 2>/dev/null | head -1 | xargs docker inspect --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  echo ">>> Rodando via Docker (db)..."
  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T db psql -U navalhia -d navalhia < "$SCRIPT_DIR/reset-keep-admin.sql"
  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T db psql -U navalhia -d navalhia < "$SCRIPT_DIR/seed-full.sql"
else
  echo ">>> Rodando com psql (PGHOST=$PGHOST)..."
  export PGHOST="${PGHOST:-localhost}"
  export PGPORT="${PGPORT:-5432}"
  export PGUSER="${PGUSER:-navalhia}"
  export PGDATABASE="${PGDATABASE:-navalhia}"
  psql -f "$SCRIPT_DIR/reset-keep-admin.sql"
  psql -f "$SCRIPT_DIR/seed-full.sql"
fi

echo ">>> Concluído. Login: admin@navalhia.com.br / Senha: admin123"
