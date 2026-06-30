# Phase 3 — Unification de l'interface de review

**Statut :** ⏳ À faire  
**Branche suggérée :** `phase-3/unified-review-sidebar`  
**Prérequis :** Phase 2 terminée

---

## Contexte actuel

| Type de média | Mode sidebar actuel |
|---------------|---------------------|
| Vidéo | `FixedCommentsPanel` (sidebar fixe droite) |
| Image (ImageBundle) | `FixedCommentsPanel` |
| Gaussian Splat | `FixedCommentsPanel` (ajouté en Phase 1-2) |
| Modèle 3D (GLB/FBX) | Fenêtre flottante (`FloatingCommentsPanel`) |

Objectif : tout passe en sidebar fixe droite.

---

## Tâche 3.1 — Supprimer la fenêtre flottante 3D

**Statut :** ⏳  
**Priorité :** 🟠 Important

### Plan d'action
1. Dans `ProjectViewDesktop.jsx`, localiser `useFloatingPanel = isThreeD && !isSplat`
2. Forcer `useFloatingPanel = false` (supprimer la condition)
3. S'assurer que `FixedCommentsPanel` est rendu pour les modèles 3D aussi
4. Supprimer le composant `FloatingCommentsPanel` s'il n'est plus utilisé nulle part

---

## Tâche 3.2 — Composant `UnifiedReviewSidebar`

**Statut :** ⏳  
**Priorité :** 🟠 Important

### Plan d'action
1. Créer `frontend/src/components/UnifiedReviewSidebar.jsx`
2. Il accepte des props : `mediaType`, `comments`, `onAddComment`, `onCommentClick`, etc.
3. Affiche les outils adaptés selon le type (timestamp vidéo, camera snapshot 3D/splat, coordonnées image)
4. Remplace `FixedCommentsPanel` partout dans `ProjectViewDesktop.jsx` et `MobileProjectView.jsx`

---

## Tâche 3.3 — Unification des outils de review

**Statut :** ⏳  
**Priorité :** 🟠 Important

### Outils à unifier
- **Dessin** (`AnnotationCanvas.jsx`, `useDrawing.js`) : disponible vidéo + image, à étendre 3D/splat
- **Timestamp vidéo** : spécifique vidéo
- **Camera snapshot** : spécifique 3D/splat
- **Réactions / statuts** : communs à tous

### Plan d'action
1. Définir une interface commune de "contexte de review" selon le type de média
2. La `UnifiedReviewSidebar` adapte sa barre d'outils selon ce contexte
3. Le dessin sur splat : overlay canvas HTML par-dessus l'iframe (possible en same-origin)

---

## Tâche 3.4 — Mobile

**Statut :** ⏳  
**Priorité :** 🟡 Nice to have

### Plan d'action
1. `MobileCommentsSheet.jsx` : appliquer les mêmes changements que desktop
2. `MobileDrawingToolbar.jsx` : adapter pour tous les types
3. Tester sur viewport mobile (375px)
