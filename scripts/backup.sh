#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# Sauvegarde ReView : dump PostgreSQL + copie des objets, horodatée, avec rotation.
#
# Usage : bash scripts/backup.sh [dossier]        (défaut : ./backups)
#   BACKUP_KEEP=7            nombre de sauvegardes conservées (rotation)
#   BACKUP_MODE=mirror       mirror (défaut) | archive
#   COMPOSE_PROJECT=…        préfixe des conteneurs, si `docker compose ps` ne les trouve pas
#
# ── Pourquoi un miroir plutôt qu'une archive ─────────────────────────────────
# La version précédente empaquetait le volume MinIO ENTIER dans un tar à chaque passage,
# et en gardait sept. À 300 Go de rushes, cela demande 2,1 To de sauvegarde pour 300 Go de
# données, et une nuit ne suffit plus à écrire le tar.
#
# Le mode `mirror` (défaut) tient une copie vivante du bucket (`minio-current/`) que `mc`
# met à jour de façon incrémentale — seuls les objets nouveaux ou modifiés traversent le
# réseau — puis en fige un instantané par LIENS DURS. Un instantané ne coûte donc que ses
# différences : sept rétentions d'un bucket de 300 Go où 2 Go changent chaque jour occupent
# ~312 Go, pas 2,1 To. Un média n'est jamais réécrit dans ReView (une correction = une
# nouvelle version), ce qui rend ce modèle particulièrement efficace ici.
#
# Le mode `archive` conserve l'ancien comportement (un tar.gz autonome par passage) : plus
# simple à recopier hors site, acceptable tant que le bucket est petit.
#
# Disposition produite :
#   backups/
#     minio-current/          miroir vivant du bucket (mode mirror)
#     20260822-030000/
#       db.dump               pg_dump -Fc
#       minio/                instantané par liens durs (mode mirror)
#       minio.tar.gz          archive complète (mode archive)
#       manifest.txt          version, date, mode, tailles
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="${1:-./backups}"
KEEP="${BACKUP_KEEP:-7}"
MODE="${BACKUP_MODE:-mirror}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR/$STAMP"
# Chemin hôte absolu (pwd -W = chemin Windows sous Git Bash ; MSYS_NO_PATHCONV coupe la
# réécriture des chemins conteneur type /backup → C:/Program Files/Git/backup).
HOST_DIR="$(cd "$BACKUP_DIR" && (pwd -W 2>/dev/null || pwd))"

# Conteneur d'un service : par le compose du répertoire courant (qui suit COMPOSE_FILE de
# .env), avec repli sur la convention de nommage pour un appel hors du projet.
container_of() {
  local service="$1" id
  id="$(docker compose ps -q "$service" 2>/dev/null || true)"
  [ -n "$id" ] || id="${COMPOSE_PROJECT:-review-app}-${service}-1"
  printf '%s' "$id"
}

PG="$(container_of postgres)"
MINIO="$(container_of minio)"

echo "▶ Dump PostgreSQL (pg_dump -Fc)…"
docker exec "$PG" sh -c 'pg_dump -Fc -U "${POSTGRES_USER:-review}" "${POSTGRES_DB:-review}"' \
  > "$BACKUP_DIR/$STAMP/db.dump"
[ -s "$BACKUP_DIR/$STAMP/db.dump" ] || { echo "✗ dump vide" >&2; exit 1; }

# Le fichier d'environnement fait partie de la sauvegarde.
#
# Sans lui, une restauration sur une machine neuve rend une partie des données illisibles :
# les identifiants ShotGrid, les jetons d'API et les secrets 2FA sont chiffrés en base avec
# une clé dérivée de `JWT_SECRET`. Restaurer `db.dump` sous un nouveau secret redonne des
# lignes présentes mais indéchiffrables — une panne silencieuse, découverte le jour où l'on
# en a le plus besoin.
#
# C'est un fichier de secrets : il est écrit en 600 et le dossier de sauvegarde doit être
# protégé en conséquence. Le manifeste le rappelle.
if [ -f .env ]; then
  install -m 600 .env "$BACKUP_DIR/$STAMP/env.backup" 2>/dev/null \
    || { cp .env "$BACKUP_DIR/$STAMP/env.backup" && chmod 600 "$BACKUP_DIR/$STAMP/env.backup"; }
  echo "▶ .env sauvegardé (secrets — dossier à protéger)"
else
  echo "⚠ .env introuvable : les secrets chiffrés en base ne seront pas déchiffrables après restauration" >&2
fi

# Identifiants et bucket lus dans le conteneur lui-même : le .env de l'hôte peut différer
# (variables imposées par le compose), le conteneur, lui, dit la vérité.
S3_USER="$(docker exec "$MINIO" printenv MINIO_ROOT_USER 2>/dev/null || echo minioadmin)"
S3_PASS="$(docker exec "$MINIO" printenv MINIO_ROOT_PASSWORD 2>/dev/null || echo minioadmin)"
BUCKET="$(docker exec "$(container_of backend)" printenv S3_BUCKET 2>/dev/null || echo review)"

case "$MODE" in
  mirror)
    echo "▶ Miroir incrémental du bucket « $BUCKET »…"
    # Créé ici et pas par `mc` : sur un bucket encore vide, mirror ne crée rien et
    # l'instantané suivant échouerait sur une source absente.
    mkdir -p "$BACKUP_DIR/minio-current"
    # --network container:… : on emprunte la pile réseau de MinIO, donc 127.0.0.1:9000 le
    # joint sans avoir à deviner le nom du réseau compose.
    # Sortie standard jetée : `mc` liste chaque objet transféré, ce qui remplit la boîte
    # mail de l'exploitant à chaque passage nocturne. Les erreurs, elles, sont sur stderr.
    MSYS_NO_PATHCONV=1 docker run --rm --network "container:$MINIO" \
      -e "MC_HOST_review=http://$S3_USER:$S3_PASS@127.0.0.1:9000" \
      -v "$HOST_DIR:/backup" minio/mc \
      mirror --overwrite --remove --quiet "review/$BUCKET" /backup/minio-current >/dev/null

    echo "▶ Instantané par liens durs…"
    MSYS_NO_PATHCONV=1 docker run --rm -v "$HOST_DIR:/backup" alpine \
      sh -c "cp -al /backup/minio-current /backup/$STAMP/minio"
    ;;
  archive)
    echo "▶ Archive complète du volume MinIO…"
    MSYS_NO_PATHCONV=1 docker run --rm --volumes-from "$MINIO" -v "$HOST_DIR:/backup" alpine \
      tar czf "/backup/$STAMP/minio.tar.gz" -C / data
    ;;
  *)
    echo "✗ BACKUP_MODE inconnu : $MODE (mirror | archive)" >&2
    exit 1
    ;;
esac

# Manifeste : sans lui, une sauvegarde ne dit pas de quelle version elle vient — et une
# restauration de base sous une version d'application plus ancienne échoue au démarrage.
{
  echo "date=$(date -Iseconds)"
  echo "mode=$MODE"
  echo "bucket=$BUCKET"
  echo "app_version=$(sed -n 's/^APP_VERSION=//p' .env 2>/dev/null | tail -n 1)"
  echo "db_bytes=$(wc -c < "$BACKUP_DIR/$STAMP/db.dump" | tr -d ' ')"
  # Dit à la restauration si les secrets suivent — donc si les identifiants ShotGrid et les
  # jetons d'API seront déchiffrables une fois la base remontée ailleurs.
  echo "env_included=$([ -f "$BACKUP_DIR/$STAMP/env.backup" ] && echo yes || echo no)"
} > "$BACKUP_DIR/$STAMP/manifest.txt"

echo "▶ Rotation (conserve les $KEEP plus récentes)…"
# Les instantanés partagent leurs blocs : en supprimer un ne libère que ce qui n'existe
# plus ailleurs. On ne touche jamais à minio-current, qui EST le miroir.
# `|| true` : sur une première sauvegarde, la rotation n'a rien à purger et plusieurs
# maillons du tuyau sortent en erreur — ce n'est pas un échec de sauvegarde.
{
  ls -1d "$BACKUP_DIR"/*/ 2>/dev/null \
    | grep -Ev '/minio-current/$' \
    | sort -r \
    | tail -n +$((KEEP + 1)) \
    | while read -r dir; do rm -rf "$dir" && echo "  purgé : $dir"; done
} || true

echo "✅ Sauvegarde terminée : $BACKUP_DIR/$STAMP"
# Dernière ligne lisible par une machine (scripts/update.sh la récupère).
echo "BACKUP_ID=$STAMP"
