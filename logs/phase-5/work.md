# Phase 5 — Nettoyage & refactoring code mort

**Statut :** ⏳ À faire  
**Branche suggérée :** `phase-5/cleanup`  
**Prérequis :** Phases 1-4 terminées (pour ne pas nettoyer du code encore en usage)

---

## Tâche 5.1 — Supprimer `@mkkellogg/gaussian-splats-3d`

- `npm uninstall @mkkellogg/gaussian-splats-3d` dans `frontend/`
- Vérifier qu'aucun import ne reste : `grep -r "gaussian-splats-3d" frontend/src/`

---

## Tâche 5.2 — Audit des imports inutilisés

- Outil : ESLint `no-unused-vars` / `eslint-plugin-unused-imports`
- Passer en revue tous les composants après lint

---

## Tâche 5.3 — Routes backend redondantes

- Audit de tous les `*.routes.js` : identifier les routes non appelées depuis le frontend
- Supprimer après confirmation

---

## Tâche 5.4 — Découpage de `project.routes.js`

- Fichier monolithique (~1700+ lignes)
- Découper en : `project.create.routes.js`, `project.version.routes.js`, `project.publish.routes.js`, etc.
- Relier depuis `server.js`

---

## Tâche 5.5 — Fichiers debug à supprimer

- `backend/reproduce_idor.js`
- `backend/reproduce_issue.js`
- `backend/check_db.js`
- `backend/check_users.js`

---

## Tâche 5.6 — Fichiers logs committés

- `backend/backend.log`
- `backend/backend_output.log`
- Ajouter `*.log` au `.gitignore` si pas déjà présent
