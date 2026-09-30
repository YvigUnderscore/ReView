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
#   bash scripts/validate.sh --with-shotgrid       # + harnais ShotGrid bout-en-bout (backend ReView démarré requis)
#
# Les options se cumulent : `--with-integration --with-shotgrid` est valide.
#
# Sortie : échoue (exit 1) au premier check rouge. Tout vert = code validable.
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

# La troisième faute possible : une clé qui reste au catalogue alors que plus personne ne
# l'affiche. Elle coûte peu à l'écran mais beaucoup à la relecture — quatorze traductions à
# maintenir pour un message mort — et brouille la mesure de couverture. Le script existait
# depuis la migration i18n sans être branché ici ; il l'est désormais, catalogues nettoyés.
step "i18n — clés de traduction jamais affichées"
node "$ROOT/scripts/check-unused-keys.mjs"

# Le backend ne passe pas par les catalogues : ses messages d'erreur remontent tels quels
# à l'écran, y compris sur la page publique d'un partage client. L'arbitrage est de les
# écrire en anglais — ce contrôle empêche le français d'y revenir (D2).
step "i18n — messages d'erreur du backend en anglais"
node "$ROOT/scripts/check-backend-english.mjs"

# ---------- Thème ----------
# « Couleurs = tokens du thème » : une classe Tailwind de palette brute (bg-blue-500…)
# ou une couleur arbitraire (bg-[#…]) échappe au thème et casse la cohérence sombre/clair.
step "Thème — couleurs hors tokens (classes Tailwind brutes)"
node "$ROOT/scripts/check-color-tokens.mjs"

# Une taille de police en pixels ignore le réglage de densité (qui agit sur la racine en rem).
step "Thème — tailles de texte en pixels"
node "$ROOT/scripts/check-text-sizes.mjs"

# ---------- Documentation ----------
# `DOCUMENTATION/` est du livrable : commité, servi in-app sur /docs, lu sur GitHub. Un lien
# mort ou une figure manquante n'y font pas échouer un build — ils ne se voient qu'en
# cliquant dessus, c'est-à-dire trop tard. Le contrôle vérifie le préambule de chaque page
# (titre, sous-titre, date), la résolution de chaque lien interne et de chaque ancre, la
# présence de chaque image, et la conformité des figures SVG (viewBox, titre, thème sombre).
step "Documentation — préambules, liens, images et figures"
node "$ROOT/scripts/check-docs.mjs"

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

# Les workers appellent quatre scripts Python en production (analyse USD, conversion GLB,
# miniature, cuisson de LUT) que rien ne compilait ni ne lintait : une faute de syntaxe ne
# se découvrait qu'au premier upload USD d'un studio. `compileall` la voit sans exécuter le
# code, et sans exiger les dépendances (usd-core, PyOpenColorIO) qu'un poste n'a pas.
# `PYTHONPYCACHEPREFIX` renvoie les `__pycache__` hors du dépôt : le contrôle ne salit rien.
step "Outillage — syntaxe des scripts Python des workers (compileall)"
PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys' >/dev/null 2>&1; then
    PY="$candidate"; break
  fi
done
if [ -z "$PY" ]; then
  # Sauter proprement : la suite doit rester exécutable sur un poste sans interpréteur.
  skip "Python absent : contrôle des scripts des workers sauté."
else
  PYTHONPYCACHEPREFIX="$(mktemp -d)" "$PY" -m compileall -q \
    "$ROOT/backend/src/workers/usd" "$ROOT/backend/src/workers/ocio"
  # `ruff` n'est pas une dépendance du dépôt : présent, on s'en sert ; absent, on continue.
  if command -v ruff >/dev/null 2>&1; then
    step "Outillage — lint des scripts Python (ruff)"
    ruff check "$ROOT/backend/src/workers/usd" "$ROOT/backend/src/workers/ocio"
  fi
fi

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

# `prisma validate` ne dit que « le fichier se parse ». Un modèle modifié sans `migrate dev`
# passait donc au vert, jusqu'à ce que `migrate deploy` serve en production une base sans la
# colonne attendue. Ce contrôle rejoue les migrations sur une base fantôme et les confronte
# au modèle. Il exige Postgres : sans base joignable il se saute (poste sans docker), sauf
# quand REVIEW_REQUIRE_DRIFT_CHECK=1 — ce que pose le job CI qui, lui, a la base.
step "Backend — dérive schema.prisma ↔ migrations (prisma migrate diff)"
node "$ROOT/scripts/check-prisma-drift.mjs"

# Le tsconfig de lint étend le typecheck aux tests, à prisma/ et aux scripts — le build,
# lui, ne compile que src/.
step "Backend — typecheck (tsc --noEmit, tests inclus)"
( cd "$ROOT/backend" && npm run typecheck )

step "Backend — build (prisma generate + tsc)"
( cd "$ROOT/backend" && npm run build )

# Couverture : mesurée quand le provider est installé, et confrontée aux planchers par
# dossier (`scripts/coverage-floors.json`, cliquet — on monte, jamais on ne descend).
# Le provider est une dépendance de développement à part ; tant qu'il manque, les tests
# tournent sans mesure et la suite le dit haut et fort plutôt que de faire semblant.
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

# Garde-fou anti-régression sur ce que le navigateur télécharge avant le premier écran.
step "Frontend — budget du bundle d'entrée"
node "$ROOT/scripts/check-bundle-budget.mjs"

if [[ "$WITH_E2E" == "1" ]]; then
  step "E2E — smoke Playwright (parcours critique, lance backend+frontend)"
  ( cd "$ROOT/frontend" && npm run test:e2e )
fi

# Harnais ShotGrid : 1 212 lignes de simulateur et de scénario qui n'avaient jamais tourné
# autrement qu'à la main. Il vérifie l'invariant le plus coûteux de l'intégration — ne
# jamais déborder sur le projet voisin — contre un site simulé qui héberge exprès trois
# projets aux codes identiques.
#
# Hors de `--with-integration` sciemment : le scénario parle au backend ReView **par HTTP**
# (stack docker démarrée), là où les tests d'intégration montent l'app en mémoire. Il écrit
# donc dans la base de développement et y laisse son projet de test.
if [[ "$WITH_SHOTGRID" == "1" ]]; then
  step "ShotGrid — harnais bout-en-bout (simulateur + scénario)"
  node "$ROOT/scripts/run-shotgrid-e2e.mjs"
else
  skip "Harnais ShotGrid ignoré (relancer avec --with-shotgrid + backend ReView démarré)."
fi

printf '\n\033[1;32m✅ Validation complète : tout est vert. Code validable.\033[0m\n'
