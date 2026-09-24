#!/bin/sh
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

set -e

# Image entry point: its output is read in `docker logs` by operators, so messages stay in
# English, like the documentation.

# The Prisma client is generated when the IMAGE IS BUILT (npm ci -> postinstall). Regenerating
# it here would cost ~10 s on EVERY start (including `restart: always` restarts) and would
# fail anyway: the container runs as `node` (uid 1000) while node_modules belongs to root and
# is deliberately read-only. The fallback branch is for a development mount where
# node_modules comes from the host.
if [ -d node_modules/.prisma/client ]; then
  echo "[start] Prisma client already generated at image build."
else
  echo "[start] Generating the Prisma client..."
  npx prisma generate
fi

# ── Database schema ──────────────────────────────────────────────────────────────────────
#
# `prisma migrate deploy` and NOTHING else. ⚠ Never add a fallback such as
#   npx prisma migrate deploy 2>/dev/null || npx prisma db push --accept-data-loss
# It aligns the database with the schema by DROPPING columns and tables whenever
# `migrate deploy` fails (failed migration, drift, Postgres not ready yet at startup), and
# `2>/dev/null` hides the cause. With `restart: always` the sequence loops until the database
# matches the schema... and is empty.
#
# So fail loudly instead: stderr kept, non-zero exit, database untouched.
#
# DELIBERATE initialisation of an empty database without versioned migrations (greenfield,
# dev): set PRISMA_DB_PUSH=1. `db push` runs WITHOUT `--accept-data-loss`, so it refuses on its
# own to destroy data. Refused in production.
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
