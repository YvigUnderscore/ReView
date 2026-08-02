#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# Suite de validation ReView — à exécuter AVANT de valider/committer du code.
#
# Usage :
#   bash scripts/validate.sh                 # checks sans services (typecheck, build, lint, tests unit)
#   bash scripts/validate.sh --with-integration   # ajoute les tests d'intégration (nécessite Postgres+Redis+MinIO)
#   bash scripts/validate.sh --with-e2e            # intégration + smoke Playwright (navigateur requis ; E2E_CHANNEL=msedge en local)
#
# Sortie : échoue (exit 1) au premier check rouge. Tout vert = code validable.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WITH_INTEGRATION=0
WITH_E2E=0
[[ "${1:-}" == "--with-integration" ]] && WITH_INTEGRATION=1
[[ "${1:-}" == "--with-e2e" ]] && { WITH_INTEGRATION=1; WITH_E2E=1; }

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

# ---------- Licence ----------
# Chaque fichier source porte son en-tête SPDX (AGPL-3.0-or-later) : un fichier extrait
# du dépôt reste ainsi rattaché à sa licence.
step "Licence — en-têtes SPDX sur tous les fichiers source"
node "$ROOT/scripts/add-license-headers.mjs" --check

# Attribution des dépendances redistribuées (MIT/BSD/ISC/OFL exigent la conservation de
# leurs notices). Le fichier est généré : il doit refléter l'état des lockfiles.
step "Licence — THIRD-PARTY-NOTICES.md à jour"
node "$ROOT/scripts/generate-notices.mjs" --check

# ---------- Budget de taille (10.F4) ----------
# Le frontend est couvert par la règle ESLint `max-lines` (300, skipComments). Le backend
# n'a pas d'ESLint : on garde-fou ici la taille des routes (≤ 200 lignes ; la logique
# métier vit dans services/). Étend la suite, ne l'affaiblit jamais.
# Les deux lignes de l'en-tête SPDX ne sont pas du code : elles sortent du décompte, le
# budget de 200 lignes réelles reste identique.
step "Budget — taille des routes backend (≤ 200 lignes)"
OVER_BUDGET="$(
  find "$ROOT/backend/src/routes" -name '*.ts' | while read -r f; do
    n=$(wc -l <"$f")
    if head -1 "$f" | grep -q '^// SPDX-FileCopyrightText'; then
      n=$((n - 2))                                             # les deux lignes SPDX
      [ -z "$(sed -n '3p' "$f" | tr -d '\r')" ] && n=$((n - 1)) # + sa ligne de séparation
    fi
    if [ "$n" -gt 200 ]; then printf '  %s (%s lignes)\n' "${f#"$ROOT/"}" "$n"; fi
  done
)" || true
if [ -n "$OVER_BUDGET" ]; then
  printf '\033[0;31m✗ Routes backend au-dessus du budget (200 lignes) :\n%s\033[0m\n' "$OVER_BUDGET"
  printf '\033[0;31m  → extraire la logique métier vers services/ (cf. 10.D8).\033[0m\n'
  exit 1
fi

# ---------- Backend ----------
step "Backend — format (prettier --check)"
( cd "$ROOT/backend" && npm run format:check )

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
step "Frontend — format (prettier --check)"
( cd "$ROOT/frontend" && npm run format:check )

step "Frontend — lint (eslint)"
( cd "$ROOT/frontend" && npm run lint )

step "Frontend — typecheck (tsc --noEmit)"
( cd "$ROOT/frontend" && npm run typecheck )

step "Frontend — tests unitaires (vitest)"
( cd "$ROOT/frontend" && npm test )

step "Frontend — build (vite build)"
( cd "$ROOT/frontend" && npm run build )

if [[ "$WITH_E2E" == "1" ]]; then
  step "E2E — smoke Playwright (parcours critique, lance backend+frontend)"
  ( cd "$ROOT/frontend" && npm run test:e2e )
fi

printf '\n\033[1;32m✅ Validation complète : tout est vert. Code validable.\033[0m\n'
