# Phase 6 — Interface administrateur

**Statut :** ⏳ À faire  
**Branche suggérée :** `phase-6/admin-ui`  
**Prérequis :** Phase 5 terminée

---

## Objectif

Rendre l'espace admin clair, organisé et utilisable au quotidien par un gestionnaire de studio.

---

## Tâche 6.1 — Audit UX admin actuel

- Lister toutes les pages et composants admin existants
- Lister les routes `admin.routes.js`
- Identifier les lacunes (ce qui manque)

---

## Tâche 6.2 — Nouvelle structure admin

### Sections proposées
1. **Tableau de bord** — métriques clés (utilisateurs actifs, projets, stockage, uploads récents)
2. **Utilisateurs** — liste, rôles, activation/désactivation, quotas
3. **Projets** — liste de tous les projets, statuts, médias associés
4. **Stockage** — utilisation par utilisateur, par projet, alertes de quota
5. **Rôles & Permissions** — gestion RBAC
6. **Paramètres** — configuration globale (limites, Discord webhook, etc.)
7. **Logs** — audit log des actions sensibles

---

## Tâche 6.3 — Dashboard avec métriques

- Nouvelles routes backend stats : `GET /admin/stats`
- Composant `AdminDashboard.jsx`

---

## Tâche 6.4 — Gestion des rôles

- S'appuyer sur `role.routes.js` existant
- UI pour assigner/révoquer des rôles utilisateur

---

## Notes

- Garder le design system actuel (Tailwind, couleurs, composants)
- Pas de librairie UI externe à ajouter pour l'admin (rester cohérent)
