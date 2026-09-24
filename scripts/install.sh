#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# ReView installer — produces a working instance without editing any file by hand:
# secrets, domain, time zone, data path, nginx configuration, first start, health check,
# then the URL of the setup wizard.
#
# Usage:
#   bash scripts/install.sh                     # interactive (recommended)
#   bash scripts/install.sh --non-interactive \
#        --domain review.studio.tld --tls=letsencrypt --email ops@studio.tld \
#        --timezone Europe/Paris --data-root /mnt/pool/review
#
# Options:
#   --domain <fqdn>        public domain name (or the IP/host name with --tls=none)
#   --tls <mode>           letsencrypt | selfsigned | existing | none   (default: asked)
#   --email <address>      Let's Encrypt contact (required with --tls=letsencrypt)
#   --timezone <TZ>        time zone for timestamps (default: the host's, otherwise UTC)
#   --data-root <path>     root of persistent data (database, objects) on the host
#   --images <prefix>      registry prefix of the published images (default: asked)
#   --image-tag <tag>      image version to install, e.g. v2.3.0 (required with --images)
#   --ops-agent            install the operations agent (backups and updates from the UI)
#   --no-ops-agent         do not install it
#   --non-interactive      ask no questions; any missing answer is an error
#   --force                reinstall over an existing .env (backed up first)
#
# This script ONLY writes untracked files: `.env` and the `deploy/` directory (rendered
# nginx configuration, site compose overlay). No git-tracked file is modified, so updating
# with `git pull` or `git checkout vX.Y.Z` remains possible.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DOMAIN=""
TLS_MODE=""
LE_EMAIL=""
TIMEZONE=""
DATA_ROOT=""
IMAGE_PREFIX=""
IMAGE_TAG=""
OPS_AGENT=""
INTERACTIVE=1
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain requires a value}"; shift 2 ;;
    --domain=*) DOMAIN="${1#*=}"; shift ;;
    --tls) TLS_MODE="${2:?--tls requires a value}"; shift 2 ;;
    --tls=*) TLS_MODE="${1#*=}"; shift ;;
    --email) LE_EMAIL="${2:?--email requires a value}"; shift 2 ;;
    --email=*) LE_EMAIL="${1#*=}"; shift ;;
    --timezone) TIMEZONE="${2:?--timezone requires a value}"; shift 2 ;;
    --timezone=*) TIMEZONE="${1#*=}"; shift ;;
    --data-root) DATA_ROOT="${2:?--data-root requires a value}"; shift 2 ;;
    --data-root=*) DATA_ROOT="${1#*=}"; shift ;;
    --images) IMAGE_PREFIX="${2:?--images requires a registry prefix}"; shift 2 ;;
    --images=*) IMAGE_PREFIX="${1#*=}"; shift ;;
    --image-tag) IMAGE_TAG="${2:?--image-tag requires a tag}"; shift 2 ;;
    --image-tag=*) IMAGE_TAG="${1#*=}"; shift ;;
    --ops-agent) OPS_AGENT=yes; shift ;;
    --no-ops-agent) OPS_AGENT=no; shift ;;
    --non-interactive) INTERACTIVE=0; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '5,32p' "$0"; exit 0 ;;
    *) echo "✗ unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
ok() { printf '\033[0;32m  ✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$1"; }
die() { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# Asks for a value, with a default. In non-interactive mode, a missing value is an error.
ask() {
  local prompt="$1" default="${2:-}" current="${3:-}" answer
  if [ -n "$current" ]; then printf '%s' "$current"; return; fi
  if [ "$INTERACTIVE" -eq 0 ]; then
    [ -n "$default" ] || die "missing answer in non-interactive mode: $prompt"
    printf '%s' "$default"; return
  fi
  read -r -p "  $prompt${default:+ [$default]}: " answer </dev/tty
  printf '%s' "${answer:-$default}"
}

# 32 random bytes in hex. openssl if present, /dev/urandom otherwise: a minimal NAS does
# not always have openssl, and a weak secret would make the backend refuse to start.
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; fi
}

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
say "Prerequisites"
command -v docker >/dev/null 2>&1 || die "docker not found. Install Docker Engine, then run this script again."
docker compose version >/dev/null 2>&1 || die "\"docker compose\" v2 plugin not found."
COMPOSE_VERSION="$(docker compose version --short 2>/dev/null | tr -d 'v')"
COMPOSE_MAJOR="${COMPOSE_VERSION%%.*}"
COMPOSE_REST="${COMPOSE_VERSION#*.}"
COMPOSE_MINOR="${COMPOSE_REST%%.*}"
if [ "${COMPOSE_MAJOR:-0}" -lt 2 ] || { [ "${COMPOSE_MAJOR:-0}" -eq 2 ] && [ "${COMPOSE_MINOR:-0}" -lt 24 ]; }; then
  die "docker compose >= 2.24 required (found ${COMPOSE_VERSION:-unknown}): the production overlay uses \"!reset\"."
fi
docker info >/dev/null 2>&1 || die "the docker daemon is not responding (permissions? service stopped?)."
ok "docker compose $COMPOSE_VERSION"

if [ -f .env ] && [ "$FORCE" -eq 0 ]; then
  die ".env already exists — this instance is installed. To update it: bash scripts/update.sh; to start over: --force."
fi

# ── 2. Answers ───────────────────────────────────────────────────────────────
say "Instance configuration"
DOMAIN="$(ask "Public domain name (e.g. review.studio.tld)" "" "$DOMAIN")"
[ -n "$DOMAIN" ] || die "a domain (or host address) is required: it builds the URLs in emails and share links."
TLS_MODE="$(ask "TLS: letsencrypt / selfsigned / existing / none" "selfsigned" "$TLS_MODE")"
case "$TLS_MODE" in letsencrypt|selfsigned|existing|none) ;; *) die "unknown TLS mode: $TLS_MODE" ;; esac
if [ "$TLS_MODE" = "letsencrypt" ]; then
  LE_EMAIL="$(ask "Let's Encrypt contact address" "" "$LE_EMAIL")"
  [ -n "$LE_EMAIL" ] || die "Let's Encrypt requires a contact address."
fi
HOST_TZ="$(cat /etc/timezone 2>/dev/null || true)"
TIMEZONE="$(ask "Time zone (timestamps of digests and burn-ins)" "${HOST_TZ:-UTC}" "$TIMEZONE")"
DATA_ROOT="$(ask "Root of persistent data (database + media)" "$ROOT/data" "$DATA_ROOT")"

# ── Published images or local build ──────────────────────────────────────────
#
# Published images are the default. Building on the studio's server means compiling
# 3.6 GB (the worker image ships Blender), gives a result that depends on the build date,
# and makes updating from the UI unreasonable on a NAS. Answering "-" falls back to a
# local build.
IMAGE_PREFIX="$(ask "Published images: registry prefix (\"-\" to build locally)" "ghcr.io/yvigunderscore" "$IMAGE_PREFIX")"
case "$IMAGE_PREFIX" in -|none|no) IMAGE_PREFIX="" ;; esac
if [ -n "$IMAGE_PREFIX" ]; then
  IMAGE_TAG="$(ask "Version tag to install (e.g. v2.3.0)" "$IMAGE_TAG" "$IMAGE_TAG")"
  [ -n "$IMAGE_TAG" ] || die "in registry mode the tag is mandatory: no implicit \"latest\" in production (see CHANGELOG.md)."
fi

# ── Operations agent ─────────────────────────────────────────────────────────
#
# Asked explicitly because the answer has a real consequence: the agent mounts the docker
# socket, which is equivalent to root on this machine. In exchange, the admin screen can
# back up and switch versions without anyone opening a terminal. Without it, the screen
# stays readable and displays the commands.
OPS_AGENT="$(ask "Operations agent (backups and updates from the UI): yes/no" "yes" "$OPS_AGENT")"
case "$OPS_AGENT" in o|O|oui|y|Y|yes|true) OPS_AGENT=yes ;; *) OPS_AGENT=no ;; esac

# In "none" mode the stack has no front end: the frontend is published on its host port
# and MinIO must stay reachable from browsers (no nginx serves it). This is the mode for an
# instance behind an existing TLS proxy (TrueNAS, Traefik, a custom nginx) — which is then
# responsible for routing /api/, /socket.io/ and the bucket.
FRONTEND_PORT="${PORT:-3429}"
MINIO_PORT="${MINIO_API_PORT:-9000}"
if [ "$TLS_MODE" = "none" ]; then
  PUBLIC_URL="http://$DOMAIN:$FRONTEND_PORT"
  STORAGE_URL="http://$DOMAIN:$MINIO_PORT"
  warn "\"none\" mode: served unencrypted on $PUBLIC_URL, MinIO exposed on $MINIO_PORT. Only for an instance ALREADY behind a TLS front end."
else
  PUBLIC_URL="https://$DOMAIN"
  STORAGE_URL="https://$DOMAIN"
fi

# ── 3. Secrets and .env file ─────────────────────────────────────────────────
say "Generating secrets"
JWT_SECRET="$(gen_secret)"
APP_ENCRYPTION_KEY="$(gen_secret)"
POSTGRES_PASSWORD="$(gen_secret)"
MINIO_ROOT_PASSWORD="$(gen_secret)"
METRICS_TOKEN="$(gen_secret)"
GRAFANA_ADMIN_PASSWORD="$(gen_secret)"
MINIO_ROOT_USER="review-$(printf '%s' "$(gen_secret)" | cut -c1-12)"
ok "6 random secrets generated (no default password survives this step)"

# `if`, not `[ … ] && …`: under `set -e`, an AND list whose test fails exits the script —
# here, on the very first install, when .env does not exist yet.
if [ -f .env ]; then
  cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)"
fi

# The compose files used by THIS instance, recorded in .env so that a bare `docker compose`
# picks the right stack. This guards against the classic trap: forgetting the second `-f`
# reloads the development overlay and puts the API back in NODE_ENV=development, with its
# safeguards off.
if [ "$TLS_MODE" = "none" ]; then
  COMPOSE_FILES="docker-compose.yml:deploy/compose.site.yml"
else
  COMPOSE_FILES="docker-compose.yml:docker-compose.prod.yml:deploy/compose.site.yml"
fi
# In registry mode, the overlay that replaces `build:` with `image:`. It goes AFTER the
# production overlay and BEFORE the site overlay: the order decides which one wins.
if [ -n "$IMAGE_PREFIX" ]; then
  COMPOSE_FILES="${COMPOSE_FILES%:deploy/compose.site.yml}:docker-compose.release.yml:deploy/compose.site.yml"
fi
# The backend mounts (backups, order queue) are added by ops-agent.sh, which extends
# COMPOSE_FILE itself. Nothing to add here — and never docker-compose.ops.yml, which
# belongs to a separate compose project.

cat > .env <<ENV
# ReView — configuration of this instance, written by scripts/install.sh on $(date -Iseconds).
# Variables not listed here keep their default: see .env.example, which documents them
# all. This file is loaded into the backend and worker containers.

# This instance's stack. With these two lines, "docker compose up -d" is enough: no
# forgotten -f, no accidental return to the development overlay. The separator is explicit
# because it otherwise depends on the OS (";" on Windows): setting it here makes the same
# configuration readable everywhere, including from a development machine.
COMPOSE_PATH_SEPARATOR=:
COMPOSE_FILE=$COMPOSE_FILES

APP_URL=$PUBLIC_URL
CORS_ORIGIN=$PUBLIC_URL
S3_PUBLIC_ENDPOINT=$STORAGE_URL
SITE_DOMAIN=$DOMAIN
$([ "$TLS_MODE" = "none" ] && echo "MINIO_BIND=0.0.0.0" || echo "# MinIO is only reachable through nginx (no host port).")
TZ=$TIMEZONE
DATA_ROOT=$DATA_ROOT

# Repository path on THIS machine, and compose project name. Both are used by the
# operations agent: it mounts the repository at this exact path — scripts/backup.sh passes
# its pwd verbatim to "docker run -v", which the daemon resolves on the host — and finds
# the containers by this prefix when "docker compose ps" does not return them.
REVIEW_ROOT=$ROOT
COMPOSE_PROJECT_NAME=$(basename "$ROOT" | tr '[:upper:]' '[:lower:]')

# Running version: read by the API (/api/version), the About screen and monitoring.
# scripts/update.sh rewrites it on every switch.
APP_VERSION=${IMAGE_TAG:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo "source")}
$([ -n "$IMAGE_PREFIX" ] && printf 'REVIEW_IMAGE_PREFIX=%s\nREVIEW_IMAGE_TAG=%s\nREVIEW_OPS_IMAGE=%s/review-ops:%s' "$IMAGE_PREFIX" "$IMAGE_TAG" "$IMAGE_PREFIX" "$IMAGE_TAG" || echo "# Local build: no published images (see DOCUMENTATION/getting-started/updating.md).")

JWT_SECRET=$JWT_SECRET
APP_ENCRYPTION_KEY=$APP_ENCRYPTION_KEY
POSTGRES_USER=review
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=review
MINIO_ROOT_USER=$MINIO_ROOT_USER
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD
S3_BUCKET=review
METRICS_TOKEN=$METRICS_TOKEN
GRAFANA_ADMIN_PASSWORD=$GRAFANA_ADMIN_PASSWORD
ALLOW_SELF_REGISTRATION=false
ENV
chmod 600 .env
ok ".env written (mode 600)"

# ── 4. Site configuration ────────────────────────────────────────────────────
say "Site configuration"

# Does persistent data go into a host directory? Yes — except under Docker Desktop
# (Windows, macOS), where that directory reaches the VM through a translation layer that
# does not honour the expected write guarantees. Postgres dies there first: "could not
# write to log file … I/O error", "global/pg_filenode.map: Bad address", a panic mid-write
# and a restart into recovery — when it does not lose data. MinIO and Redis write less
# aggressively, but nothing protects them either. On that daemon all three therefore use
# Docker-managed volumes, i.e. the VM's ext4.
#
# What the administrator retrieves from the host is not the content of these volumes
# anyway — a cluster directory or a MinIO backend cannot be read by hand — but `backups/`,
# where scripts/backup.sh drops a pg_dump and a mirror of the bucket.
DATA_BIND=1
case "$(docker info --format '{{.OperatingSystem}}' 2>/dev/null)" in
  *"Docker Desktop"*) DATA_BIND=0 ;;
esac

mkdir -p deploy
if [ "$DATA_BIND" = "1" ]; then
  mkdir -p "$DATA_ROOT/postgres" "$DATA_ROOT/minio" "$DATA_ROOT/redis"
  DATA_LOCATION="$DATA_ROOT"
else
  DATA_LOCATION="Docker-managed volumes (Docker Desktop: a host directory is not safe storage there)"
fi
ok "persistent data: $DATA_LOCATION"

# Backups and order queue. `backups/` holds a copy of .env — hence the instance's secrets —
# and `ops/` records who ordered each operation: neither may be readable by every user of
# the machine.
mkdir -p backups ops/queue ops/state
chmod 700 backups ops ops/queue ops/state 2>/dev/null || true
ok "backups and order queue: $ROOT/backups, $ROOT/ops"

# nginx/nginx.conf is a TRACKED file: it is never modified (a git update would then
# conflict). A rendered copy goes into deploy/, which the overlay below mounts instead.
if [ "$TLS_MODE" != "none" ]; then
  sed "s/YOUR_DOMAIN/$DOMAIN/g" nginx/nginx.conf > deploy/nginx.conf
  ok "deploy/nginx.conf rendered for $DOMAIN"
fi

{
  echo "# Overlay for THIS instance — written by scripts/install.sh, never versioned."
  echo "# It holds what depends on the site: domain, data location."
  echo "services:"
  if [ "$TLS_MODE" != "none" ]; then
    echo "  nginx:"
    echo "    volumes:"
    echo "      - ./deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro"
    echo "      - ./nginx/certs:/etc/nginx/certs:ro"
  else
    # Nothing to override: the base stack already publishes frontend and MinIO. Repeating
    # `ports:` here would add them up (compose concatenates lists) and the second binding
    # would fail.
    echo "  frontend: {}"
  fi
  # A studio's media must not land in /var/lib/docker/volumes: on a NAS that is the system
  # pool, not the data pool the administrator chose. Hence the bind — except where the host
  # is not safe storage, see DATA_BIND above.
  echo "volumes:"
  for pair in "pgdata:postgres" "miniodata:minio" "redisdata:redis"; do
    echo "  ${pair%%:*}:"
    echo "    driver: local"
    if [ "$DATA_BIND" = "0" ]; then
      continue
    fi
    echo "    driver_opts:"
    echo "      type: none"
    echo "      o: bind"
    echo "      device: $DATA_ROOT/${pair##*:}"
  done
} > deploy/compose.site.yml
ok "deploy/compose.site.yml written"

# ── 5. Certificates ──────────────────────────────────────────────────────────
case "$TLS_MODE" in
  existing)
    say "Certificates"
    [ -f nginx/certs/fullchain.pem ] && [ -f nginx/certs/privkey.pem ] \
      || die "nginx/certs/fullchain.pem and privkey.pem expected (\"existing\" mode)."
    ok "certificates found"
    ;;
  selfsigned)
    say "Self-signed certificate"
    mkdir -p nginx/certs
    docker run --rm -v "$ROOT/nginx/certs:/certs" alpine/openssl req -x509 -nodes -days 825 \
      -newkey rsa:2048 -keyout /certs/privkey.pem -out /certs/fullchain.pem \
      -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN" >/dev/null 2>&1 \
      || die "could not generate the certificate."
    warn "Self-signed certificate: browsers will show a warning. Switch to letsencrypt as soon as DNS points here."
    ;;
  letsencrypt)
    say "Let's Encrypt certificate"
    mkdir -p nginx/certs deploy/letsencrypt
    docker run --rm -p 80:80 -v "$ROOT/deploy/letsencrypt:/etc/letsencrypt" certbot/certbot \
      certonly --standalone --non-interactive --agree-tos -m "$LE_EMAIL" -d "$DOMAIN" \
      || die "certbot failed: port 80 must be free and $DOMAIN must point to this machine."
    cp "deploy/letsencrypt/live/$DOMAIN/fullchain.pem" nginx/certs/fullchain.pem
    cp "deploy/letsencrypt/live/$DOMAIN/privkey.pem" nginx/certs/privkey.pem
    ok "certificate obtained (renewal: see DOCUMENTATION/getting-started/installation.md)"
    ;;
esac

# ── 6. Startup ───────────────────────────────────────────────────────────────
say "Building and starting the stack"
docker compose up -d --build

say "Waiting for the API to become ready"
READY=0
for _ in $(seq 1 60); do
  if docker compose exec -T backend node -e \
    "fetch('http://127.0.0.1:3000/health/ready').then(r=>r.json()).then(j=>process.exit(j.status==='ready'?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then READY=1; break; fi
  sleep 5
done
if [ "$READY" -ne 1 ]; then
  docker compose ps
  die "the API did not become ready within 5 minutes. Diagnose with: docker compose logs --tail=100 backend"
fi
ok "database, Redis and storage reachable from the API"

# ── 7. Operations agent ──────────────────────────────────────────────────────
#
# Installed last, and never blocking: an instance whose agent does not start is still a
# working instance. Only the buttons would be lost — not the service.
if [ "$OPS_AGENT" = "yes" ]; then
  say "Operations agent"
  if [ -z "$IMAGE_PREFIX" ]; then
    warn "build mode: the agent is not installed (its image is not published here)."
    warn "Backups and updates remain commands: scripts/backup.sh, scripts/update.sh."
  elif bash scripts/ops-agent.sh install; then
    ok "the admin screen can back up and switch versions"
  else
    warn "the agent did not start — the instance works, the screen will display the commands."
    warn "Diagnose with: bash scripts/ops-agent.sh status"
  fi
fi

say "Installation complete"
cat <<SUMMARY

  Open now: $PUBLIC_URL/setup
  (first-run setup wizard: studio name and first administrator;
   it closes as soon as a studio exists.)

  Files written (untracked) : .env, deploy/
  Persistent data           : $DATA_LOCATION
  Backup                    : bash scripts/backup.sh
  Update                    : bash scripts/update.sh
  Monitoring (optional)     : docker compose --profile monitoring up -d

SUMMARY
