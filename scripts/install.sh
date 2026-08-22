#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# Installateur ReView — produit une instance fonctionnelle sans qu'aucun fichier ne soit
# édité à la main : secrets, domaine, fuseau, chemin des données, configuration nginx,
# premier démarrage, contrôle de santé, puis l'URL de l'assistant d'installation.
#
# Usage :
#   bash scripts/install.sh                     # interactif (recommandé)
#   bash scripts/install.sh --non-interactive \
#        --domain review.studio.tld --tls=letsencrypt --email ops@studio.tld \
#        --timezone Europe/Paris --data-root /mnt/pool/review
#
# Options :
#   --domain <fqdn>        nom de domaine public (ou l'IP/hôte en mode --tls=none)
#   --tls <mode>           letsencrypt | selfsigned | existing | none   (défaut : demandé)
#   --email <adresse>      contact Let's Encrypt (requis pour --tls=letsencrypt)
#   --timezone <TZ>        fuseau des horodatages (défaut : celui de l'hôte, sinon UTC)
#   --data-root <chemin>   racine des données persistantes (base, objets) sur l'hôte
#   --non-interactive      ne pose aucune question ; toute réponse manquante = erreur
#   --force                réinstalle par-dessus un .env existant (le sauvegarde avant)
#
# Ce script N'ÉCRIT QUE des fichiers non versionnés : `.env` et le répertoire `deploy/`
# (configuration nginx rendue, surcouche compose du site). Aucun fichier suivi par git
# n'est modifié — une mise à jour par `git pull` ou `git checkout vX.Y.Z` reste possible.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DOMAIN=""
TLS_MODE=""
LE_EMAIL=""
TIMEZONE=""
DATA_ROOT=""
INTERACTIVE=1
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain attend une valeur}"; shift 2 ;;
    --domain=*) DOMAIN="${1#*=}"; shift ;;
    --tls) TLS_MODE="${2:?--tls attend une valeur}"; shift 2 ;;
    --tls=*) TLS_MODE="${1#*=}"; shift ;;
    --email) LE_EMAIL="${2:?--email attend une valeur}"; shift 2 ;;
    --email=*) LE_EMAIL="${1#*=}"; shift ;;
    --timezone) TIMEZONE="${2:?--timezone attend une valeur}"; shift 2 ;;
    --timezone=*) TIMEZONE="${1#*=}"; shift ;;
    --data-root) DATA_ROOT="${2:?--data-root attend une valeur}"; shift 2 ;;
    --data-root=*) DATA_ROOT="${1#*=}"; shift ;;
    --non-interactive) INTERACTIVE=0; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '5,30p' "$0"; exit 0 ;;
    *) echo "✗ option inconnue : $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
ok() { printf '\033[0;32m  ✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$1"; }
die() { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# Demande une valeur, avec défaut. En mode non interactif, l'absence est une erreur.
ask() {
  local prompt="$1" default="${2:-}" current="${3:-}" answer
  if [ -n "$current" ]; then printf '%s' "$current"; return; fi
  if [ "$INTERACTIVE" -eq 0 ]; then
    [ -n "$default" ] || die "réponse manquante en mode non interactif : $prompt"
    printf '%s' "$default"; return
  fi
  read -r -p "  $prompt${default:+ [$default]} : " answer </dev/tty
  printf '%s' "${answer:-$default}"
}

# 32 octets aléatoires en hexadécimal. openssl si présent, /dev/urandom sinon : un NAS
# minimal n'a pas toujours openssl, et un secret faible ferait refuser le démarrage.
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; fi
}

# ── 1. Prérequis ─────────────────────────────────────────────────────────────
say "Prérequis"
command -v docker >/dev/null 2>&1 || die "docker introuvable. Installer Docker Engine puis relancer."
docker compose version >/dev/null 2>&1 || die "plugin « docker compose » v2 introuvable."
COMPOSE_VERSION="$(docker compose version --short 2>/dev/null | tr -d 'v')"
COMPOSE_MAJOR="${COMPOSE_VERSION%%.*}"
COMPOSE_REST="${COMPOSE_VERSION#*.}"
COMPOSE_MINOR="${COMPOSE_REST%%.*}"
if [ "${COMPOSE_MAJOR:-0}" -lt 2 ] || { [ "${COMPOSE_MAJOR:-0}" -eq 2 ] && [ "${COMPOSE_MINOR:-0}" -lt 24 ]; }; then
  die "docker compose ≥ 2.24 requis (trouvé ${COMPOSE_VERSION:-inconnu}) : la surcouche de production utilise « !reset »."
fi
docker info >/dev/null 2>&1 || die "le démon docker ne répond pas (droits ? service arrêté ?)."
ok "docker compose $COMPOSE_VERSION"

if [ -f .env ] && [ "$FORCE" -eq 0 ]; then
  die ".env existe déjà — cette instance est installée. Pour la mettre à jour : bash scripts/update.sh ; pour repartir de zéro : --force."
fi

# ── 2. Réponses ──────────────────────────────────────────────────────────────
say "Configuration de l'instance"
DOMAIN="$(ask "Nom de domaine public (ex. review.studio.tld)" "" "$DOMAIN")"
[ -n "$DOMAIN" ] || die "un domaine (ou une adresse d'hôte) est indispensable : il fabrique les URL des emails et des liens de partage."
TLS_MODE="$(ask "TLS : letsencrypt / selfsigned / existing / none" "selfsigned" "$TLS_MODE")"
case "$TLS_MODE" in letsencrypt|selfsigned|existing|none) ;; *) die "mode TLS inconnu : $TLS_MODE" ;; esac
if [ "$TLS_MODE" = "letsencrypt" ]; then
  LE_EMAIL="$(ask "Adresse de contact Let's Encrypt" "" "$LE_EMAIL")"
  [ -n "$LE_EMAIL" ] || die "Let's Encrypt exige une adresse de contact."
fi
HOST_TZ="$(cat /etc/timezone 2>/dev/null || true)"
TIMEZONE="$(ask "Fuseau horaire (horodatage des digests et des burn-ins)" "${HOST_TZ:-UTC}" "$TIMEZONE")"
DATA_ROOT="$(ask "Racine des données persistantes (base + médias)" "$ROOT/data" "$DATA_ROOT")"

# En mode « none », la pile n'a pas de frontal : le frontend est publié sur son port hôte
# et MinIO doit rester joignable des navigateurs (aucun nginx ne le sert). C'est le mode
# d'une instance placée derrière un proxy TLS déjà en place (TrueNAS, Traefik, un nginx
# maison) — à qui il revient alors de router /api/, /socket.io/ et le bucket.
FRONTEND_PORT="${PORT:-3429}"
MINIO_PORT="${MINIO_API_PORT:-9000}"
if [ "$TLS_MODE" = "none" ]; then
  PUBLIC_URL="http://$DOMAIN:$FRONTEND_PORT"
  STORAGE_URL="http://$DOMAIN:$MINIO_PORT"
  warn "Mode « none » : servi en clair sur $PUBLIC_URL, MinIO exposé sur $MINIO_PORT. À réserver à une instance DÉJÀ derrière un frontal TLS."
else
  PUBLIC_URL="https://$DOMAIN"
  STORAGE_URL="https://$DOMAIN"
fi

# ── 3. Secrets et fichier .env ───────────────────────────────────────────────
say "Génération des secrets"
JWT_SECRET="$(gen_secret)"
APP_ENCRYPTION_KEY="$(gen_secret)"
POSTGRES_PASSWORD="$(gen_secret)"
MINIO_ROOT_PASSWORD="$(gen_secret)"
METRICS_TOKEN="$(gen_secret)"
GRAFANA_ADMIN_PASSWORD="$(gen_secret)"
MINIO_ROOT_USER="review-$(printf '%s' "$(gen_secret)" | cut -c1-12)"
ok "6 secrets tirés au hasard (aucun mot de passe par défaut ne survit à cette étape)"

# `if` et non `[ … ] && …` : sous `set -e`, une liste ET dont le test échoue fait sortir le
# script — ici, à la toute première installation, celle où .env n'existe pas encore.
if [ -f .env ]; then
  cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)"
fi

# Les fichiers compose utilisés par CETTE instance, posés dans .env : un `docker compose`
# nu prend alors la bonne pile. C'est le garde-fou du piège documenté partout ailleurs —
# oublier le second `-f` recharge l'overlay de développement et repasse l'API en
# NODE_ENV=development, garde-fous éteints.
if [ "$TLS_MODE" = "none" ]; then
  COMPOSE_FILES="docker-compose.yml:deploy/compose.site.yml"
else
  COMPOSE_FILES="docker-compose.yml:docker-compose.prod.yml:deploy/compose.site.yml"
fi

cat > .env <<ENV
# ReView — configuration de cette instance, écrite par scripts/install.sh le $(date -Iseconds).
# Les variables non listées ici gardent leur défaut : voir .env.example, qui les documente
# toutes. Ce fichier est chargé dans les conteneurs backend et worker.

# Pile de cette instance. Grâce à ces deux lignes, « docker compose up -d » suffit : ni
# oubli de -f, ni retour accidentel à l'overlay de développement. Le séparateur est
# explicite parce qu'il dépend sinon du système (« ; » sous Windows) : le poser ici rend
# la même configuration lisible partout, y compris depuis un poste de développement.
COMPOSE_PATH_SEPARATOR=:
COMPOSE_FILE=$COMPOSE_FILES

APP_URL=$PUBLIC_URL
CORS_ORIGIN=$PUBLIC_URL
S3_PUBLIC_ENDPOINT=$STORAGE_URL
SITE_DOMAIN=$DOMAIN
$([ "$TLS_MODE" = "none" ] && echo "MINIO_BIND=0.0.0.0" || echo "# MinIO n'est joignable qu'à travers nginx (aucun port hôte).")
TZ=$TIMEZONE
DATA_ROOT=$DATA_ROOT

# Version en service : lue par l'API (/api/version), l'écran « À propos » et la
# supervision. scripts/update.sh la réécrit à chaque bascule.
APP_VERSION=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo "source")

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
ok ".env écrit (droits 600)"

# ── 4. Rendu de la configuration du site ─────────────────────────────────────
say "Configuration du site"
mkdir -p deploy "$DATA_ROOT/postgres" "$DATA_ROOT/minio" "$DATA_ROOT/redis"
ok "données persistantes : $DATA_ROOT"

# nginx/nginx.conf est un fichier VERSIONNÉ : on ne le modifie pas (une mise à jour par
# git s'y casserait les dents). On en rend une copie dans deploy/, que la surcouche
# ci-dessous monte à sa place.
if [ "$TLS_MODE" != "none" ]; then
  sed "s/YOUR_DOMAIN/$DOMAIN/g" nginx/nginx.conf > deploy/nginx.conf
  ok "deploy/nginx.conf rendu pour $DOMAIN"
fi

{
  echo "# Surcouche de CETTE instance — écrite par scripts/install.sh, jamais versionnée."
  echo "# Elle porte ce qui dépend du site : domaine, emplacement des données."
  echo "services:"
  if [ "$TLS_MODE" != "none" ]; then
    echo "  nginx:"
    echo "    volumes:"
    echo "      - ./deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro"
    echo "      - ./nginx/certs:/etc/nginx/certs:ro"
  else
    # Rien à surcharger : la pile de base publie déjà frontend et MinIO. Redonner un
    # `ports:` ici les additionnerait (compose concatène les listes) et le second
    # rattachement échouerait.
    echo "  frontend: {}"
  fi
  # Les médias d'un studio ne doivent pas atterrir dans /var/lib/docker/volumes : sur un
  # NAS, c'est le pool système, pas le pool de données choisi par l'administrateur.
  echo "volumes:"
  for pair in "pgdata:postgres" "miniodata:minio" "redisdata:redis"; do
    echo "  ${pair%%:*}:"
    echo "    driver: local"
    echo "    driver_opts:"
    echo "      type: none"
    echo "      o: bind"
    echo "      device: $DATA_ROOT/${pair##*:}"
  done
} > deploy/compose.site.yml
ok "deploy/compose.site.yml écrit"

# ── 5. Certificats ───────────────────────────────────────────────────────────
case "$TLS_MODE" in
  existing)
    say "Certificats"
    [ -f nginx/certs/fullchain.pem ] && [ -f nginx/certs/privkey.pem ] \
      || die "nginx/certs/fullchain.pem et privkey.pem attendus (mode « existing »)."
    ok "certificats trouvés"
    ;;
  selfsigned)
    say "Certificat auto-signé"
    mkdir -p nginx/certs
    docker run --rm -v "$ROOT/nginx/certs:/certs" alpine/openssl req -x509 -nodes -days 825 \
      -newkey rsa:2048 -keyout /certs/privkey.pem -out /certs/fullchain.pem \
      -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN" >/dev/null 2>&1 \
      || die "génération du certificat impossible."
    warn "Certificat auto-signé : les navigateurs afficheront un avertissement. Repasser en letsencrypt dès que le DNS pointe ici."
    ;;
  letsencrypt)
    say "Certificat Let's Encrypt"
    mkdir -p nginx/certs deploy/letsencrypt
    docker run --rm -p 80:80 -v "$ROOT/deploy/letsencrypt:/etc/letsencrypt" certbot/certbot \
      certonly --standalone --non-interactive --agree-tos -m "$LE_EMAIL" -d "$DOMAIN" \
      || die "certbot a échoué : le port 80 doit être libre et $DOMAIN doit pointer vers cette machine."
    cp "deploy/letsencrypt/live/$DOMAIN/fullchain.pem" nginx/certs/fullchain.pem
    cp "deploy/letsencrypt/live/$DOMAIN/privkey.pem" nginx/certs/privkey.pem
    ok "certificat obtenu (renouvellement : cf. DOCUMENTATION/getting-started/installation.md)"
    ;;
esac

# ── 6. Démarrage ─────────────────────────────────────────────────────────────
say "Construction et démarrage de la pile"
docker compose up -d --build

say "Attente de la disponibilité de l'API"
READY=0
for _ in $(seq 1 60); do
  if docker compose exec -T backend node -e \
    "fetch('http://127.0.0.1:3000/health/ready').then(r=>r.json()).then(j=>process.exit(j.status==='ready'?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then READY=1; break; fi
  sleep 5
done
if [ "$READY" -ne 1 ]; then
  docker compose ps
  die "l'API n'est pas devenue disponible en 5 minutes. Diagnostic : docker compose logs --tail=100 backend"
fi
ok "base, Redis et stockage joignables depuis l'API"

say "Installation terminée"
cat <<SUMMARY

  Ouvrir maintenant : $PUBLIC_URL/setup
  (assistant de première installation : nom du studio et premier administrateur ;
   il se ferme dès qu'un studio existe.)

  Fichiers écrits (non versionnés) : .env, deploy/
  Données persistantes             : $DATA_ROOT
  Sauvegarde                       : bash scripts/backup.sh
  Mise à jour                      : bash scripts/update.sh
  Supervision (optionnelle)        : docker compose --profile monitoring up -d

SUMMARY
