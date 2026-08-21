#!/bin/sh
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

set -e

# Messages en anglais : ce script est le point d'entrée de l'image, sa sortie est lue dans
# `docker logs` par des exploitants qui suivent une documentation elle-même en anglais.

echo "[start] Generating the Prisma client..."
npx prisma generate

# ── Schéma de base de données ────────────────────────────────────────────────────────────
#
# `prisma migrate deploy` et RIEN d'autre. Le repli historique
#   npx prisma migrate deploy 2>/dev/null || npx prisma db push --accept-data-loss
# alignait la base sur le schéma en SUPPRIMANT colonnes et tables dès que `migrate deploy`
# échouait — migration marquée en échec, drift, Postgres indisponible une seconde de trop
# au démarrage — et le `2>/dev/null` effaçait la cause. Avec `restart: always`, la séquence
# se rejouait en boucle jusqu'à ce que la base soit conforme… et vide.
#
# On échoue donc bruyamment : stderr conservé, sortie non nulle, base intacte.
#
# Initialisation VOLONTAIRE d'une base vide sans migrations versionnées (greenfield, dev) :
# poser PRISMA_DB_PUSH=1. `db push` est invoqué SANS `--accept-data-loss` — s'il devait
# détruire des données, il refuse de lui-même. Refusé en production.
if [ "${PRISMA_DB_PUSH:-0}" = "1" ]; then
  if [ "${NODE_ENV:-development}" = "production" ]; then
    echo "[start] FATAL: PRISMA_DB_PUSH=1 is refused when NODE_ENV=production." >&2
    echo "[start] Production databases are migrated with versioned migrations only." >&2
    exit 1
  fi
  echo "[start] PRISMA_DB_PUSH=1 — pushing the schema (development only, data loss refused)..."
  npx prisma db push
else
  echo "[start] Applying database migrations (prisma migrate deploy)..."
  if ! npx prisma migrate deploy; then
    echo "[start] FATAL: 'prisma migrate deploy' failed. The database was left untouched." >&2
    echo "[start] Inspect the migration state ('npx prisma migrate status') and fix it before" >&2
    echo "[start] restarting the container. Do NOT push the schema onto a database that holds" >&2
    echo "[start] data: it drops the columns and tables the schema no longer declares." >&2
    exit 1
  fi
fi

echo "[start] Starting the application..."
exec node dist/server.js
