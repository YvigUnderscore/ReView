#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# Operations agent: install, status, logs, upgrade, removal.
#
# The agent is what lets the "Admin → Updates" screen ACT — back up, verify a backup,
# switch versions — instead of only displaying the commands. It is optional: without it,
# the screen remains fully readable.
#
# Usage:
#   bash scripts/ops-agent.sh install     # starts the agent and sets up the backend mounts
#   bash scripts/ops-agent.sh status      # what the agent sees, and since when
#   bash scripts/ops-agent.sh logs        # container log
#   bash scripts/ops-agent.sh upgrade     # pulls the agent image of the running version
#   bash scripts/ops-agent.sh restart     # restarts the agent (re-reads deploy/agent.conf)
#   bash scripts/ops-agent.sh uninstall   # stops the agent (backups are kept)
#
# ⚠ WHAT INSTALLING THE AGENT MEANS
#
# The agent mounts `/var/run/docker.sock`. On this machine that is equivalent to root: a
# container that talks to the daemon can start another one with the host disk mounted. That
# is why it is the ONLY one to get it — the backend, reachable from the internet, never
# does — and why its vocabulary is limited to three orders, with no free-form command.
# Permissions live in `deploy/agent.conf`, which the backend does not mount: a stolen admin
# session cannot grant itself what the operator has refused.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OPS_FILE="docker-compose.ops.yml"
OPS_PROJECT="review-ops"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
ok() { printf '\033[0;32m  ✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$1"; }
die() { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# Always this file, always this project. No command in this script touches the main stack:
# that is what guarantees an update's `docker compose up -d` does not recreate the agent
# that is running it.
ops_compose() { docker compose -p "$OPS_PROJECT" -f "$OPS_FILE" "$@"; }

env_get() { sed -n "s/^$1=//p" .env | tail -n 1; }

env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^$key=" .env > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}

[ -f .env ] || die ".env not found — this instance is not installed (bash scripts/install.sh)."
docker compose version >/dev/null 2>&1 || die "\"docker compose\" v2 plugin not found."

# The trap this script exists to avoid: the agent must never be part of the main stack.
if grep -q "^COMPOSE_FILE=.*$OPS_FILE" .env 2>/dev/null; then
  die "$OPS_FILE is listed in COMPOSE_FILE: the agent would belong to the stack it recreates. Remove it from .env."
fi

# ── Backend mounts ───────────────────────────────────────────────────────────
#
# Written to deploy/ — hence NOT versioned, and so preserved by a `git checkout` to an
# older tag. A versioned compose file at the root would vanish during a rollback, and every
# `docker compose` command of the instance would then fail.
write_mounts() {
  mkdir -p deploy backups ops/queue ops/state
  chmod 700 ops ops/queue ops/state 2>/dev/null || true
  cat > deploy/compose.mounts.yml <<'YAML'
# Written by scripts/ops-agent.sh — never versioned.
#
# The privilege split fits in three lines: the backend WRITES to the order queue, READS the
# state read-only, and only sees backups read-only. The agent does the opposite. Without
# this asymmetry, a compromised backend — it runs as root and handles user files — could
# plant a link in `state/` and make the docker daemon write anywhere on the host.
services:
  backend:
    volumes:
      - ./backups:/backups:ro
      - ./ops/queue:/ops/queue
      - ./ops/state:/ops/state:ro
    environment:
      BACKUPS_DIR: /backups
      OPS_QUEUE_DIR: /ops/queue
      OPS_STATE_DIR: /ops/state
YAML
  ok "deploy/compose.mounts.yml written"

  local files
  files="$(env_get COMPOSE_FILE)"
  case "$files" in
    *deploy/compose.mounts.yml*) ;;
    '') die "COMPOSE_FILE missing from .env — instance installed before scripts/install.sh existed? Add it by hand." ;;
    *) env_set COMPOSE_FILE "$files:deploy/compose.mounts.yml"; ok "COMPOSE_FILE updated" ;;
  esac
}

# Agent permissions. Outside every backend mount: this is THE barrier a compromised
# application cannot cross.
write_conf() {
  [ -f deploy/agent.conf ] && { ok "deploy/agent.conf kept"; return 0; }
  mkdir -p deploy
  cat > deploy/agent.conf <<'CONF'
# What the operations agent agrees to run. Read when the agent starts; after a change:
#   bash scripts/ops-agent.sh restart
#
# This file is mounted in NO application container: nobody who obtains an admin session
# can grant themselves here what you refuse.
OPS_ALLOW_UPDATE=1
OPS_ALLOW_BACKUP=1
OPS_ALLOW_VERIFY=1
# Downgrading: refused by default. An older version cannot read an already-migrated
# schema, and the instance would not come back up.
OPS_ALLOW_DOWNGRADE=0
CONF
  chmod 600 deploy/agent.conf
  ok "deploy/agent.conf written (mode 600)"
}

# Agent image: the one of the running version, otherwise derived from the declared prefix.
resolve_image() {
  local image prefix tag
  image="$(env_get REVIEW_OPS_IMAGE)"
  if [ -n "$image" ]; then printf '%s' "$image"; return 0; fi
  prefix="$(env_get REVIEW_IMAGE_PREFIX)"
  tag="$(env_get REVIEW_IMAGE_TAG)"
  [ -n "$prefix" ] || die "neither REVIEW_OPS_IMAGE nor REVIEW_IMAGE_PREFIX in .env: set REVIEW_OPS_IMAGE=<registry>/review-ops:<tag>."
  [ -n "$tag" ] || tag="$(env_get APP_VERSION)"
  [ -n "$tag" ] || die "no known image tag: set REVIEW_IMAGE_TAG in .env."
  printf '%s/review-ops:%s' "$prefix" "$tag"
}

cmd_install() {
  say "Operations agent"
  local image
  image="$(resolve_image)"
  env_set REVIEW_OPS_IMAGE "$image"
  env_set REVIEW_ROOT "$ROOT"
  ok "image: $image"
  write_conf
  write_mounts

  say "Starting the agent (project $OPS_PROJECT)"
  ops_compose pull || warn "image not pulled (registry unreachable?) — trying with what is available locally"
  ops_compose up -d
  ok "agent started"

  say "Applying the mounts to the backend"
  # Without this recreation, the backend keeps running without seeing the order queue: the
  # page would say "no agent" while it is running, and nobody would understand why.
  docker compose up -d backend
  ok "backend recreated with the order queue"

  say "Done"
  echo "  The Admin → Updates screen can now back up and switch versions."
  echo "  Agent status: bash scripts/ops-agent.sh status"
}

cmd_status() {
  say "Container"
  ops_compose ps || true
  say "What the agent sees"
  if [ -f ops/state/agent.json ]; then
    cat ops/state/agent.json
  else
    warn "ops/state/agent.json missing: the agent has never written its state yet."
  fi
  say "Latest operations"
  ls -1 ops/state/runs 2>/dev/null | tail -n 5 || echo "  (none)"
}

cmd_logs() { ops_compose logs --tail="${2:-100}" -f ops; }

cmd_upgrade() {
  say "Upgrading the agent"
  local image
  image="$(env_get REVIEW_IMAGE_PREFIX)"
  [ -n "$image" ] && env_set REVIEW_OPS_IMAGE "$image/review-ops:$(env_get APP_VERSION)"
  ops_compose pull
  ops_compose up -d
  ok "agent at version $(env_get APP_VERSION)"
}

cmd_restart() {
  ops_compose up -d --force-recreate
  ok "agent restarted (deploy/agent.conf re-read)"
}

cmd_uninstall() {
  say "Removing the agent"
  ops_compose down || true
  warn "the backend mounts stay in place (deploy/compose.mounts.yml): the backup catalog"
  warn "keeps working, only execution stops."
  ok "agent stopped"
}

case "${1:-}" in
  install) cmd_install ;;
  status) cmd_status ;;
  logs) cmd_logs "$@" ;;
  upgrade) cmd_upgrade ;;
  restart) cmd_restart ;;
  uninstall) cmd_uninstall ;;
  -h|--help|'') sed -n '6,19p' "$0" ;;
  *) die "unknown command: $1 (install | status | logs | upgrade | restart | uninstall)" ;;
esac
