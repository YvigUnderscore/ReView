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

# Le dépôt : celui qui contient ce script, sauf si `REVIEW_ROOT` en désigne un autre.
#
# Cette dérogation existe pour une raison précise. En mode construction, ce script fait
# `git checkout`, ce qui RÉÉCRIT le fichier que bash est en train de lire au fil de l'eau :
# l'interpréteur reprend alors sa lecture à un décalage devenu faux, dans un fichier
# différent. L'agent d'exploitation copie donc ce script hors du dépôt avant de le lancer,
# et lui dit par cette variable où le dépôt se trouve vraiment.
ROOT="${REVIEW_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
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

# ── Gardes d'arguments ───────────────────────────────────────────────────────
#
# Ces deux valeurs viennent de la ligne de commande — donc, depuis que l'administration
# peut commander une mise à jour, d'un ordre déposé par l'application.
#
# `READY_TIMEOUT` finit dans « $(( SECONDS + READY_TIMEOUT )) », et bash ré-évalue le
# CONTENU d'une variable rencontrée dans une expression arithmétique : « x[$(commande)] »
# s'y exécute. Le filtre numérique n'est pas une politesse, c'est la fermeture d'une
# exécution arbitraire — et il est doublé côté agent, qui ne fait confiance à personne.
case "$READY_TIMEOUT" in
  ''|*[!0-9]*) die "--timeout attend un nombre de secondes (reçu : $READY_TIMEOUT)" ;;
esac
# `TARGET` finit en argument de `git checkout` et de `docker compose` : un tiret initial en
# ferait une option, un espace une seconde valeur.
case "${TARGET:-none}" in
  -*|*[!A-Za-z0-9._/-]*) die "version invalide : $TARGET" ;;
esac

# ── Jalons ───────────────────────────────────────────────────────────────────
#
# Le code de sortie ne dit pas OÙ l'on s'est arrêté : « la sauvegarde a échoué, rien n'a
# bougé » et « la bascule a eu lieu, on est revenu en arrière » valent tous deux 1. Ces
# jalons, lisibles par une machine, sont ce que l'écran d'administration affiche en clair.
phase() {
  printf 'OPS_PHASE=%s\n' "$1"
  if [ -n "${OPS_PHASE_FILE:-}" ]; then printf 'OPS_PHASE=%s\n' "$1" >> "$OPS_PHASE_FILE"; fi
}

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

phase precheck
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
  phase backup
  say "Sauvegarde préalable"
  # `tee -a "$fichier"` et non « tee /dev/stderr » : /dev/stderr est un lien vers le
  # descripteur 2, que `tee` rouvre en ÉCRITURE — donc en troncature. Tant que la sortie
  # d'erreur était un terminal, cela ne se voyait pas ; dès qu'elle est un fichier — ce
  # qu'elle devient dès qu'une mise à jour est commandée autrement qu'au clavier — le
  # journal de l'exécution repartait à zéro au moment précis de la sauvegarde.
  BACKUP_LOG="$(mktemp)"
  if ! bash scripts/backup.sh 2>&1 | tee -a "$BACKUP_LOG"; then
    rm -f "$BACKUP_LOG"
    die "la sauvegarde n'a pas abouti — mise à jour interrompue."
  fi
  BACKUP_ID="$(sed -n 's/^BACKUP_ID=//p' "$BACKUP_LOG" | tail -n 1)"
  rm -f "$BACKUP_LOG"
  [ -n "$BACKUP_ID" ] || die "la sauvegarde n'a pas abouti — mise à jour interrompue."
  ok "sauvegarde $BACKUP_ID"
else
  warn "sauvegarde sautée (--no-backup) : aucun retour arrière de la base ne sera possible."
fi

# ── 2. Bascule ───────────────────────────────────────────────────────────────
#
# ⚠ `docker compose up -d` n'est JAMAIS lancé nu ici, et c'est le point le plus important
# de ce script. `worker` et `frontend` dépendent tous deux de `backend: service_healthy`
# (docker-compose.yml) : un backend qui ne devient pas sain — une migration Prisma en
# échec, le cas de panne le plus courant d'une mise à jour — fait sortir `up -d` en erreur.
# Sous `set -e`, le script mourait alors ICI, c'est-à-dire AVANT la section 4 : le retour
# arrière automatique, seule promesse de sécurité de cette commande, ne s'exécutait pas
# dans la situation même pour laquelle il existe. On retient l'échec, on ne l'obéit pas.
phase switch
SWITCH_FAILED=0
say "Bascule vers la nouvelle version"
if [ "$MODE" = "registre" ]; then
  # Pas de « latest » implicite en production : une instance doit pouvoir dire quelle
  # version elle exécute, et un retour arrière suppose de connaître la précédente.
  [ -n "$TARGET" ] || die "mode registre : préciser la version, ex. --version v2.3.0 (voir CHANGELOG.md)."
  NEW_VERSION="$TARGET"
  env_set REVIEW_IMAGE_TAG "$NEW_VERSION"
  env_set APP_VERSION "$NEW_VERSION"
  # Échec de récupération : `.env` désigne déjà l'étiquette visée. La laisser telle quelle
  # rendrait TOUTE commande `docker compose` ultérieure impossible — y compris celle par
  # laquelle l'exploitant essaierait de s'en sortir. On repose l'étiquette qui tourne.
  if ! docker compose pull; then
    if [ -n "$PREVIOUS_TAG" ]; then env_set REVIEW_IMAGE_TAG "$PREVIOUS_TAG"; fi
    env_set APP_VERSION "$PREVIOUS_VERSION"
    die "récupération des images impossible (registre injoignable ? version inexistante ?)"
  fi
  if ! docker compose up -d; then SWITCH_FAILED=1; fi
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
  if ! docker compose up -d --build; then SWITCH_FAILED=1; fi
fi
if [ "$SWITCH_FAILED" -eq 0 ]; then ok "conteneurs recréés"; else warn "la recréation des conteneurs a signalé une erreur"; fi

# ── 3. Vérification ──────────────────────────────────────────────────────────
phase health
say "Contrôle de santé (base, Redis, stockage)"
if [ "$SWITCH_FAILED" -eq 0 ] && wait_ready; then
  ok "instance disponible en version $NEW_VERSION"
  docker compose exec -T backend node -e \
    "fetch('http://127.0.0.1:3000/api/version').then(r=>r.text()).then(t=>console.log('  '+t))" 2>/dev/null || true
  say "Mise à jour terminée"
  echo "  Nouveautés : DOCUMENTATION/CHANGELOG.md — journal de version : CHANGELOG.md"
  if [ -n "$BACKUP_ID" ]; then echo "  Sauvegarde conservée : $BACKUP_ID"; fi
  phase done
  exit 0
fi

# ── 4. Retour arrière ────────────────────────────────────────────────────────
phase rollback
if [ "$SWITCH_FAILED" -eq 1 ]; then
  warn "la bascule elle-même a échoué — retour arrière."
else
  warn "l'instance n'est pas disponible après $READY_TIMEOUT s — retour arrière."
fi
docker compose logs --tail=50 backend || true

# Mêmes précautions qu'à la bascule : si la version précédente ne remonte pas non plus,
# le script doit atteindre le message d'exploitation ci-dessous, qui est tout ce qui reste.
if [ "$MODE" = "registre" ]; then
  if [ -n "$PREVIOUS_TAG" ]; then env_set REVIEW_IMAGE_TAG "$PREVIOUS_TAG"; fi
  env_set APP_VERSION "$PREVIOUS_VERSION"
  docker compose up -d || true
else
  git checkout --quiet "$PREVIOUS_REF" || true
  env_set APP_VERSION "$PREVIOUS_VERSION"
  docker compose up -d --build || true
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
