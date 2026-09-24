#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# Updates a ReView instance: backup, switch, migrations, health check, and automatic
# rollback if the probe fails.
#
# Usage:
#   bash scripts/update.sh                       # latest version of the tracked branch
#   bash scripts/update.sh --version v2.3.0      # a specific version (git tag or image tag)
#   bash scripts/update.sh --no-backup --yes     # no backup (not recommended), no prompt
#
# Options:
#   --version <vX.Y.Z>  target version: git tag (build mode) or image tag (registry mode,
#                       when .env defines REVIEW_IMAGE_PREFIX)
#   --no-backup         skip the pre-update backup
#   --yes               never ask for confirmation
#   --timeout <sec>     maximum wait for the readiness probe (default: 300)
#
# Two modes, chosen from `.env`:
#   • registry — REVIEW_IMAGE_PREFIX is set: published images are pulled
#     (`docker compose pull`), nothing is built on the studio's server;
#   • build — otherwise: `git checkout <version>` then `up -d --build`.
#
# Migrations are applied by the backend container on startup (backend/start.sh,
# `prisma migrate deploy`, no destructive fallback). A failed migration keeps the API from
# answering: the probe fails and the rollback kicks in.
#
set -euo pipefail

# The repository: the one containing this script, unless `REVIEW_ROOT` points elsewhere.
#
# In build mode this script runs `git checkout`, which REWRITES the file bash is reading as
# it goes: the interpreter would resume at an offset that is now wrong, in a different file.
# The operations agent therefore copies this script out of the repository before running
# it, and uses this variable to say where the repository really is.
ROOT="${REVIEW_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

TARGET=""
DO_BACKUP=1
ASSUME_YES=0
READY_TIMEOUT=300

while [ $# -gt 0 ]; do
  case "$1" in
    --version) TARGET="${2:?--version requires a value}"; shift 2 ;;
    --version=*) TARGET="${1#*=}"; shift ;;
    --no-backup) DO_BACKUP=0; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --timeout) READY_TIMEOUT="${2:?--timeout requires a value}"; shift 2 ;;
    --timeout=*) READY_TIMEOUT="${1#*=}"; shift ;;
    -h|--help) sed -n '5,29p' "$0"; exit 0 ;;
    *) echo "✗ unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
ok() { printf '\033[0;32m  ✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$1"; }
die() { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── Argument guards ──────────────────────────────────────────────────────────
#
# These two values come from the command line — which, since the admin screen can order an
# update, means from an order dropped by the application.
#
# `READY_TIMEOUT` ends up in "$(( SECONDS + READY_TIMEOUT ))", and bash re-evaluates the
# CONTENT of a variable met in an arithmetic expression: "x[$(command)]" executes there.
# The numeric filter closes an arbitrary-execution hole — and the agent repeats it.
case "$READY_TIMEOUT" in
  ''|*[!0-9]*) die "--timeout expects a number of seconds (got: $READY_TIMEOUT)" ;;
esac
# `TARGET` becomes an argument to `git checkout` and `docker compose`: a leading dash would
# turn it into an option, a space into a second value.
case "${TARGET:-none}" in
  -*|*[!A-Za-z0-9._/-]*) die "invalid version: $TARGET" ;;
esac

# ── Milestones ───────────────────────────────────────────────────────────────
#
# The exit code does not say WHERE we stopped: "the backup failed, nothing changed" and
# "the switch happened, we rolled back" are both 1. These machine-readable milestones are
# what the admin screen displays.
phase() {
  printf 'OPS_PHASE=%s\n' "$1"
  if [ -n "${OPS_PHASE_FILE:-}" ]; then printf 'OPS_PHASE=%s\n' "$1" >> "$OPS_PHASE_FILE"; fi
}

[ -f .env ] || die ".env not found — this instance is not installed (bash scripts/install.sh)."
docker compose version >/dev/null 2>&1 || die "\"docker compose\" v2 plugin not found."

# Reads a variable from .env without executing the file (a value containing spaces or $
# must not be interpreted by the shell).
env_get() {
  sed -n "s/^$1=//p" .env | tail -n 1
}

# Sets (or replaces) a variable in .env, in place.
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^$key=" .env > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}

# READINESS probe, from inside the container: no assumption about host ports (production
# publishes none) or about the TLS front end.
wait_ready() {
  local deadline=$(( SECONDS + READY_TIMEOUT ))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if docker compose exec -T backend node -e \
      "fetch('http://127.0.0.1:3000/health/ready').then(r=>r.json()).then(j=>process.exit(j.status==='ready'?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  return 1
}

IMAGE_PREFIX="$(env_get REVIEW_IMAGE_PREFIX)"
PREVIOUS_VERSION="$(env_get APP_VERSION)"
PREVIOUS_TAG="$(env_get REVIEW_IMAGE_TAG)"
PREVIOUS_REF=""
MODE="build"
# `if`, not `[ … ] && …`: under `set -e`, an AND list whose test fails exits the script —
# here, in build mode, i.e. the common case.
if [ -n "$IMAGE_PREFIX" ]; then MODE="registry"; fi

phase precheck
say "Updating ReView ($MODE mode)"
echo "  running version : ${PREVIOUS_VERSION:-unknown}"
echo "  target version  : ${TARGET:-latest available}"

if [ "$ASSUME_YES" -eq 0 ]; then
  read -r -p "  Continue? [y/N] " answer </dev/tty
  case "$answer" in o|O|y|Y) ;; *) die "cancelled." ;; esac
fi

# ── 1. Backup ────────────────────────────────────────────────────────────────
BACKUP_ID=""
if [ "$DO_BACKUP" -eq 1 ]; then
  phase backup
  say "Pre-update backup"
  # `tee -a "$file"`, not "tee /dev/stderr": /dev/stderr is a link to descriptor 2, which
  # `tee` reopens for WRITING — i.e. truncates. As soon as stderr is a file (an update
  # ordered from the admin screen), the run's log would restart from zero at the backup.
  BACKUP_LOG="$(mktemp)"
  if ! bash scripts/backup.sh 2>&1 | tee -a "$BACKUP_LOG"; then
    rm -f "$BACKUP_LOG"
    die "the backup did not complete — update aborted."
  fi
  BACKUP_ID="$(sed -n 's/^BACKUP_ID=//p' "$BACKUP_LOG" | tail -n 1)"
  rm -f "$BACKUP_LOG"
  [ -n "$BACKUP_ID" ] || die "the backup did not complete — update aborted."
  ok "backup $BACKUP_ID"
else
  warn "backup skipped (--no-backup): the database cannot be rolled back."
fi

# ── 2. Switch ────────────────────────────────────────────────────────────────
#
# ⚠ `docker compose up -d` is NEVER run bare here, and this is the most important point of
# the script. `worker` and `frontend` both depend on `backend: service_healthy`
# (docker-compose.yml): a backend that never becomes healthy — a failed Prisma migration,
# the most common update failure — makes `up -d` exit with an error. Under `set -e` the
# script would die HERE, BEFORE section 4: the automatic rollback would not run in the very
# situation it exists for. The failure is recorded, not obeyed.
phase switch
SWITCH_FAILED=0
say "Switching to the new version"
if [ "$MODE" = "registry" ]; then
  # No implicit "latest" in production: an instance must be able to say which version it
  # runs, and a rollback requires knowing the previous one.
  [ -n "$TARGET" ] || die "registry mode: specify the version, e.g. --version v2.3.0 (see CHANGELOG.md)."
  NEW_VERSION="$TARGET"
  env_set REVIEW_IMAGE_TAG "$NEW_VERSION"
  env_set APP_VERSION "$NEW_VERSION"
  # Pull failure: `.env` already names the target tag. Leaving it would make EVERY later
  # `docker compose` command fail — including the one the operator would use to recover.
  # Put back the tag that is running.
  if ! docker compose pull; then
    if [ -n "$PREVIOUS_TAG" ]; then env_set REVIEW_IMAGE_TAG "$PREVIOUS_TAG"; fi
    env_set APP_VERSION "$PREVIOUS_VERSION"
    die "could not pull the images (registry unreachable? version does not exist?)"
  fi
  if ! docker compose up -d; then SWITCH_FAILED=1; fi
else
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "build mode outside a git repository: cannot change version."
  PREVIOUS_REF="$(git rev-parse HEAD)"
  [ -z "$(git status --porcelain --untracked-files=no)" ] \
    || die "tracked files have local changes — commit or revert them before updating."
  git fetch --tags --quiet
  if [ -n "$TARGET" ]; then
    git checkout --quiet "$TARGET" || die "unknown version: $TARGET"
  else
    git pull --ff-only --quiet || die "could not update the repository (diverged history)."
  fi
  NEW_VERSION="$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD)"
  env_set APP_VERSION "$NEW_VERSION"
  if ! docker compose up -d --build; then SWITCH_FAILED=1; fi
fi
if [ "$SWITCH_FAILED" -eq 0 ]; then ok "containers recreated"; else warn "recreating the containers reported an error"; fi

# ── 3. Health check ──────────────────────────────────────────────────────────
phase health
say "Health check (database, Redis, storage)"
if [ "$SWITCH_FAILED" -eq 0 ] && wait_ready; then
  ok "instance available, version $NEW_VERSION"
  docker compose exec -T backend node -e \
    "fetch('http://127.0.0.1:3000/api/version').then(r=>r.text()).then(t=>console.log('  '+t))" 2>/dev/null || true
  say "Update complete"
  echo "  What's new: DOCUMENTATION/CHANGELOG.md — release log: CHANGELOG.md"
  if [ -n "$BACKUP_ID" ]; then echo "  Backup kept: $BACKUP_ID"; fi
  phase done
  exit 0
fi

# ── 4. Rollback ──────────────────────────────────────────────────────────────
phase rollback
if [ "$SWITCH_FAILED" -eq 1 ]; then
  warn "the switch itself failed — rolling back."
else
  warn "the instance is not available after $READY_TIMEOUT s — rolling back."
fi
docker compose logs --tail=50 backend || true

# Same precautions as the switch: if the previous version does not come back up either,
# the script must still reach the operator message below, which is all that is left.
if [ "$MODE" = "registry" ]; then
  if [ -n "$PREVIOUS_TAG" ]; then env_set REVIEW_IMAGE_TAG "$PREVIOUS_TAG"; fi
  env_set APP_VERSION "$PREVIOUS_VERSION"
  docker compose up -d || true
else
  git checkout --quiet "$PREVIOUS_REF" || true
  env_set APP_VERSION "$PREVIOUS_VERSION"
  docker compose up -d --build || true
fi

if wait_ready; then
  ok "previous version (${PREVIOUS_VERSION:-unknown}) restored and available."
else
  warn "the previous version does not respond either: the version is not the problem (database? disk? MinIO?)."
fi

cat >&2 <<ROLLBACK

  ⚠ The CODE has been rolled back; the DATABASE, however, may have been migrated by the
    new version. Prisma migrations cannot be undone: if the old version refuses to run on
    the migrated schema, restore the dump taken just before the update:

      docker compose stop backend worker
      bash scripts/restore.sh db backups/${BACKUP_ID:-<timestamp>}/db.dump
      docker compose up -d backend worker

    Any data written since the update would then be lost: only restore if the instance
    is unusable.

ROLLBACK
exit 1
