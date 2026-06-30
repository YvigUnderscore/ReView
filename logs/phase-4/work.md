# Phase 4 — Board 2D style Miro

**Statut :** ⏳ À faire  
**Branche suggérée :** `phase-4/miro-board`  
**Prérequis :** Phase 3 terminée

---

## Contexte

L'actuel `ImageViewer.jsx` affiche les images d'un bundle en simple galerie/slideshow.

L'objectif est de le remplacer par un board canvas infini où :
- Les images d'une version sont disposées librement sur le board
- On peut ajouter du texte, des dessins, des formes, des flèches
- Chaque version = un board indépendant
- Tout est persisté en base
- CTRL+Z disponible (historique des actions)
- Collaboration temps réel (Socket.io)

---

## Tâche 4.1 — Choix de la librairie canvas

**Statut :** ⏳  
**Priorité :** 🔴 Critique

### Candidats

| Librairie | Avantages | Inconvénients |
|-----------|-----------|---------------|
| **tldraw** | Canvas infini, collab intégrée, undo/redo, JSON state, open source | Bundle plus lourd |
| **Fabric.js** | Mature, léger, bien documenté | Pas de canvas infini natif, undo manuel |
| **Konva** | Bonnes perfs, React bindings | Pas de collab native |
| **Excalidraw** | Style sketch, collab, open source | Style très imposé, moins configurable |

**Recommandation :** tldraw (gère déjà tout ce qui est demandé out of the box).

### Décision
*(à compléter lors du démarrage de la phase)*

---

## Tâche 4.2 — Board par version

**Statut :** ⏳  
**Priorité :** 🔴 Critique

### Plan d'action
1. Ajouter un modèle Prisma `Board` lié à `ImageBundle` (relation 1:1 par version)
2. Le board contient un `state` JSON (l'état sérialisé du canvas tldraw/Fabric)
3. Route backend : `GET /projects/board/:imageBundleId` / `PUT /projects/board/:imageBundleId`
4. Au changement de version dans la review, charger le board correspondant

---

## Tâche 4.3 — Outils du board

**Statut :** ⏳  
**Priorité :** 🔴 Critique

### Outils à implémenter
- [ ] Ajout d'image (depuis la version ou upload libre)
- [ ] Suppression d'image
- [ ] Texte libre
- [ ] Dessin libre (pen)
- [ ] Formes : rectangle, ellipse, flèche
- [ ] Sélection + déplacement + redimensionnement
- [ ] Zoom in/out + pan

*(Si tldraw choisi : tout ça est natif)*

---

## Tâche 4.4 — Persistance en base

**Statut :** ⏳  
**Priorité :** 🔴 Critique

### Schéma Prisma à ajouter
```prisma
model Board {
  id            String      @id @default(cuid())
  imageBundleId String      @unique
  imageBundle   ImageBundle @relation(fields: [imageBundleId], references: [id])
  state         Json        // état sérialisé du canvas
  updatedAt     DateTime    @updatedAt
  logs          BoardLog[]
}

model BoardLog {
  id        String   @id @default(cuid())
  boardId   String
  board     Board    @relation(fields: [boardId], references: [id])
  userId    String
  action    String   // "add_image", "delete_element", "add_text", etc.
  payload   Json?
  createdAt DateTime @default(now())
}
```

---

## Tâche 4.5 — CTRL+Z / UNDO

**Statut :** ⏳  
**Priorité :** 🟠 Important

### Plan d'action
- Si tldraw : undo/redo natif (`editor.undo()`, `editor.redo()`)
- Si Fabric.js : implémenter une stack d'historique dans Zustand (`boardHistory`, `boardHistoryIndex`)
- Sauvegarder en base après chaque action commitée (debounce 1s)

---

## Tâche 4.6 — Log des modifications

**Statut :** ⏳  
**Priorité :** 🟠 Important

- À chaque action sur le board, enregistrer un `BoardLog` avec userId, action, timestamp
- Accessible depuis l'UI (panel "Historique des modifications")

---

## Tâche 4.7 — Collaboration temps réel

**Statut :** ⏳  
**Priorité :** 🟠 Important

### Plan d'action
1. Si tldraw : intégrer le provider de collab tldraw (`@tldraw/sync` ou Yjs)
2. Sinon : Socket.io room par board, diffusion des deltas de state entre clients
3. Résolution de conflits : last-write-wins pour les objets individuels (suffisant pour commencer)
