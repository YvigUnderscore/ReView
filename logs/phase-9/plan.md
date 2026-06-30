# Phase 9 — Fixes pipeline & Refonte interface

> Créé le 2026-06-20. Série d'upgrades post-MVP (8.1→8.7 livrés, voir [`roadmap.md`](../roadmap.md)).
> **Priorité : fixes et refonte UI menés en parallèle, par domaine.**
> Décisions prises avec l'utilisateur (Q&A du 2026-06-20) — consignées ci-dessous.

---

## Bloc 1 — FIXES (prioritaires)

### 9.A1 — Conversion 3D → GLB (corrige l'erreur `RangeError: Offset is outside the bounds of the DataView`)

**Cause** : `@google/model-viewer` ne lit nativement que **GLB/glTF**. Un FBX/OBJ/USD (ou un GLB tronqué) envoyé tel quel fait planter le parser GLB.

**Décision : conversion serveur → GLB.**
- Réintégrer un convertisseur dans l'image **worker** (Dockerfile : `FBX2glTF` ou `assimp` — la v1 utilisait `assimp-utils`/`fbxConverter`). *À confirmer en impl : binaire retenu.*
- Nouveau job BullMQ `convert3d` : si `kind=MODEL_3D` et extension ≠ `.glb/.gltf`, convertir → `derived/{mediaId}/model.glb`, stocker `metadata.glbKey`. Statut `PROCESSING` pendant la conversion, `READY`/`FAILED` ensuite.
- La page Review charge `glbKey` (fallback `url` si déjà GLB). Plus aucun FBX brut dans model-viewer.
- Validation upload : accepter `fbx/obj/usd(z/c/a)/gltf/glb/zip` (magic bytes déjà en place).
- Gestion d'erreur viewer : afficher un message clair si chargement 3D échoue (pas de crash silencieux).

### 9.A2 — Draft média (vérifier/modifier avant publication pour tous)

**Décision : brouillon au niveau MÉDIA, visible par l'uploader seul, publié par l'uploader.**
- Schéma : `MediaObject.published Boolean @default(false)` (+ migration `add_media_published`).
- **Visibilité** : un média non publié n'est visible que par son `uploaderId`. Filtrage à appliquer dans : listes de médias par version, page Review, accès client (`/api/client/...` ne voit que `published=true` ET version publiée).
- **Action** : `POST /api/media/:id/publish` — réservé à l'uploader (admin autorisé en secours). Bannière « Brouillon » dans l'UI tant que non publié.
- Workflow : upload → draft (uploader vérifie/édite : transform 3D, édition splat, re-upload si besoin) → publish → visible par l'équipe.
- Réconciliation avec `Version.status` (DRAFT/REVIEW/PUBLISHED) : la Version garde le sens « état pipeline » ; la **diffusion à l'équipe** se joue désormais au niveau média (`published`). Documenter clairement la distinction.

### 9.A3 — Édition Gaussian Splat avant publication (éditeur SuperSplat vendoré)

**Décision : vendorer l'éditeur SuperSplat complet** (comme le viewer).
- Vendoring dans `frontend/public/supersplat-editor/` (depuis https://github.com/playcanvas/supersplat).
- Workflow : ouvrir un splat **draft** dans l'éditeur (iframe) → éditer → exporter → ré-upload comme nouveau média/version → publier.
- Bridge `postMessage` : charger le splat via URL présignée, récupérer le résultat édité (format export `.ply`/`.sog`). *À confirmer en impl : API d'export de l'éditeur.*

### 9.A4 — Transform / rotation 3D avant publication

- Base existante : champ `Version.transform` + contrôles model-viewer (livré en post-8.7).
- À compléter : contrôles **rotation / position / échelle** dans la review **draft** 3D, sauvegarde, application au viewer ; idéalement **bake** dans le GLB converti à la publication (sinon appliquer le transform à l'affichage). *À confirmer : bake vs application runtime.*

---

## Bloc 2 — REMPLACEMENT DU BOARD (tldraw → Excalidraw)

> **tldraw exige une licence commerciale en production (filigrane).** On le retire entièrement.

### 9.B1 — Suppression de tldraw
- Retirer les dépendances `tldraw` / `@tldraw/*` du `frontend/package.json`.
- Supprimer `BoardPage` per-version, la route `/board/:versionId`, le lien « Board » dans `TaskPage`.
- Supprimer le modèle **per-version** `Board.versionId` (migration).

### 9.B2 — Nouveau modèle de board
- **Décision : un board Projet + un board par Asset** (plus de board par version).
- Schéma : `Board` rattaché à `Project` (0..1) **ou** `Asset` (0..1) — `projectId?`/`assetId?` (XOR), `@@unique` sur chacun. `BoardChange` conservé (log des modifications).
- API : `GET/PUT /api/projects/:id/board` et `GET/PUT /api/assets/:id/board` (RBAC : membres du projet ; client lecture seule selon partage).

### 9.B3 — Intégration Excalidraw (MIT)
- Composant React `@excalidraw/excalidraw`. Persistance via l'API board (scene JSON). **Sync simple** d'abord (sauvegarde + reload à l'ouverture/intervalle) ; multi-curseurs temps réel plus tard.

### 9.B4 — Rôle & contenu
- **Décision : board mood/reference** (mur d'inspiration & direction artistique).
- Médias insérables : **les deux** → panneau bibliothèque (médias **publiés** du projet/asset) à glisser **+** upload direct d'images sur le board.

---

## Bloc 3 — REFONTE INTERFACE (desktop)

> Objectif : retrouver la richesse de la V01 **en mieux** — belle UI qui ne fait pas « générée par IA »,
> facile à naviguer, animations là où c'est utile, teintes actuelles conservées, plus responsive/soignée.

### 9.C1 — Design system
- **Décision : shadcn/ui (Radix + Tailwind) + thème maison ReView.**
- Conserver les **teintes actuelles** (variables CSS `index.css`) mais retravailler typo, rayons, ombres, espacements, états (hover/focus/disabled/loading) pour une identité propre — éviter le look par défaut shadcn.

### 9.C2 — Navigation
- **Décision : sidebar gauche persistante** (Projets, Board projet, Kanban, Admin) **+ topbar contextuelle** (fil d'Ariane + actions de la page).

### 9.C3 — Animations
- **Décision : `framer-motion` subtil** — transitions de page douces, hovers, apparition de listes, panneaux qui glissent. Pas de surcharge.

### 9.C4 — Unification & nettoyage
- **Décision : desktop uniquement.** Supprimer le split desktop/mobile v1.
- Nettoyer progressivement le legacy v1 (`src/desktop`, `src/mobile`, `src/pages`, `src/components` v1, `App.jsx`) au fil de la refonte des écrans v2.

### 9.C5 — Fenêtres de review complètes (cœur du produit)
- **Suite d'annotation 2D** (vidéo/image) : **dessin libre, formes (flèche / rectangle / cercle), texte, gomme, déplacement des annotations, undo/redo**, **sélecteur de couleurs ergonomique** + épaisseur. UI « complète » comme la V01.
- **Vidéo** : timeline avec **marqueurs de commentaires**, navigation frame-par-frame, annotation par frame, commentaires horodatés.
- **Image** : overlay d'annotation plein écran.
- **3D & splat** : **hotspots de surface ancrés** — model-viewer et SuperSplat exposent cette capacité (documentée) ; + snapshot caméra (déjà partiel ; bridge postMessage splat à finir).
- Sidebar de review unifiée conservée et enrichie (résolution, assignation, réactions, fil de réponses).

### 9.C6 — Responsive
- **Décision : desktop only**, mais layout propre (ne pas casser en fenêtre réduite).

---

## Vérification (par workstream, à l'implémentation)
- 9.A1 : upload FBX → conversion worker → review GLB sans erreur ; e2e en Docker.
- 9.A2 : média draft invisible aux autres / visible à l'uploader ; publish ; client ne voit que publié.
- 9.A3 : aller-retour éditeur splat → ré-upload → publish.
- 9.B : board Projet + Asset Excalidraw persistés ; insertion média (bibliothèque + upload) ; tldraw absent du bundle.
- 9.C : parcours complet desktop (nav, review avec annotations dessin/formes/couleurs, hotspots 3D) ; build + typecheck ; vérif navigateur (Preview MCP).

---

# Annexe technique (décisions tranchées + impact)

## 1. Décisions techniques résolues (étaient « à confirmer »)

- **Conversion 3D** : **assimp CLI** dans l'image worker (`apt-get install assimp-utils` → `assimp export in.fbx out.glb -f glb2`). Importe FBX/OBJ/USD/DAE/STL…, exporte glTF2 binaire. Choisi car déjà éprouvé en v1, dispo en paquet Debian (pas de build natif). Fallback `FBX2glTF` si un format pose souci.
- **Hotspots 3D/splat** : **pas de nouveau champ** — réutiliser `Comment.cameraState` (point de vue) + `Comment.annotation` typé `{ kind:'hotspot', position:[x,y,z], normal:[x,y,z], label? }`. Les annotations 2D (vidéo/image) restent dans `annotation` (`{ kind:'draw', strokes:[…] }`). Aucune migration Comment nécessaire.
- **Transform 3D** : appliqué **au runtime** (model-viewer `orientation`/`scale` depuis `Version.transform`) dans un premier temps ; **bake** dans le GLB converti optionnel en finition.
- **Éditeur SuperSplat** : chargement du splat via query (`?content=<url présignée>`, comme le viewer) ; récupération du résultat édité par interception du flux d'export de l'éditeur (download/Blob) → ré-upload comme **nouveau média draft**. *Reste à vérifier finement à l'impl (API d'export du build vendoré).*

## 2. Plan de migrations Prisma (à appliquer à l'implémentation, pas maintenant)

- **9.A2 `add_media_published`** : `MediaObject.published Boolean @default(false)`.
  Backfill dans la migration : `UPDATE "MediaObject" SET "published" = true;` (les médias existants restent visibles).
- **9.B2 `board_project_asset`** : sur `Board`, **retirer** `versionId @unique` + relation `Version.board` ; **ajouter** `projectId Int? @unique` (rel. `Project`) et `assetId Int? @unique` (rel. `Asset`), contrainte applicative XOR (exactement l'un des deux). `BoardChange` inchangé. Les boards par version existants sont supprimés (greenfield assumé). Champ `document` : commentaire tldraw → **Excalidraw scene JSON**.
- Pas de migration pour les hotspots (réutilisation `annotation`/`cameraState`).

## 3. Carte d'impact fichiers

**9.A1 — conversion GLB**
- `backend/Dockerfile` (worker) : ajouter `assimp-utils`.
- `backend/src/services/JobService.ts` : type job `convert3d`.
- `backend/src/workers/ffmpeg.worker.ts` (ou nouveau `media.worker.ts`) : handler conversion → `derived/{id}/model.glb`, `metadata.glbKey`.
- `backend/src/routes/media.routes.ts` : enqueue `convert3d` au finalize si MODEL_3D non-glb ; exposer `glbKey` dans `GET /api/media/:id`.
- `frontend/src/v2/pages/ReviewPage.tsx` : utiliser `glbKey` (fallback url) + message d'erreur si chargement échoue.

**9.A2 — draft média**
- `backend/prisma/schema.prisma` (+ migration) : `MediaObject.published`.
- `backend/src/routes/media.routes.ts` : `POST /:id/publish` (uploader) ; filtrage visibilité (listes/`GET`).
- `backend/src/routes/versions.routes.ts` / `comments` : filtrer médias non publiés pour les non-uploaders.
- `backend/src/routes/client.routes.ts` : ne servir que `published=true` (en plus de version publiée).
- `frontend` : bannière « Brouillon » + bouton Publier (TaskPage/ReviewPage).

**9.A3 — éditeur splat**
- `frontend/public/supersplat-editor/` (vendoring) ; page/route d'édition + bridge ; ré-upload via `useUploadStore`.

**9.A4 — transform 3D**
- `frontend/src/v2/pages/ReviewPage.tsx` : contrôles transform (déjà partiel) ; `PATCH /api/versions/:id` `transform`.

**9.B — board Excalidraw**
- Supprimer : `frontend/src/v2/pages/BoardPage.tsx`, route `/board/:versionId` (`App.tsx`), lien Board (`TaskPage.tsx`), dép `tldraw` (`frontend/package.json`).
- `backend/prisma/schema.prisma` (+ migration) : `Board` → Projet/Asset.
- `backend/src/routes/boards.routes.ts` : réécrire (`/api/projects/:id/board`, `/api/assets/:id/board`) ; monter dans `app.ts`.
- Nouveau `frontend/src/v2/pages/ProjectBoardPage.tsx` + `AssetBoardPage.tsx` (Excalidraw) ; dép `@excalidraw/excalidraw` ; panneau bibliothèque médias.

**9.C — refonte UI**
- Ajouter shadcn/ui (config + composants) ; `frontend/src/v2/components/` (Sidebar, Topbar, primitives) ; thème dans `index.css`/`tailwind.config.js`.
- Refonte de toutes les pages `frontend/src/v2/pages/*` ; nouveau composant d'annotation (canvas) pour la review.
- Suppression progressive du legacy v1 (`src/desktop`, `src/mobile`, `src/pages`, `src/components`, `App.jsx`).

## 4. Séquencement recommandé (dépendances)

1. **9.A1 (conversion GLB)** + **9.A2 (draft média)** d'abord — débloquent review 3D fiable + workflow de publication (peu de dépendances UI).
2. **9.B (board Excalidraw)** en parallèle — autonome (supprime une dette de licence).
3. **9.C1–C2 (design system + nav)** — socle UI, à poser avant de refondre les écrans.
4. **9.C5 (review + annotations) + 9.A3/9.A4 (édition splat / transform)** — s'appuient sur le socle UI et les fixes pipeline.
5. **9.C4 (nettoyage legacy + desktop only)** en continu, au fil de la migration des écrans.

> Chaque étape : `npm run typecheck` + tests + vérif Docker/Preview MCP avant de valider (convention projet).
