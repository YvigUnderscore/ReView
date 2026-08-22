#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# Restauration ReView depuis une sauvegarde produite par scripts/backup.sh.
# ⚠️ ÉCRASE la base et/ou les objets courants — arrêter backend+worker avant.
#
# Usage :
#   bash scripts/restore.sh all    backups/20260822-030000            # base + objets
#   bash scripts/restore.sh db     backups/20260822-030000            # base seule
#   bash scripts/restore.sh db     backups/20260822-030000/db.dump [nom_base]
#   bash scripts/restore.sh minio  backups/20260822-030000            # objets seuls
#   bash scripts/restore.sh verify backups/20260822-030000            # essai NON destructif
#
# Le mode `verify` est la procédure de test : il restaure le dump dans une base jetable,
# compte ce qui en sort, compare le nombre d'objets de l'instantané à celui du bucket, puis
# supprime la base d'essai. Une sauvegarde jamais restaurée n'est pas une sauvegarde ; c'est
# ce mode qu'on planifie une fois par mois.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:?mode requis : all | db | minio | verify}"
SOURCE="${2:?chemin de la sauvegarde requis}"

container_of() {
  local service="$1" id
  id="$(docker compose ps -q "$service" 2>/dev/null || true)"
  [ -n "$id" ] || id="${COMPOSE_PROJECT:-review-app}-${service}-1"
  printf '%s' "$id"
}

PG="$(container_of postgres)"
MINIO="$(container_of minio)"
S3_USER="$(docker exec "$MINIO" printenv MINIO_ROOT_USER 2>/dev/null || echo minioadmin)"
S3_PASS="$(docker exec "$MINIO" printenv MINIO_ROOT_PASSWORD 2>/dev/null || echo minioadmin)"
BUCKET="$(docker exec "$(container_of backend)" printenv S3_BUCKET 2>/dev/null || echo review)"

# Chemin hôte absolu du DOSSIER de sauvegardes, et chemin relatif de la source dedans :
# les conteneurs voient le dossier monté sur /backup.
resolve_paths() {
  local target="$1"
  if [ -d "$target" ]; then
    SNAP_NAME="$(basename "$target")"
    HOST_DIR="$(cd "$target/.." && (pwd -W 2>/dev/null || pwd))"
  else
    SNAP_NAME="$(basename "$(dirname "$target")")"
    HOST_DIR="$(cd "$(dirname "$(dirname "$target")")" && (pwd -W 2>/dev/null || pwd))"
  fi
}

restore_db() {
  local dump="$1" db="${2:-}"
  [ -f "$dump" ] || { echo "✗ dump introuvable : $dump" >&2; exit 1; }
  echo "▶ Restauration PostgreSQL depuis $dump…"
  if [ -n "$db" ]; then
    docker exec "$PG" sh -c "createdb -U \"\${POSTGRES_USER:-review}\" \"$db\" 2>/dev/null || true"
    docker exec -i "$PG" sh -c "pg_restore -U \"\${POSTGRES_USER:-review}\" -d \"$db\" --clean --if-exists --no-owner" < "$dump"
  else
    docker exec -i "$PG" sh -c 'pg_restore -U "${POSTGRES_USER:-review}" -d "${POSTGRES_DB:-review}" --clean --if-exists --no-owner' < "$dump"
  fi
  echo "✅ Base restaurée."
}

restore_minio() {
  local target="$1"
  resolve_paths "$target"
  if [ -f "$target" ] || [ -f "$target/minio.tar.gz" ]; then
    # Sauvegarde en mode `archive` : le volume entier, MinIO à l'arrêt.
    local arch_dir arch_file
    if [ -f "$target" ]; then
      arch_dir="$(cd "$(dirname "$target")" && (pwd -W 2>/dev/null || pwd))"
      arch_file="$(basename "$target")"
    else
      arch_dir="$(cd "$target" && (pwd -W 2>/dev/null || pwd))"
      arch_file="minio.tar.gz"
    fi
    echo "▶ Restauration du volume MinIO depuis $arch_dir/$arch_file (arrêt du service)…"
    docker stop "$MINIO" >/dev/null
    MSYS_NO_PATHCONV=1 docker run --rm --volumes-from "$MINIO" -v "$arch_dir:/backup" alpine \
      sh -c "rm -rf /data/* && tar xzf /backup/$arch_file -C /"
    docker start "$MINIO" >/dev/null
    echo "✅ Volume restauré, MinIO redémarré."
    return
  fi
  [ -d "$target/minio" ] || { echo "✗ instantané introuvable : $target/minio" >&2; exit 1; }
  echo "▶ Restauration des objets depuis $target/minio vers « $BUCKET »…"
  # `--remove` : le bucket doit finir identique à l'instantané, y compris les objets
  # apparus depuis (une restauration partielle laisserait des médias fantômes en base).
  MSYS_NO_PATHCONV=1 docker run --rm --network "container:$MINIO" \
    -e "MC_HOST_review=http://$S3_USER:$S3_PASS@127.0.0.1:9000" \
    -v "$HOST_DIR:/backup" minio/mc \
    mirror --overwrite --remove --quiet "/backup/$SNAP_NAME/minio" "review/$BUCKET"
  echo "✅ Objets restaurés."
}

case "$MODE" in
  db)
    if [ -d "$SOURCE" ]; then restore_db "$SOURCE/db.dump" "${3:-}"; else restore_db "$SOURCE" "${3:-}"; fi
    # ⚠ `docker compose up` seul auto-charge docker-compose.override.yml (dev) — sauf si
    # COMPOSE_FILE est posé dans .env, ce que fait scripts/install.sh.
    echo "   Redémarrer : docker compose up -d backend worker"
    ;;
  minio)
    restore_minio "$SOURCE"
    ;;
  all)
    [ -d "$SOURCE" ] || { echo "✗ dossier de sauvegarde attendu : $SOURCE" >&2; exit 1; }
    restore_db "$SOURCE/db.dump"
    restore_minio "$SOURCE"
    echo "   Redémarrer : docker compose up -d backend worker"
    ;;
  verify)
    [ -d "$SOURCE" ] || { echo "✗ dossier de sauvegarde attendu : $SOURCE" >&2; exit 1; }
    resolve_paths "$SOURCE"
    CHECK_DB="review_restore_check_$(date +%s)"
    echo "▶ Restauration d'essai dans la base jetable $CHECK_DB…"
    docker exec "$PG" sh -c "createdb -U \"\${POSTGRES_USER:-review}\" \"$CHECK_DB\""
    docker exec -i "$PG" sh -c "pg_restore -U \"\${POSTGRES_USER:-review}\" -d \"$CHECK_DB\" --no-owner" \
      < "$SOURCE/db.dump" || echo "  (pg_restore a signalé des avertissements — détaillés ci-dessus)"
    TABLES="$(docker exec "$PG" sh -c "psql -tAX -U \"\${POSTGRES_USER:-review}\" -d \"$CHECK_DB\" -c \"select count(*) from information_schema.tables where table_schema='public'\"")"
    USERS="$(docker exec "$PG" sh -c "psql -tAX -U \"\${POSTGRES_USER:-review}\" -d \"$CHECK_DB\" -c 'select count(*) from \"User\"'" 2>/dev/null || echo '?')"
    MEDIA="$(docker exec "$PG" sh -c "psql -tAX -U \"\${POSTGRES_USER:-review}\" -d \"$CHECK_DB\" -c 'select count(*) from \"MediaObject\"'" 2>/dev/null || echo '?')"
    docker exec "$PG" sh -c "dropdb -U \"\${POSTGRES_USER:-review}\" \"$CHECK_DB\""
    echo "  base   : $TABLES tables, $USERS comptes, $MEDIA médias"

    if [ -d "$SOURCE/minio" ]; then
      SNAP_COUNT="$(MSYS_NO_PATHCONV=1 docker run --rm -v "$HOST_DIR:/backup" alpine \
        sh -c "find /backup/$SNAP_NAME/minio -type f | wc -l" | tr -d ' ')"
      LIVE_COUNT="$(MSYS_NO_PATHCONV=1 docker run --rm --network "container:$MINIO" \
        -e "MC_HOST_review=http://$S3_USER:$S3_PASS@127.0.0.1:9000" minio/mc \
        --quiet ls --recursive "review/$BUCKET" | wc -l | tr -d ' ')"
      echo "  objets : $SNAP_COUNT dans l'instantané, $LIVE_COUNT dans le bucket vivant"
      [ "$SNAP_COUNT" -gt 0 ] || { echo "✗ instantané vide : la sauvegarde des objets n'a rien capturé." >&2; exit 1; }
    else
      echo "  objets : mode archive (instantané non parcourable sans extraction)"
    fi
    [ "${TABLES:-0}" -gt 10 ] || { echo "✗ moins de 11 tables restaurées : dump incomplet." >&2; exit 1; }
    echo "✅ Sauvegarde $SNAP_NAME vérifiée (rien n'a été modifié sur l'instance)."
    ;;
  *)
    echo "✗ mode inconnu : $MODE (all | db | minio | verify)" >&2
    exit 1
    ;;
esac
