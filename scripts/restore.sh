#!/usr/bin/env bash
# Restauración desde un respaldo. Reemplaza el contenido de la base indicada: úsalo con cuidado.
# Uso: DATABASE_URL=postgres://connor:...@host/connor_restaurada bash scripts/restore.sh backups/connor-db-XXXX.dump [backups/connor-files-XXXX.tar.gz] [DATA_DIR]
set -euo pipefail
: "${DATABASE_URL:?Define DATABASE_URL de la base destino}"
DUMP="${1:?Indica el archivo .dump}"
FILES="${2:-}"
DATA_DIR="${3:-.}"
read -r -p "Se reemplazará el contenido de la base destino. Escribe RESTAURAR para continuar: " ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$DUMP"
if [ -n "$FILES" ]; then tar -xzf "$FILES" -C "$DATA_DIR"; fi
echo "Restauración terminada. Ejecuta 'npm run smoke' contra el servidor para verificar."
