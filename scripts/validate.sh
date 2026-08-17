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

# ---------- Traductions ----------
# Une traduction incomplète est admise (repli sur l'anglais) ; une traduction incohérente
# ne l'est pas : variable interpolée perdue, forme plurielle absente de la langue, clé
# orpheline, terme métier traduit. Le script chiffre aussi la couverture par langue.
step "i18n — cohérence des catalogues de traduction"
node "$ROOT/scripts/check-translations.mjs"

# Un catalogue complet ne prouve pas que l'interface l'utilise : ce contrôle relève les
# chaînes françaises restées en dur (cliquet — le compte ne peut que baisser).
step "i18n — chaînes en dur dans le frontend"
node "$ROOT/scripts/check-untranslated.mjs"

# La faute symétrique, que le contrôle précédent ne peut pas voir : une clé qui atteint
# l'écran telle quelle (« task.status.todo » au lieu de « À faire »), faute d'un `t()`.
# Une clé nue ressemble à un identifiant technique, donc le détecteur de texte en dur
# l'écarte à raison — celui-ci interroge les types plutôt que le texte.
step "i18n — clés de traduction affichées brutes"
node "$ROOT/scripts/check-raw-keys.mjs"

# ---------- Thème ----------
# « Couleurs = tokens du thème » : une classe Tailwind de palette brute (bg-blue-500…)
# ou une couleur arbitraire (bg-[#…]) échappe au thème et casse la cohérence sombre/clair.
step "Thème — couleurs hors tokens (classes Tailwind brutes)"
node "$ROOT/scripts/check-color-tokens.mjs"

# ---------- Outillage racine ----------
# Les scripts de la racine (contrôles de la suite, simulateur ShotGrid, i18n) sont du code
# comme un autre : lintés (via l'ESLint du backend) et formatés comme le reste.
step "Outillage — lint des scripts racine (eslint)"
node "$ROOT/scripts/lint-scripts.mjs"

step "Outillage — format des scripts racine (prettier --check)"
( cd "$ROOT" && ./backend/node_modules/.bin/prettier --check "scripts/**/*.mjs" )

# Un script shell à la syntaxe cassée ne se découvre qu'à l'exécution — bash -n le voit avant.
step "Outillage — syntaxe des scripts shell (bash -n)"
for f in "$ROOT"/scripts/*.sh; do bash -n "$f"; done

# ---------- Budget de taille (10.F4) ----------
# Le frontend est couvert par la règle ESLint `max-lines` (300, skipComments). Côté
# backend, on garde-fou ici la taille des routes (≤ 200 lignes ; la logique métier vit
# dans services/) — budget spécifique aux routes, distinct du lint ESLint backend.
# Étend la suite, ne l'affaiblit jamais.
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

step "Backend — lint (eslint, zéro warning)"
( cd "$ROOT/backend" && npm run lint )

# Le schéma Prisma est validé sans dépendre d'une base : l'URL factice suffit à `validate`.
step "Backend — schéma Prisma (prisma validate)"
( cd "$ROOT/backend" && DATABASE_URL="${DATABASE_URL:-postgresql://validate:validate@localhost:5432/validate}" npx prisma validate )

# Le tsconfig de lint étend le typecheck aux tests, à prisma/ et aux scripts — le build,
# lui, ne compile que src/.
step "Backend — typecheck (tsc --noEmit, tests inclus)"
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
