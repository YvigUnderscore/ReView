# Phase 2 — Review 3D & Splats

**Statut :** ⏳ À faire  
**Branche suggérée :** `phase-2/review-3d-splats`  
**Prérequis :** Phase 1 terminée

---

## Tâche 2.1 — Outils de review sur splats

**Statut :** ⏳  
**Priorité :** 🔴 Critique

### Contexte
- Le bridge `installReviewBridge` est déjà en place dans `frontend/public/supersplat-viewer/index.js`
- `GaussianSplatViewer.jsx` expose `getCameraState`, `setCameraState`, `getScreenshot`
- Mais la sidebar des commentaires ne fonctionne pas en mode splat

### Plan d'action
1. Identifier pourquoi les commentaires ne s'envoient pas (vérifier `onAddComment` dans `ProjectViewDesktop.jsx`)
2. Vérifier que `activeVersion` est bien défini pour un splat
3. S'assurer que le formulaire de commentaire est rendu (pas désactivé ou caché) pour les splats
4. Câbler `getCameraState` à la création d'un commentaire (viewpoint snapshot)

### Log de résolution
*(à remplir lors du travail)*

---

## Tâche 2.2 — Enregistrement caméra/rotation en review

**Statut :** ⏳  
**Priorité :** 🟠 Important

### Contexte
- Le bridge expose déjà `reviewGetCameraState()` / `reviewSetCameraState()`
- `GaussianSplatViewer.jsx` a déjà `getCameraState` / `setCameraState`
- Le wiring vers les commentaires est déjà initié mais peut-être incomplet

### Plan d'action
1. Vérifier que `cameraState` est bien inclus dans le payload de création de commentaire
2. Vérifier que `onCommentClick` dans `FixedCommentsPanel` appelle bien `setCameraState`
3. Tester : créer commentaire → naviguer → cliquer commentaire → caméra se replace

### Log de résolution
*(à remplir lors du travail)*

---

## Tâche 2.3 — Transformation 3D avant publication (GLB/FBX)

**Statut :** ⏳  
**Priorité :** 🟠 Important

### Plan d'action
1. Dans `DraftReviewBanner.jsx`, ajouter un bouton "Ajuster la pose" pour les modèles 3D non-splat
2. Créer un modal/panneau `ThreeDTransformPanel.jsx` avec contrôles :
   - Rotation X/Y/Z (sliders)
   - Position X/Y/Z
   - Scale uniform
3. Ces valeurs s'appliquent via les attributs `camera-orbit`, `orientation` de `model-viewer`
4. À la publication, sauvegarder ces valeurs dans la DB (`ThreeDAsset.transform` — champ JSON)
5. Le viewer en review restaure la pose sauvegardée

### Log de résolution
*(à remplir lors du travail)*

---

## Tâche 2.4 — Intégration SuperSplat Éditeur self-hosté

**Statut :** ⏳  
**Priorité :** 🔴 Critique

### Contexte
- SuperSplat éditeur : https://github.com/playcanvas/supersplat
- Différent du viewer (qu'on a déjà vendoré)
- L'éditeur permet de modifier/nettoyer un splat (supprimer des gaussiennes, recadrer, etc.)

### Plan d'action
1. **Documenter** SuperSplat éditeur : cloner le repo, lire README, identifier comment builder en static
2. **Builder** : `npm install && npm run build` → output dans `dist/`
3. **Vendorer** dans `frontend/public/supersplat-editor/`
4. **Communication** : L'éditeur devra exporter le splat modifié → à étudier (API interne, download, postMessage)
5. **Intégration UI** : bouton "Éditer dans SuperSplat" dans `DraftReviewBanner.jsx` → ouvre l'éditeur dans un modal fullscreen
6. **Import du fichier modifié** : l'utilisateur exporte depuis l'éditeur, on uploade via la route `PUT /projects/threed/:id/file`

### Questions ouvertes
- L'éditeur SuperSplat a-t-il une API postMessage pour exporter directement vers le parent ?
- Faut-il patcher l'éditeur comme on a patché le viewer ?

### Log de résolution
*(à remplir lors du travail)*

---

## Tâche 2.5 — Workflow édit → sauvegarde → publication

**Statut :** ⏳  
**Priorité :** 🔴 Critique

### Plan d'action
1. La route `PUT /projects/threed/:id/file` existe déjà pour remplacer un fichier draft
2. Après édition dans SuperSplat éditeur, déclencher automatiquement le remplacement si postMessage disponible
3. Si pas de postMessage : l'utilisateur télécharge le fichier modifié, puis le réimporte via le bouton "Remplacer" existant
4. À la publication (`POST /projects/versions/threed/:id/publish`) : le splat final est publié

### Log de résolution
*(à remplir lors du travail)*
