#!/usr/bin/env bash
#
# Suite de validation ReView — à exécuter AVANT de valider/committer du code.
#
# Usage :
#   bash scripts/validate.sh                 # checks sans services (typecheck, build, lint, tests unit)
#   bash scripts/validate.sh --with-integration   # ajoute les tests d'intégration (nécessite Postgres+Redis+MinIO)
#
# Sortie : échoue (exit 1) au premier check rouge. Tout vert = code validable.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WITH_INTEGRATION=0
[[ "${1:-}" == "--with-integration" ]] && WITH_INTEGRATION=1

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

# ---------- Backend ----------
step "Backend — typecheck (tsc --noEmit)"
( cd "$ROOT/backend" && npm run typecheck )

step "Backend — build (prisma generate + tsc)"
( cd "$ROOT/backend" && npm run build )

step "Backend — tests unitaires (vitest)"
( cd "$ROOT/backend" && npm test )

if [[ "$WITH_INTEGRATION" == "1" ]]; then
  step "Backend — tests d'intégration (vitest, nécessite Postgres+Redis+MinIO)"
  ( cd "$ROOT/backend" && npm run test:integration )
else
  printf '\033[0;33m⏭  Tests d'\''intégration ignorés (relancer avec --with-integration + stack docker).\033[0m\n'
fi

# ---------- Frontend ----------
step "Frontend — lint (eslint)"
( cd "$ROOT/frontend" && npm run lint )

step "Frontend — typecheck (tsc --noEmit)"
( cd "$ROOT/frontend" && npm run typecheck )

step "Frontend — build (vite build)"
( cd "$ROOT/frontend" && npm run build )

printf '\n\033[1;32m✅ Validation complète : tout est vert. Code validable.\033[0m\n'
