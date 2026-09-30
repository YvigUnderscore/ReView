#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# ReView backup: PostgreSQL dump + copy of the objects, timestamped, with rotation.
#
# Usage: bash scripts/backup.sh [directory]        (default: ./backups)
#   BACKUP_KEEP=7            number of backups kept (rotation)
#   BACKUP_MODE=mirror       mirror (default) | archive
#   COMPOSE_PROJECT=…        container name prefix, if `docker compose ps` cannot find them
#
# ── Why a mirror rather than an archive ──────────────────────────────────────
# Tarring the whole MinIO volume on every run does not scale: with 300 GB of footage and
# seven backups kept, that is 2.1 TB of backups for 300 GB of data, and one night is no
# longer enough to write the tar.
#
# `mirror` mode (default) keeps a live copy of the bucket (`minio-current/`) that `mc`
# updates incrementally — only new or changed objects cross the network — then freezes a
# snapshot of it with HARD LINKS. A snapshot therefore only costs its differences: seven
# snapshots of a 300 GB bucket where 2 GB change each day take ~312 GB, not 2.1 TB. ReView
# never rewrites a media file (a fix is a new version), which makes this model very
# efficient here.
#
# `archive` mode produces one self-contained tar.gz per run: simpler to copy off-site,
# acceptable while the bucket is small.
#
# Resulting layout:
#   backups/
#     minio-current/          live mirror of the bucket (mirror mode)
#     20260822-030000/
#       db.dump               pg_dump -Fc
#       minio/                hard-link snapshot (mirror mode)
#       minio.tar.gz          full archive (archive mode)
#       manifest.txt          version, date, mode, sizes
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="${1:-./backups}"
KEEP="${BACKUP_KEEP:-7}"
MODE="${BACKUP_MODE:-mirror}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR/$STAMP"
# Absolute host path (pwd -W = Windows path under Git Bash; MSYS_NO_PATHCONV stops the
# rewriting of container paths such as /backup → C:/Program Files/Git/backup).
HOST_DIR="$(cd "$BACKUP_DIR" && (pwd -W 2>/dev/null || pwd))"

# A service's container: from the compose project of the current directory (which follows
# COMPOSE_FILE from .env), falling back to the naming convention when called from outside.
container_of() {
  local service="$1" id
  id="$(docker compose ps -q "$service" 2>/dev/null || true)"
  [ -n "$id" ] || id="${COMPOSE_PROJECT:-review-app}-${service}-1"
  printf '%s' "$id"
}

PG="$(container_of postgres)"
MINIO="$(container_of minio)"

echo "▶ PostgreSQL dump (pg_dump -Fc)…"
docker exec "$PG" sh -c 'pg_dump -Fc -U "${POSTGRES_USER:-review}" "${POSTGRES_DB:-review}"' \
  > "$BACKUP_DIR/$STAMP/db.dump"
[ -s "$BACKUP_DIR/$STAMP/db.dump" ] || { echo "✗ empty dump" >&2; exit 1; }

# The environment file is part of the backup.
#
# Without it, restoring on a new machine leaves part of the data unreadable: ShotGrid
# credentials, API tokens and 2FA secrets are encrypted in the database with a key derived
# from `JWT_SECRET`. Restoring `db.dump` under a new secret gives rows that are present but
# cannot be decrypted — a silent failure, discovered when it is needed most.
#
# It is a secrets file: it is written with mode 600 and the backup directory must be
# protected accordingly.
if [ -f .env ]; then
  install -m 600 .env "$BACKUP_DIR/$STAMP/env.backup" 2>/dev/null \
    || { cp .env "$BACKUP_DIR/$STAMP/env.backup" && chmod 600 "$BACKUP_DIR/$STAMP/env.backup"; }
  echo "▶ .env backed up (contains secrets — protect this directory)"
else
  echo "⚠ .env not found: secrets encrypted in the database will not be decryptable after a restore" >&2
fi

# Credentials and bucket are read from the containers themselves: the host's .env may
# differ (variables forced by compose), the container tells the truth.
S3_USER="$(docker exec "$MINIO" printenv MINIO_ROOT_USER 2>/dev/null || echo minioadmin)"
S3_PASS="$(docker exec "$MINIO" printenv MINIO_ROOT_PASSWORD 2>/dev/null || echo minioadmin)"
BUCKET="$(docker exec "$(container_of backend)" printenv S3_BUCKET 2>/dev/null || echo review)"

case "$MODE" in
  mirror)
    echo "▶ Incremental mirror of bucket \"$BUCKET\"…"
    # Created here rather than by `mc`: on an empty bucket, mirror creates nothing and the
    # next snapshot would fail on a missing source.
    mkdir -p "$BACKUP_DIR/minio-current"
    # --network container:… borrows MinIO's network stack, so 127.0.0.1:9000 reaches it
    # without guessing the compose network name.
    # Stdout discarded: `mc` lists every object transferred, which would flood the
    # operator's mailbox on every nightly run. Errors still go to stderr.
    MSYS_NO_PATHCONV=1 docker run --rm --network "container:$MINIO" \
      -e "MC_HOST_review=http://$S3_USER:$S3_PASS@127.0.0.1:9000" \
      -v "$HOST_DIR:/backup" minio/mc \
      mirror --overwrite --remove --quiet "review/$BUCKET" /backup/minio-current >/dev/null

    echo "▶ Hard-link snapshot…"
    MSYS_NO_PATHCONV=1 docker run --rm -v "$HOST_DIR:/backup" alpine \
      sh -c "cp -al /backup/minio-current /backup/$STAMP/minio"
    ;;
  archive)
    echo "▶ Full archive of the MinIO volume…"
    MSYS_NO_PATHCONV=1 docker run --rm --volumes-from "$MINIO" -v "$HOST_DIR:/backup" alpine \
      tar czf "/backup/$STAMP/minio.tar.gz" -C / data
    ;;
  *)
    echo "✗ unknown BACKUP_MODE: $MODE (mirror | archive)" >&2
    exit 1
    ;;
esac

# Manifest: without it, a backup does not say which version it comes from — and restoring
# a database under an older application version fails at startup. Its keys are parsed by
# the backend's backup catalog: do not rename them.
{
  echo "date=$(date -Iseconds)"
  echo "mode=$MODE"
  echo "bucket=$BUCKET"
  echo "app_version=$(sed -n 's/^APP_VERSION=//p' .env 2>/dev/null | tail -n 1)"
  echo "db_bytes=$(wc -c < "$BACKUP_DIR/$STAMP/db.dump" | tr -d ' ')"
  # Tells the restore whether the secrets came along — i.e. whether ShotGrid credentials
  # and API tokens will be decryptable once the database is restored elsewhere.
  echo "env_included=$([ -f "$BACKUP_DIR/$STAMP/env.backup" ] && echo yes || echo no)"
} > "$BACKUP_DIR/$STAMP/manifest.txt"

echo "▶ Rotation (keeping the $KEEP most recent)…"
# Snapshots share their blocks: deleting one only frees what exists nowhere else.
# minio-current is never touched: it IS the mirror.
# `|| true`: on a first backup, rotation has nothing to purge and several stages of the
# pipe exit with an error — that is not a backup failure.
{
  ls -1d "$BACKUP_DIR"/*/ 2>/dev/null \
    | grep -Ev '/minio-current/$' \
    | sort -r \
    | tail -n +$((KEEP + 1)) \
    | while read -r dir; do rm -rf "$dir" && echo "  purged: $dir"; done
} || true

echo "✅ Backup complete: $BACKUP_DIR/$STAMP"
# Machine-readable last line (read by scripts/update.sh and the operations agent).
echo "BACKUP_ID=$STAMP"
