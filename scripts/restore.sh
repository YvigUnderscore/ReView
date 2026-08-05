#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# Restauration ReView (37.F) depuis une sauvegarde produite par scripts/backup.sh.
# ⚠️ ÉCRASE la base et/ou les objets MinIO courants — arrêter backend+worker avant.
#
# Usage :
#   bash scripts/restore.sh db     <backups/db-....dump>     [nom_base]  # défaut : base courante
#   bash scripts/restore.sh minio  <backups/minio-....tar.gz>
#
set -euo pipefail

MODE="${1:?mode requis : db | minio}"
FILE="${2:?fichier de sauvegarde requis}"
PROJECT="${COMPOSE_PROJECT:-review-app}"

[ -f "$FILE" ] || { echo "✗ fichier introuvable : $FILE" >&2; exit 1; }

case "$MODE" in
  db)
    DB="${3:-}"
    echo "▶ Restauration PostgreSQL depuis $FILE…"
    if [ -n "$DB" ]; then
      # Restauration vers une base nommée (créée si absente) — utilisé aussi par le
      # test de restauration documenté dans DOCUMENTATION/infrastructure/backups.md.
      docker exec "${PROJECT}-postgres-1" sh -c "createdb -U \"\${POSTGRES_USER:-review}\" \"$DB\" 2>/dev/null || true"
      docker exec -i "${PROJECT}-postgres-1" sh -c "pg_restore -U \"\${POSTGRES_USER:-review}\" -d \"$DB\" --clean --if-exists --no-owner" < "$FILE"
    else
      docker exec -i "${PROJECT}-postgres-1" sh -c 'pg_restore -U "${POSTGRES_USER:-review}" -d "${POSTGRES_DB:-review}" --clean --if-exists --no-owner' < "$FILE"
    fi
    # ⚠ `docker compose up` seul auto-charge docker-compose.override.yml (dev) : sur un hôte
    # de production, cela repasserait backend et worker en NODE_ENV=development — donc sans
    # les garde-fous de config/env.ts — et republierait Postgres/Redis. On rappelle donc la
    # commande complète de production.
    echo "✅ Base restaurée. Redémarrer backend+worker :"
    echo "   dev  : docker compose up -d backend worker"
    echo "   prod : docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend worker"
    ;;
  minio)
    echo "▶ Restauration MinIO depuis $FILE (arrêt du service)…"
    HOST_DIR="$(cd "$(dirname "$FILE")" && (pwd -W 2>/dev/null || pwd))"
    docker stop "${PROJECT}-minio-1" >/dev/null
    MSYS_NO_PATHCONV=1 docker run --rm --volumes-from "${PROJECT}-minio-1" -v "$HOST_DIR:/backup" alpine \
      sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$FILE") -C /"
    docker start "${PROJECT}-minio-1" >/dev/null
    echo "✅ Objets restaurés, MinIO redémarré."
    ;;
  *)
    echo "✗ mode inconnu : $MODE (db | minio)" >&2
    exit 1
    ;;
esac
