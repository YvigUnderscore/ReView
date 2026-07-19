#!/usr/bin/env bash
#
# Sauvegarde ReView (37.F) : dump PostgreSQL (-Fc) + archive des objets MinIO,
# horodatés, avec rotation. À planifier (cron/Task Scheduler) sur l'hôte docker.
#
# Usage : bash scripts/backup.sh [dossier]        (défaut : ./backups)
#   BACKUP_KEEP=7        nombre de sauvegardes conservées par type (rotation)
#   COMPOSE_PROJECT=review-app   préfixe des conteneurs docker
#
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
KEEP="${BACKUP_KEEP:-7}"
PROJECT="${COMPOSE_PROJECT:-review-app}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
# Chemin hôte absolu (pwd -W = chemin Windows sous Git Bash ; MSYS_NO_PATHCONV coupe la
# réécriture des chemins conteneur type /backup → C:/Program Files/Git/backup).
HOST_DIR="$(cd "$BACKUP_DIR" && (pwd -W 2>/dev/null || pwd))"

echo "▶ Dump PostgreSQL (pg_dump -Fc)…"
docker exec "${PROJECT}-postgres-1" sh -c 'pg_dump -Fc -U "${POSTGRES_USER:-review}" "${POSTGRES_DB:-review}"' \
  > "$BACKUP_DIR/db-$STAMP.dump"
[ -s "$BACKUP_DIR/db-$STAMP.dump" ] || { echo "✗ dump vide" >&2; exit 1; }

echo "▶ Archive MinIO (volume de données)…"
MSYS_NO_PATHCONV=1 docker run --rm --volumes-from "${PROJECT}-minio-1" -v "$HOST_DIR:/backup" alpine \
  tar czf "/backup/minio-$STAMP.tar.gz" -C / data

echo "▶ Rotation (conserve les $KEEP plus récentes de chaque type)…"
for prefix in db minio; do
  ls -1t "$BACKUP_DIR"/$prefix-*.{dump,tar.gz} 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do
    rm -f "$f" && echo "  purgé : $f"
  done
done

echo "✅ Sauvegarde terminée :"
ls -lh "$BACKUP_DIR"/db-"$STAMP".dump "$BACKUP_DIR"/minio-"$STAMP".tar.gz
