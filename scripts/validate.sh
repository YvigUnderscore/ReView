#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# ReView validation suite — run BEFORE validating/committing code.
#
# Usage :
#   bash scripts/validate.sh                 # checks sans services (typecheck, build, lint, tests unit)
#   bash scripts/validate.sh --with-integration   # adds the integration tests (requires Postgres+Redis+MinIO)
#   bash scripts/validate.sh --with-e2e            # integration + Playwright smoke (browser required; E2E_CHANNEL=msedge locally)
#   bash scripts/validate.sh --with-shotgrid       # + end-to-end ShotGrid harness (running ReView backend required)
#
# Options combine: `--with-integration --with-shotgrid` is valid.
#
# Exit: fails (exit 1) at the first red check. All green = code is valid.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WITH_INTEGRATION=0
WITH_E2E=0
WITH_SHOTGRID=0
for arg in "$@"; do
  case "$arg" in
    --with-integration) WITH_INTEGRATION=1 ;;
    --with-e2e) WITH_INTEGRATION=1; WITH_E2E=1 ;;
    --with-shotgrid) WITH_SHOTGRID=1 ;;
    *) printf '\033[0;31m✗ Option inconnue : %s\033[0m\n' "$arg"; exit 1 ;;
  esac
done

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
skip() { printf '\033[0;33m⏭  %s\033[0m\n' "$1"; }

# ---------- Licence ----------
# Every source file carries its SPDX header (AGPL-3.0-or-later): a file extracted
# from the repository thus stays tied to its licence.
step "Licence — en-têtes SPDX sur tous les fichiers source"
node "$ROOT/scripts/add-license-headers.mjs" --check

# Attribution of redistributed dependencies (MIT/BSD/ISC/OFL require the preservation of
# their notices). The file is generated: it must reflect the state of the lockfiles.
step "Licence — THIRD-PARTY-NOTICES.md à jour"
node "$ROOT/scripts/generate-notices.mjs" --check

# ---------- Traductions ----------
# An incomplete translation is accepted (falls back to English); an inconsistent translation
# is not: lost interpolated variable, missing plural form for the language, orphan key,
# business term translated. The script also measures coverage per language.
step "i18n — cohérence des catalogues de traduction"
node "$ROOT/scripts/check-translations.mjs"

# A complete catalogue does not prove that the interface uses it: this check reports the
# French strings left hard-coded (ratchet — the count can only go down).
step "i18n — chaînes en dur dans le frontend"
node "$ROOT/scripts/check-untranslated.mjs"

# The symmetric fault, which the previous check cannot see: a key that reaches
# the screen as is ("task.status.todo" instead of "To do"), for lack of a `t()`.
# A bare key looks like a technical identifier, so the hard-coded text detector
# rightly sets it aside — this one queries the types rather than the text.
step "i18n — clés de traduction affichées brutes"
node "$ROOT/scripts/check-raw-keys.mjs"

# The third possible fault: a key that stays in the catalogue although nobody
# displays it. It costs little on screen but a lot in review — fourteen translations to
# maintain for a dead message — and blurs the coverage measure. The script existed
# since the i18n migration without being wired in here; it is now, catalogues cleaned.
step "i18n — clés de traduction jamais affichées"
node "$ROOT/scripts/check-unused-keys.mjs"

# The backend does not go through the catalogues: its error messages surface as they are
# on screen, including on the public page of a client share. The decision is to
# write them in English — this check stops French from creeping back (D2).
step "i18n — messages d'erreur du backend en anglais"
node "$ROOT/scripts/check-backend-english.mjs"

# ---------- Theme ----------
# "Colours = theme tokens": a raw-palette Tailwind class (bg-blue-500…)
# or an arbitrary colour (bg-[#…]) escapes the theme and breaks dark/light consistency.
step "Thème — couleurs hors tokens (classes Tailwind brutes)"
node "$ROOT/scripts/check-color-tokens.mjs"

# A font size in pixels ignores the density setting (which acts on the root in rem).
step "Thème — tailles de texte en pixels"
node "$ROOT/scripts/check-text-sizes.mjs"

# ---------- Documentation ----------
# `DOCUMENTATION/` is a deliverable: committed, served in-app on /docs, read on GitHub. A link
# that is dead or a missing figure do not fail a build there — they only show up when
# clicked, that is, too late. The check verifies the preamble of each page
# (title, subtitle, date), the resolution of each internal link and anchor, the
# presence of each image, and the conformity of SVG figures (viewBox, title, dark theme).
step "Documentation — préambules, liens, images et figures"
node "$ROOT/scripts/check-docs.mjs"

# ---------- Outillage racine ----------
# The root scripts (suite checks, ShotGrid simulator, i18n) are code
# like any other: linted (via the backend's ESLint) and formatted like the rest.
step "Outillage — lint des scripts racine (eslint)"
node "$ROOT/scripts/lint-scripts.mjs"

step "Outillage — format des scripts racine (prettier --check)"
( cd "$ROOT" && ./backend/node_modules/.bin/prettier --check "scripts/**/*.mjs" )

# A shell script with broken syntax is only discovered at run time — bash -n sees it beforehand.
step "Outillage — syntaxe des scripts shell (bash -n)"
for f in "$ROOT"/scripts/*.sh; do bash -n "$f"; done

# Les workers appellent quatre scripts Python en production (analyse USD, conversion GLB,
# thumbnail, LUT baking) that nothing compiled or linted: a syntax error was not
# discovered until a studio's first USD upload. `compileall` sees it without running the
# code, and without requiring the dependencies (usd-core, PyOpenColorIO) a workstation lacks.
# `PYTHONPYCACHEPREFIX` sends the `__pycache__` files out of the repository: the check dirties nothing.
step "Outillage — syntaxe des scripts Python des workers (compileall)"
PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys' >/dev/null 2>&1; then
    PY="$candidate"; break
  fi
done
if [ -z "$PY" ]; then
  # Skip cleanly: the suite must stay runnable on a workstation without the interpreter.
  skip "Python absent : contrôle des scripts des workers sauté."
else
  PYTHONPYCACHEPREFIX="$(mktemp -d)" "$PY" -m compileall -q \
    "$ROOT/backend/src/workers/usd" "$ROOT/backend/src/workers/ocio"
  # `ruff` is not a dependency of the repository: present, we use it; absent, we carry on.
  if command -v ruff >/dev/null 2>&1; then
    step "Outillage — lint des scripts Python (ruff)"
    ruff check "$ROOT/backend/src/workers/usd" "$ROOT/backend/src/workers/ocio"
  fi
fi

# ---------- Budget de taille (10.F4) ----------
# The frontend is covered by the ESLint rule `max-lines` (300, skipComments). On the
# backend, we guard here the size of the routes (≤ 200 lines; the business logic lives
# in services/) — a budget specific to the routes, distinct from the backend ESLint lint.
# Extends the suite, never weakens it.
# The two lines of the SPDX header are not code: they are left out of the count, the
# budget of 200 real lines stays identical.
step "Budget — taille des routes backend (≤ 200 lignes)"
OVER_BUDGET="$(
  find "$ROOT/backend/src/routes" -name '*.ts' | while read -r f; do
    n=$(wc -l <"$f")
    if head -1 "$f" | grep -q '^// SPDX-FileCopyrightText'; then
      n=$((n - 2))                                             # les deux lignes SPDX
      [ -z "$(sed -n '3p' "$f" | tr -d '\r')" ] && n=$((n - 1)) # + its separator line
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

step "Backend — lint (eslint, zéro warning)"
( cd "$ROOT/backend" && npm run lint )

# The Prisma schema is validated without depending on a database: the dummy URL is enough for `validate`.
step "Backend — schéma Prisma (prisma validate)"
( cd "$ROOT/backend" && DATABASE_URL="${DATABASE_URL:-postgresql://validate:validate@localhost:5432/validate}" npx prisma validate )

# `prisma validate` only says "the file parses". A model changed without `migrate dev`
# therefore passed green, until `migrate deploy` served a production database without the
# expected column. This check replays the migrations on a shadow database and compares them
# with the model. It requires Postgres: without a reachable database it is skipped (workstation without docker), except
# when REVIEW_REQUIRE_DRIFT_CHECK=1 — which the CI job, which does have the database, sets.
step "Backend — dérive schema.prisma ↔ migrations (prisma migrate diff)"
node "$ROOT/scripts/check-prisma-drift.mjs"

# The lint tsconfig extends the typecheck to the tests, to prisma/ and to the scripts — the build,
# for its part, only compiles src/.
step "Backend — typecheck (tsc --noEmit, tests inclus)"
( cd "$ROOT/backend" && npm run typecheck )

step "Backend — build (prisma generate + tsc)"
( cd "$ROOT/backend" && npm run build )

# Coverage: measured when the provider is installed, and compared to the floors by
# dossier (`scripts/coverage-floors.json`, cliquet — on monte, jamais on ne descend).
# The provider is a separate development dependency; while it is missing, the tests
# run without measurement and the suite says so loudly rather than pretending.
has_coverage_provider() { [ -d "$1/node_modules/@vitest/coverage-v8" ]; }

step "Backend — tests unitaires (vitest)"
if has_coverage_provider "$ROOT/backend"; then
  ( cd "$ROOT/backend" && npx vitest run --coverage )
  step "Backend — couverture (planchers par dossier, à cliquet)"
  node "$ROOT/scripts/check-coverage.mjs" backend
else
  ( cd "$ROOT/backend" && npm test )
  skip "Couverture backend non mesurée : installer @vitest/coverage-v8 (npm i -D @vitest/coverage-v8)."
fi

if [[ "$WITH_INTEGRATION" == "1" ]]; then
  step "Backend — tests d'intégration (vitest, nécessite Postgres+Redis+MinIO)"
  ( cd "$ROOT/backend" && npm run test:integration )
else
  skip "Tests d'intégration ignorés (relancer avec --with-integration + stack docker)."
fi

# ---------- Frontend ----------
step "Frontend — format (prettier --check)"
( cd "$ROOT/frontend" && npm run format:check )

step "Frontend — lint (eslint)"
( cd "$ROOT/frontend" && npm run lint )

step "Frontend — typecheck (tsc --noEmit)"
( cd "$ROOT/frontend" && npm run typecheck )

step "Frontend — tests unitaires (vitest)"
if has_coverage_provider "$ROOT/frontend"; then
  ( cd "$ROOT/frontend" && npx vitest run --coverage )
  step "Frontend — couverture (planchers par dossier, à cliquet)"
  node "$ROOT/scripts/check-coverage.mjs" frontend
else
  ( cd "$ROOT/frontend" && npm test )
  skip "Couverture frontend non mesurée : installer @vitest/coverage-v8 (npm i -D @vitest/coverage-v8)."
fi

step "Frontend — build (vite build)"
( cd "$ROOT/frontend" && npm run build )

# Anti-regression guardrail on what the browser downloads before the first screen.
step "Frontend — budget du bundle d'entrée"
node "$ROOT/scripts/check-bundle-budget.mjs"

if [[ "$WITH_E2E" == "1" ]]; then
  step "E2E — smoke Playwright (parcours critique, lance backend+frontend)"
  ( cd "$ROOT/frontend" && npm run test:e2e )
fi

# ShotGrid harness: 1,212 lines of simulator and scenario that had never run
# other than by hand. It verifies the most costly invariant of the integration — never
# spilling over into the neighbouring project — against a simulated site that deliberately hosts three
# projets aux codes identiques.
#
# Deliberately outside `--with-integration`: the scenario talks to the ReView backend **over HTTP**
# (docker stack started), whereas the integration tests mount the app in memory. It writes
# therefore into the development database and leaves its test project there.
if [[ "$WITH_SHOTGRID" == "1" ]]; then
  step "ShotGrid — harnais bout-en-bout (simulateur + scénario)"
  node "$ROOT/scripts/run-shotgrid-e2e.mjs"
else
  skip "Harnais ShotGrid ignoré (relancer avec --with-shotgrid + backend ReView démarré)."
fi

printf '\n\033[1;32m✅ Validation complète : tout est vert. Code validable.\033[0m\n'
