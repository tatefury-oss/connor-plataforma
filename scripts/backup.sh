#!/usr/bin/env bash
# Respaldo completo: base de datos (formato custom de pg_dump) + archivos subidos + documentos privados.
# Uso: DATABASE_URL=postgres://connor:...@host/connor BACKUP_DIR=/respaldos DATA_DIR=/data bash scripts/backup.sh
# Programar diario con cron, p. ej.:  15 3 * * *  cd /opt/connor && ./scripts/backup.sh >> /var/log/connor-backup.log 2>&1
set -euo pipefail
: "${DATABASE_URL:?Define DATABASE_URL (usuario dueño de la base)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DATA_DIR="${DATA_DIR:-.}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
umask 077   # los respaldos contienen datos personales: solo el dueño puede leerlos

pg_dump --format=custom --no-owner --file "$BACKUP_DIR/connor-db-$STAMP.dump" "$DATABASE_URL"
tar -czf "$BACKUP_DIR/connor-files-$STAMP.tar.gz" -C "$DATA_DIR" \
  $( [ -d "$DATA_DIR/uploads" ] && echo uploads ) $( [ -d "$DATA_DIR/private-docs" ] && echo private-docs )

# Verificación: el respaldo debe poder leerse.
pg_restore --list "$BACKUP_DIR/connor-db-$STAMP.dump" > /dev/null
find "$BACKUP_DIR" -name 'connor-*' -mtime "+$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) respaldo correcto: connor-db-$STAMP.dump, connor-files-$STAMP.tar.gz"
