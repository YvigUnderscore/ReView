# Phase 1 — Stabilisation & correctifs urgents

**Statut :** ⏳ À faire  
**Branche suggérée :** `phase-1/stabilisation`

---

## Tâche 1.1 — Erreur upload ZIP modèle 3D (Docker)

**Statut :** ⏳  
**Priorité :** 🔴 Critique

### Étapes de diagnostic
1. Récupérer les logs Docker : `docker logs <container_name> 2>&1 | grep -A 20 "error\|Error\|zip\|ZIP"`
2. Identifier la route concernée dans `backend/project.routes.js`
3. Vérifier `isValidThreeDFile()` dans `backend/utils/validation.js`
4. Vérifier l'extraction ZIP (`yauzl`) dans la route de création projet

### Hypothèses à vérifier
- Le chemin `DATA_PATH` en Docker n'est pas `path.resolve()` → `sendFile` échoue
- La validation magic bytes échoue sur le fichier principal extrait du ZIP
- Le fichier principal à l'intérieur du ZIP n'est pas trouvé (extension non reconnue)

### Log de résolution
*(à remplir lors du travail)*

---

## Tâche 1.2 — Upload non-bloquant cross-page (Zustand)

**Statut :** ⏳  
**Priorité :** 🔴 Critique

### Plan d'action
1. Installer Zustand : `npm install zustand` dans `frontend/`
2. Créer `frontend/src/stores/useUploadStore.js` :
   - State : `uploads[]` (id, fileName, progress, status, projectId)
   - Actions : `addUpload`, `updateProgress`, `completeUpload`, `removeUpload`
3. Migrer la logique d'upload de `useProjectController.js` vers le store
4. Faire du `UploadProgressCard` un composant global monté dans `App.jsx` (pas dans la page)
5. Tester navigation entre pages pendant un upload actif

### Fichiers à modifier
- `frontend/package.json` (ajout zustand)
- `frontend/src/stores/useUploadStore.js` (nouveau)
- `frontend/src/hooks/useProjectController.js`
- `frontend/src/components/UploadProgressCard.jsx`
- `frontend/src/App.jsx` (monter UploadProgressCard globalement)

### Log de résolution
*(à remplir lors du travail)*

---

## Tâche 1.3 — Compression SOG non fonctionnelle en production

**Statut :** ⏳  
**Priorité :** 🟠 Important

### Contexte
- Le problème est connu : `new URL('webp.wasm', import.meta.url)` dans `@playcanvas/splat-transform` n'est pas résolu par Vite en production
- Le `.wasm` n'est pas copié dans le build output → 404 → fallback silencieux vers `compressed-ply`

### Plan d'action
1. Vérifier si `vite-plugin-wasm` résout le problème (à tester)
2. Alternative : copier manuellement le `.wasm` dans `frontend/public/` et patcher l'import
3. En dernier recours : documenter la limitation et afficher un message clair à l'utilisateur quand SOG échoue (plutôt que fallback silencieux)

### Log de résolution
*(à remplir lors du travail)*

---

## Tâche 1.4 — Fix boutons review superposés (splat viewer)

**Statut :** ⏳  
**Priorité :** 🟠 Important

### Contexte
- Dans `ProjectViewDesktop.jsx`, les contrôles de review s'affichent par-dessus l'iframe SuperSplat
- SuperSplat a ses propres contrôles UI dans l'iframe (caméra, orbit, etc.)
- Les z-index ou positionnement absolus se chevauchent

### Plan d'action
1. Inspecter le DOM : quels éléments se chevauchent exactement
2. Revoir la disposition : sidebar droite fixe pour la review, iframe prend 100% de l'espace gauche
3. S'assurer que les boutons review ne sont jamais `position: absolute` par-dessus l'iframe

### Log de résolution
*(à remplir lors du travail)*
