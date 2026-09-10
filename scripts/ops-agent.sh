#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# Agent d'exploitation : installation, état, journaux, mise à jour, retrait.
#
# L'agent est ce qui permet à l'écran « Admin → Mises à jour » d'AGIR — sauvegarder,
# vérifier une sauvegarde, basculer de version — au lieu de se contenter d'afficher les
# commandes. Il est facultatif : sans lui, l'écran reste entièrement lisible.
#
# Usage :
#   bash scripts/ops-agent.sh install     # démarre l'agent et branche les montages
#   bash scripts/ops-agent.sh status      # ce que l'agent voit, et depuis quand
#   bash scripts/ops-agent.sh logs        # journal du conteneur
#   bash scripts/ops-agent.sh upgrade     # récupère l'image de la version en service
#   bash scripts/ops-agent.sh uninstall   # arrête l'agent (les sauvegardes restent)
#
# ⚠ CE QU'INSTALLER L'AGENT SIGNIFIE
#
# L'agent monte `/var/run/docker.sock`. Sur cette machine, cela vaut root : un conteneur
# qui parle au démon peut en démarrer un autre avec le disque hôte monté. C'est pour cela
# qu'il est SEUL à l'avoir — le backend, lui, est joignable depuis internet et ne le reçoit
# jamais — et que son vocabulaire se limite à trois ordres, sans commande libre. Les
# autorisations vivent dans `deploy/agent.conf`, que le backend ne monte pas : une session
# d'administration volée ne peut pas s'accorder ce que l'exploitant a refusé.
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

# Toujours ce fichier, toujours ce projet. Aucune commande de ce script ne touche la pile
# principale : c'est ce qui garantit qu'un `docker compose up -d` de mise à jour ne recrée
# pas l'agent en train de l'exécuter.
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

[ -f .env ] || die ".env introuvable — cette instance n'est pas installée (bash scripts/install.sh)."
docker compose version >/dev/null 2>&1 || die "plugin « docker compose » v2 introuvable."

# Le piège que ce script existe pour ne pas reproduire.
if grep -q "^COMPOSE_FILE=.*$OPS_FILE" .env 2>/dev/null; then
  die "$OPS_FILE est listé dans COMPOSE_FILE : l'agent appartiendrait à la pile qu'il recrée. Le retirer de .env."
fi

# ── Montages du backend ──────────────────────────────────────────────────────
#
# Écrits dans deploy/ — donc NON versionnés, et donc préservés par un `git checkout` vers
# une étiquette antérieure. Un fichier compose versionné à la racine disparaîtrait pendant
# un retour arrière, et toute commande `docker compose` de l'instance échouerait ensuite.
write_mounts() {
  mkdir -p deploy backups ops/queue ops/state
  chmod 700 ops ops/queue ops/state 2>/dev/null || true
  cat > deploy/compose.mounts.yml <<'YAML'
# Écrit par scripts/ops-agent.sh — jamais versionné.
#
# Le partage des privilèges tient en trois lignes : le backend ÉCRIT dans la file d'ordres,
# LIT l'état en lecture seule, et ne voit les sauvegardes qu'en lecture. L'agent fait
# l'inverse. Sans cette asymétrie, un backend compromis — il tourne en root et traite des
# fichiers d'utilisateurs — pourrait pré-poser un lien dans `state/` et faire écrire le
# démon docker n'importe où sur l'hôte.
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
  ok "deploy/compose.mounts.yml écrit"

  local files
  files="$(env_get COMPOSE_FILE)"
  case "$files" in
    *deploy/compose.mounts.yml*) ;;
    '') die "COMPOSE_FILE absent de .env — instance installée avant scripts/install.sh ? L'ajouter à la main." ;;
    *) env_set COMPOSE_FILE "$files:deploy/compose.mounts.yml"; ok "COMPOSE_FILE complété" ;;
  esac
}

# Autorisations de l'agent. Hors de tout montage du backend : c'est LA barrière qu'une
# compromission de l'application ne franchit pas.
write_conf() {
  [ -f deploy/agent.conf ] && { ok "deploy/agent.conf conservé"; return 0; }
  mkdir -p deploy
  cat > deploy/agent.conf <<'CONF'
# Ce que l'agent d'exploitation accepte d'exécuter. Lu à son démarrage ; après une
# modification : bash scripts/ops-agent.sh restart
#
# Ce fichier n'est monté dans AUCUN conteneur de l'application : personne qui obtiendrait
# une session d'administration ne peut s'accorder ici ce que vous refusez.
OPS_ALLOW_UPDATE=1
OPS_ALLOW_BACKUP=1
OPS_ALLOW_VERIFY=1
# Redescendre de version : refusé par défaut. Une version antérieure ne sait pas lire un
# schéma déjà migré, et l'instance ne remonterait pas.
OPS_ALLOW_DOWNGRADE=0
CONF
  chmod 600 deploy/agent.conf
  ok "deploy/agent.conf écrit (droits 600)"
}

# Image de l'agent : celle de la version en service, sinon celle du préfixe déclaré.
resolve_image() {
  local image prefix tag
  image="$(env_get REVIEW_OPS_IMAGE)"
  if [ -n "$image" ]; then printf '%s' "$image"; return 0; fi
  prefix="$(env_get REVIEW_IMAGE_PREFIX)"
  tag="$(env_get REVIEW_IMAGE_TAG)"
  [ -n "$prefix" ] || die "ni REVIEW_OPS_IMAGE ni REVIEW_IMAGE_PREFIX dans .env : poser REVIEW_OPS_IMAGE=<registre>/review-ops:<étiquette>."
  [ -n "$tag" ] || tag="$(env_get APP_VERSION)"
  [ -n "$tag" ] || die "aucune étiquette d'image connue : poser REVIEW_IMAGE_TAG dans .env."
  printf '%s/review-ops:%s' "$prefix" "$tag"
}

cmd_install() {
  say "Agent d'exploitation"
  local image
  image="$(resolve_image)"
  env_set REVIEW_OPS_IMAGE "$image"
  env_set REVIEW_ROOT "$ROOT"
  ok "image : $image"
  write_conf
  write_mounts

  say "Démarrage de l'agent (projet $OPS_PROJECT)"
  ops_compose pull || warn "image non récupérée (registre injoignable ?) — tentative avec ce qui est local"
  ops_compose up -d
  ok "agent démarré"

  say "Prise en compte des montages par le backend"
  # Sans cette recréation, le backend continue de tourner sans voir la file d'ordres : la
  # page dirait « aucun agent » alors qu'il tourne, et personne ne comprendrait pourquoi.
  docker compose up -d backend
  ok "backend recréé avec la file d'ordres"

  say "Terminé"
  echo "  L'écran Admin → Mises à jour peut désormais sauvegarder et basculer de version."
  echo "  État de l'agent : bash scripts/ops-agent.sh status"
}

cmd_status() {
  say "Conteneur"
  ops_compose ps || true
  say "Ce que l'agent voit"
  if [ -f ops/state/agent.json ]; then
    cat ops/state/agent.json
  else
    warn "ops/state/agent.json absent : l'agent n'a encore jamais écrit son état."
  fi
  say "Dernières opérations"
  ls -1 ops/state/runs 2>/dev/null | tail -n 5 || echo "  (aucune)"
}

cmd_logs() { ops_compose logs --tail="${2:-100}" -f ops; }

cmd_upgrade() {
  say "Mise à jour de l'agent"
  local image
  image="$(env_get REVIEW_IMAGE_PREFIX)"
  [ -n "$image" ] && env_set REVIEW_OPS_IMAGE "$image/review-ops:$(env_get APP_VERSION)"
  ops_compose pull
  ops_compose up -d
  ok "agent en version $(env_get APP_VERSION)"
}

cmd_restart() {
  ops_compose up -d --force-recreate
  ok "agent redémarré (deploy/agent.conf relu)"
}

cmd_uninstall() {
  say "Retrait de l'agent"
  ops_compose down || true
  warn "les montages du backend restent en place (deploy/compose.mounts.yml) : le catalogue"
  warn "des sauvegardes continue de fonctionner, l'exécution s'arrête."
  ok "agent arrêté"
}

case "${1:-}" in
  install) cmd_install ;;
  status) cmd_status ;;
  logs) cmd_logs "$@" ;;
  upgrade) cmd_upgrade ;;
  restart) cmd_restart ;;
  uninstall) cmd_uninstall ;;
  -h|--help|'') sed -n '6,19p' "$0" ;;
  *) die "commande inconnue : $1 (install | status | logs | upgrade | restart | uninstall)" ;;
esac
