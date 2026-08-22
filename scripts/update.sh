#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# Mise à jour d'une instance ReView : sauvegarde, bascule, migrations, contrôle de santé,
# et retour arrière automatique si la sonde échoue.
#
# Usage :
#   bash scripts/update.sh                       # dernière version de la branche suivie
#   bash scripts/update.sh --version v2.3.0      # version précise (étiquette git ou image)
#   bash scripts/update.sh --no-backup --yes     # sans sauvegarde (déconseillé), sans question
#
# Options :
#   --version <vX.Y.Z>  version cible : étiquette git (mode construction) ou étiquette
#                       d'image (mode registre, quand .env définit REVIEW_IMAGE_PREFIX)
#   --no-backup         saute la sauvegarde préalable
#   --yes               ne demande aucune confirmation
#   --timeout <sec>     attente maximale de la sonde de disponibilité (défaut : 300)
#
# Deux modes, choisis d'après `.env` :
#   • **registre** — REVIEW_IMAGE_PREFIX est défini : les images publiées sont récupérées
#     (`docker compose pull`), rien n'est construit sur le serveur du studio ;
#   • **construction** — sinon : `git checkout <version>` puis `up -d --build`.
#
# Les migrations sont jouées par le conteneur backend à son démarrage (backend/start.sh,
# `prisma migrate deploy`, sans repli destructif). Une migration en échec empêche l'API de
# répondre : la sonde échoue, le retour arrière s'enclenche.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET=""
DO_BACKUP=1
ASSUME_YES=0
READY_TIMEOUT=300

while [ $# -gt 0 ]; do
  case "$1" in
    --version) TARGET="${2:?--version attend une valeur}"; shift 2 ;;
    --version=*) TARGET="${1#*=}"; shift ;;
    --no-backup) DO_BACKUP=0; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --timeout) READY_TIMEOUT="${2:?--timeout attend une valeur}"; shift 2 ;;
    --timeout=*) READY_TIMEOUT="${1#*=}"; shift ;;
    -h|--help) sed -n '5,30p' "$0"; exit 0 ;;
    *) echo "✗ option inconnue : $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
ok() { printf '\033[0;32m  ✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$1"; }
die() { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f .env ] || die ".env introuvable — cette instance n'est pas installée (bash scripts/install.sh)."
docker compose version >/dev/null 2>&1 || die "plugin « docker compose » v2 introuvable."

# Lit une variable de .env sans exécuter le fichier (une valeur avec espaces ou $ ne doit
# pas être interprétée par le shell).
env_get() {
  sed -n "s/^$1=//p" .env | tail -n 1
}

# Pose (ou remplace) une variable dans .env, en place.
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^$key=" .env > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}

# Sonde de DISPONIBILITÉ, depuis l'intérieur du conteneur : pas d'hypothèse sur les ports
# hôte (la production n'en publie aucun) ni sur le frontal TLS.
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
MODE="construction"
# `if` et non `[ … ] && …` : sous `set -e`, une liste ET dont le test échoue fait sortir le
# script — ici, le mode construction, c'est-à-dire le cas courant.
if [ -n "$IMAGE_PREFIX" ]; then MODE="registre"; fi

say "Mise à jour de ReView (mode $MODE)"
echo "  version en service : ${PREVIOUS_VERSION:-inconnue}"
echo "  version visée      : ${TARGET:-dernière disponible}"

if [ "$ASSUME_YES" -eq 0 ]; then
  read -r -p "  Continuer ? [o/N] " answer </dev/tty
  case "$answer" in o|O|y|Y) ;; *) die "annulé." ;; esac
fi

# ── 1. Sauvegarde ────────────────────────────────────────────────────────────
BACKUP_ID=""
if [ "$DO_BACKUP" -eq 1 ]; then
  say "Sauvegarde préalable"
  BACKUP_ID="$(bash scripts/backup.sh | tee /dev/stderr | sed -n 's/^BACKUP_ID=//p' | tail -n 1)"
  [ -n "$BACKUP_ID" ] || die "la sauvegarde n'a pas abouti — mise à jour interrompue."
  ok "sauvegarde $BACKUP_ID"
else
  warn "sauvegarde sautée (--no-backup) : aucun retour arrière de la base ne sera possible."
fi

# ── 2. Bascule ───────────────────────────────────────────────────────────────
say "Bascule vers la nouvelle version"
if [ "$MODE" = "registre" ]; then
  # Pas de « latest » implicite en production : une instance doit pouvoir dire quelle
  # version elle exécute, et un retour arrière suppose de connaître la précédente.
  [ -n "$TARGET" ] || die "mode registre : préciser la version, ex. --version v2.3.0 (voir CHANGELOG.md)."
  NEW_VERSION="$TARGET"
  env_set REVIEW_IMAGE_TAG "$NEW_VERSION"
  env_set APP_VERSION "$NEW_VERSION"
  docker compose pull || die "récupération des images impossible (registre injoignable ? version inexistante ?)"
  docker compose up -d
else
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "mode construction hors dépôt git : impossible de changer de version."
  PREVIOUS_REF="$(git rev-parse HEAD)"
  [ -z "$(git status --porcelain --untracked-files=no)" ] \
    || die "des fichiers suivis sont modifiés localement — les valider ou les défaire avant la mise à jour."
  git fetch --tags --quiet
  if [ -n "$TARGET" ]; then
    git checkout --quiet "$TARGET" || die "version inconnue : $TARGET"
  else
    git pull --ff-only --quiet || die "mise à jour du dépôt impossible (historique divergent)."
  fi
  NEW_VERSION="$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD)"
  env_set APP_VERSION "$NEW_VERSION"
  docker compose up -d --build
fi
ok "conteneurs recréés"

# ── 3. Vérification ──────────────────────────────────────────────────────────
say "Contrôle de santé (base, Redis, stockage)"
if wait_ready; then
  ok "instance disponible en version $NEW_VERSION"
  docker compose exec -T backend node -e \
    "fetch('http://127.0.0.1:3000/api/version').then(r=>r.text()).then(t=>console.log('  '+t))" 2>/dev/null || true
  say "Mise à jour terminée"
  echo "  Nouveautés : DOCUMENTATION/CHANGELOG.md — journal de version : CHANGELOG.md"
  if [ -n "$BACKUP_ID" ]; then echo "  Sauvegarde conservée : $BACKUP_ID"; fi
  exit 0
fi

# ── 4. Retour arrière ────────────────────────────────────────────────────────
warn "l'instance n'est pas disponible après $READY_TIMEOUT s — retour arrière."
docker compose logs --tail=50 backend || true

if [ "$MODE" = "registre" ]; then
  if [ -n "$PREVIOUS_TAG" ]; then env_set REVIEW_IMAGE_TAG "$PREVIOUS_TAG"; fi
  env_set APP_VERSION "$PREVIOUS_VERSION"
  docker compose up -d
else
  git checkout --quiet "$PREVIOUS_REF"
  env_set APP_VERSION "$PREVIOUS_VERSION"
  docker compose up -d --build
fi

if wait_ready; then
  ok "version précédente (${PREVIOUS_VERSION:-inconnue}) rétablie et disponible."
else
  warn "la version précédente ne répond pas non plus : le problème n'est pas la version (base ? disque ? MinIO ?)."
fi

cat >&2 <<ROLLBACK

  ⚠ Le CODE est revenu en arrière ; la BASE, elle, a pu être migrée par la version
    suivante. Les migrations Prisma ne se défont pas : si l'ancienne version refuse de
    fonctionner sur le schéma migré, restaurer le dump pris juste avant :

      docker compose stop backend worker
      bash scripts/restore.sh db backups/${BACKUP_ID:-<horodatage>}/db.dump
      docker compose up -d backend worker

    Toute donnée écrite depuis la mise à jour serait alors perdue : ne restaurer que si
    l'instance est inutilisable.

ROLLBACK
exit 1
