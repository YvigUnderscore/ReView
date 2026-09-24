#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# ReView restore from a backup produced by scripts/backup.sh.
# ⚠️ OVERWRITES the current database and/or objects — stop backend+worker first.
#
# Usage:
#   bash scripts/restore.sh all    backups/20260822-030000            # database + objects
#   bash scripts/restore.sh db     backups/20260822-030000            # database only
#   bash scripts/restore.sh db     backups/20260822-030000/db.dump [db_name]
#   bash scripts/restore.sh minio  backups/20260822-030000            # objects only
#   bash scripts/restore.sh verify backups/20260822-030000            # NON-destructive test
#
# `verify` is the test procedure: it restores the dump into a throwaway database, counts
# what comes out, compares the snapshot's object count with the bucket's, then drops the
# test database. A backup that has never been restored is not a backup; this is the mode
# to schedule once a month.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:?mode required: all | db | minio | verify}"
SOURCE="${2:?backup path required}"

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

# Absolute host path of the backups DIRECTORY, and the source's name inside it: the
# containers see that directory mounted on /backup.
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
  [ -f "$dump" ] || { echo "✗ dump not found: $dump" >&2; exit 1; }
  echo "▶ Restoring PostgreSQL from $dump…"
  if [ -n "$db" ]; then
    docker exec "$PG" sh -c "createdb -U \"\${POSTGRES_USER:-review}\" \"$db\" 2>/dev/null || true"
    docker exec -i "$PG" sh -c "pg_restore -U \"\${POSTGRES_USER:-review}\" -d \"$db\" --clean --if-exists --no-owner" < "$dump"
  else
    docker exec -i "$PG" sh -c 'pg_restore -U "${POSTGRES_USER:-review}" -d "${POSTGRES_DB:-review}" --clean --if-exists --no-owner' < "$dump"
  fi
  echo "✅ Database restored."
}

restore_minio() {
  local target="$1"
  resolve_paths "$target"
  if [ -f "$target" ] || [ -f "$target/minio.tar.gz" ]; then
    # `archive` mode backup: the whole volume, with MinIO stopped.
    local arch_dir arch_file
    if [ -f "$target" ]; then
      arch_dir="$(cd "$(dirname "$target")" && (pwd -W 2>/dev/null || pwd))"
      arch_file="$(basename "$target")"
    else
      arch_dir="$(cd "$target" && (pwd -W 2>/dev/null || pwd))"
      arch_file="minio.tar.gz"
    fi
    echo "▶ Restoring the MinIO volume from $arch_dir/$arch_file (stopping the service)…"
    docker stop "$MINIO" >/dev/null
    MSYS_NO_PATHCONV=1 docker run --rm --volumes-from "$MINIO" -v "$arch_dir:/backup" alpine \
      sh -c "rm -rf /data/* && tar xzf /backup/$arch_file -C /"
    docker start "$MINIO" >/dev/null
    echo "✅ Volume restored, MinIO restarted."
    return
  fi
  [ -d "$target/minio" ] || { echo "✗ snapshot not found: $target/minio" >&2; exit 1; }
  echo "▶ Restoring objects from $target/minio to \"$BUCKET\"…"
  # `--remove`: the bucket must end up identical to the snapshot, including objects added
  # since (a partial restore would leave ghost media in the database).
  MSYS_NO_PATHCONV=1 docker run --rm --network "container:$MINIO" \
    -e "MC_HOST_review=http://$S3_USER:$S3_PASS@127.0.0.1:9000" \
    -v "$HOST_DIR:/backup" minio/mc \
    mirror --overwrite --remove --quiet "/backup/$SNAP_NAME/minio" "review/$BUCKET"
  echo "✅ Objects restored."
}

case "$MODE" in
  db)
    if [ -d "$SOURCE" ]; then restore_db "$SOURCE/db.dump" "${3:-}"; else restore_db "$SOURCE" "${3:-}"; fi
    # ⚠ A bare `docker compose up` auto-loads docker-compose.override.yml (dev) — unless
    # COMPOSE_FILE is set in .env, which scripts/install.sh does.
    echo "   Restart: docker compose up -d backend worker"
    ;;
  minio)
    restore_minio "$SOURCE"
    ;;
  all)
    [ -d "$SOURCE" ] || { echo "✗ backup directory expected: $SOURCE" >&2; exit 1; }
    restore_db "$SOURCE/db.dump"
    restore_minio "$SOURCE"
    echo "   Restart: docker compose up -d backend worker"
    ;;
  verify)
    [ -d "$SOURCE" ] || { echo "✗ backup directory expected: $SOURCE" >&2; exit 1; }
    resolve_paths "$SOURCE"
    CHECK_DB="review_restore_check_$(date +%s)"
    echo "▶ Test restore into throwaway database $CHECK_DB…"
    docker exec "$PG" sh -c "createdb -U \"\${POSTGRES_USER:-review}\" \"$CHECK_DB\""
    docker exec -i "$PG" sh -c "pg_restore -U \"\${POSTGRES_USER:-review}\" -d \"$CHECK_DB\" --no-owner" \
      < "$SOURCE/db.dump" || echo "  (pg_restore reported warnings — see above)"
    TABLES="$(docker exec "$PG" sh -c "psql -tAX -U \"\${POSTGRES_USER:-review}\" -d \"$CHECK_DB\" -c \"select count(*) from information_schema.tables where table_schema='public'\"")"
    USERS="$(docker exec "$PG" sh -c "psql -tAX -U \"\${POSTGRES_USER:-review}\" -d \"$CHECK_DB\" -c 'select count(*) from \"User\"'" 2>/dev/null || echo '?')"
    MEDIA="$(docker exec "$PG" sh -c "psql -tAX -U \"\${POSTGRES_USER:-review}\" -d \"$CHECK_DB\" -c 'select count(*) from \"MediaObject\"'" 2>/dev/null || echo '?')"
    docker exec "$PG" sh -c "dropdb -U \"\${POSTGRES_USER:-review}\" \"$CHECK_DB\""
    echo "  database: $TABLES tables, $USERS accounts, $MEDIA media"

    if [ -d "$SOURCE/minio" ]; then
      SNAP_COUNT="$(MSYS_NO_PATHCONV=1 docker run --rm -v "$HOST_DIR:/backup" alpine \
        sh -c "find /backup/$SNAP_NAME/minio -type f | wc -l" | tr -d ' ')"
      LIVE_COUNT="$(MSYS_NO_PATHCONV=1 docker run --rm --network "container:$MINIO" \
        -e "MC_HOST_review=http://$S3_USER:$S3_PASS@127.0.0.1:9000" minio/mc \
        --quiet ls --recursive "review/$BUCKET" | wc -l | tr -d ' ')"
      echo "  objects : $SNAP_COUNT in the snapshot, $LIVE_COUNT in the live bucket"
      [ "$SNAP_COUNT" -gt 0 ] || { echo "✗ empty snapshot: the object backup captured nothing." >&2; exit 1; }
    else
      echo "  objects : archive mode (snapshot cannot be browsed without extracting it)"
    fi
    [ "${TABLES:-0}" -gt 10 ] || { echo "✗ fewer than 11 tables restored: incomplete dump." >&2; exit 1; }
    echo "✅ Backup $SNAP_NAME verified (nothing was changed on the instance)."
    ;;
  *)
    echo "✗ unknown mode: $MODE (all | db | minio | verify)" >&2
    exit 1
    ;;
esac
