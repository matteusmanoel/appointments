#!/usr/bin/env sh
# Backup Postgres. Run from project root.
# Usage: ./scripts/backup-db.sh [path_to_backup_dir]
# Option A: docker compose run --rm db pg_dump -U barberflow barberflow | gzip > backups/barberflow_$(date +%Y%m%d_%H%M%S).sql.gz
# Option B: from host with DATABASE_URL set: pg_dump "$DATABASE_URL" | gzip > ...

set -e
BACKUP_DIR="${1:-./backups}"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/barberflow_$TIMESTAMP.sql.gz"

if [ -n "$DATABASE_URL" ]; then
  pg_dump "$DATABASE_URL" | gzip > "$FILE"
else
  docker compose run --rm db pg_dump -U barberflow barberflow | gzip > "$FILE"
fi

echo "Backup written to $FILE"
