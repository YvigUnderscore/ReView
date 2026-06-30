# Roadmap ReView 2.0

> Mis à jour le 2026-06-19.
>
> **Décision :** personne n'utilise la solution, aucune contrainte de continuité.
> ReView 2.0 se construit **dans ce repo**, par refactoring progressif.
> Tout le code existant peut être réécrit ou supprimé librement au besoin.
> Les anciens plans Phases 1-7 sont fusionnés ici comme checklist de fonctionnalités à construire.

---

## Sous-phase 8.1 — Architecture & fondations

**Statut :** ✅ Terminée (vérifiée end-to-end le 2026-06-19)  
**Fichiers de travail :** [`logs/phase-8/8.1-audit.md`](phase-8/8.1-audit.md), [`plans/expressive-weaving-ocean.md`](../plans/expressive-weaving-ocean.md)

### Décisions actées (8.1)
- Framework : **Express 5 conservé** (justifié dans l'audit).
- Multi-tenancy : **Studio singleton** + `ProjectMembership` (suppression de `Team`).
- Données : **greenfield** PostgreSQL (pas de migration depuis SQLite).
- TS : tooling + tranches fondamentales en `.ts` ; legacy JS en quarantaine.
- Stockage : **MinIO** via `StorageService` (URLs présignées PUT/GET).

### Objectif
Poser les bases propres de ReView 2.0 dans ce repo.

### Tâches
- [ ] Évaluer si on restructure le repo en monorepo (Turborepo) ou on garde `backend/` + `frontend/` actuels
- [ ] Migrer le backend vers TypeScript (ou garder JS avec JSDoc strict — à décider)
- [ ] Migrer SQLite → PostgreSQL (Prisma, migrations versionnées)
- [ ] Configurer MinIO dans `docker-compose.yml`
- [ ] Ajouter Zustand dans `frontend/`
- [ ] Définir le RBAC : rôles Admin, Superviseur, Artiste, Client externe
- [ ] Nettoyer le code mort évident (fichiers debug, dépendances inutilisées)

---

## Sous-phase 8.2 — Modèle de données pipeline

**Statut :** ✅ Terminée (vérifiée end-to-end le 2026-06-19) — ERD : [`phase-8/8.2-erd.md`](phase-8/8.2-erd.md)

### Objectif
Remplacer le schéma actuel (Project/Video/ImageBundle/ThreeDAsset) par une hiérarchie pipeline complète.

### Hiérarchie cible
```
Studio
└── Projet
    ├── Séquence (optionnelle)
    │   └── Shot
    │       └── Task (type: anim, fx, comp, lighting…)
    │           └── AssetVersion
    │               └── MediaObject (vidéo, image, 3D, splat)
    └── Asset (réutilisable : perso, décor, prop…)
        └── AssetVersion
            └── MediaObject
```

### Tâches
- [x] Nouveau schéma Prisma PostgreSQL complet (posé en 8.1)
- [x] Seeds de développement (`prisma/seed.ts`)
- [x] ERD documenté (`phase-8/8.2-erd.md`)
- [x] Routes CRUD pipeline : Séquence, Shot, Asset, Task, Version (RBAC + Zod + scoping projet)
- [x] Résolveurs d'accès partagés (`src/lib/pipeline.ts`)

---

## Sous-phase 8.3 — Upload & médias

**Statut :** ✅ Terminée (vérifiée end-to-end le 2026-06-19)

### Tâches
- [x] Zustand store global `useUploadStore` (uploads cross-page non-bloquants) + `lib/uploadClient.ts` + `lib/apiClient.ts`
- [x] Service `StorageService` abstrayant MinIO (`@aws-sdk/client-s3`) — posé en 8.1, enrichi (download/upload fichiers)
- [x] Tous les uploads → MinIO (présigné PUT direct navigateur, greenfield)
- [x] Serving des médias → URLs présignées GET (original + miniature + proxy)
- [x] Workers FFmpeg (BullMQ) : transcodage vidéo (proxy MP4), miniatures (vidéo+image), ffprobe (durée/dimensions/fps). Service `worker` dans le compose.
  - GIF turnaround 3D : reporté (nécessite un moteur de rendu 3D headless)
- [x] Upload ZIP modèle 3D pris en charge (magic bytes PK + hint `.zip`)
- [x] Fix compression SOG en production : `optimizeDeps.exclude` + `worker.format` + copie `webp.wasm` au nom stable + MIME `application/wasm` nginx

---

## Sous-phase 8.4 — Review & annotations

**Statut :** 🚧 Backend terminé (vérifié le 2026-06-20) — items frontend en attente du shell UI v2

### Backend (fait)
- [x] Modèle `Comment` unifié (un seul endpoint pour vidéo/image/3D/splat) — `routes/comments.routes.ts`
- [x] Commentaires fonctionnels sur **tous** les types, y compris splats (référence `MediaObject`)
- [x] Camera snapshot 3D/splat : champ `cameraState` (JSON) ; `annotation` pour l'image ; `timestamp`/`duration` pour la vidéo
- [x] Réponses (threads), réactions emoji, résolution, visibilité client, assignation
- [x] Temps réel Socket.io (`comment:new/update/delete/reaction`)
- [x] Sanitization XSS du contenu
- [x] Persistance Board (tldraw) en DB + **log des modifications** — `routes/boards.routes.ts` (`Board`/`BoardChange`)

### Frontend (shell v2)
- [x] Sidebar de review unifiée pour tous les types (page Review v2)
- [x] Câblage UI commentaires (vidéo timestamp, image, 3D) + snapshot caméra 3D
- [x] Visionneuse 3D `model-viewer` intégrée (GLB/glTF)
- [x] Board 2D tldraw : canvas, persistance via API board (CTRL+Z natif tldraw)
- [x] Visionneuse Gaussian Splat (SuperSplat en iframe `?content=<url présignée>`) + fix boutons superposés (layout côte-à-côte)
- [x] Câblage commentaires sur splats dans l'UI (commentaires unifiés fonctionnels)
- [x] UI gestion Assets réutilisables (liste + création + page Asset avec versions/upload)
- [ ] Snapshot caméra sur splats (bridge postMessage vers l'iframe SuperSplat)
- [x] Transformation 3D avant publication (orientation yaw/pitch/roll + échelle, persistée sur `Version.transform`, appliquée à model-viewer)
- [ ] SuperSplat éditeur self-hosté (vendoré) + workflow édit → publish
- [ ] Board tldraw : collab temps réel multi-curseurs, multi-images par version

> **Shell frontend v2 livré (2026-06-20)** — `frontend/src/v2/` : entrée sur `v2/App.tsx`.
> Auth (Setup/Login, `stores/useAuth.ts`), liste projets, arbre pipeline (séquences/shots/tâches),
> page tâche (versions + upload non-bloquant via `useUploadStore`), page review (sidebar unifiée
> média + commentaires, seek timestamp, snapshot caméra), widget d'upload global. Vérifié en
> navigateur headless (login → projets → pipeline). Le frontend v1 reste sur disque (référence).
>
> **Restent à câbler dans le shell v2 (UI dédiée, sous-phases concernées) :**
> visionneuses 3D (model-viewer) et splat (SuperSplat) dans la page review, édition splat,
> transform 3D, board tldraw, kanban drag-and-drop, panneau admin, gestion séquences/shots/assets.

---

## Sous-phase 8.5 — Kanban & tâches

**Statut :** 🚧 Backend terminé (vérifié le 2026-06-20) — UI kanban en attente du shell v2

### Tâches
- [x] Statuts kanban + assignation tâches → utilisateurs (`routes/tasks.routes.ts`, fait en 8.2)
- [x] Statuts : `TODO` / `IN_PROGRESS` / `PENDING_REVIEW` / `APPROVED` / `REJECTED` / `RETAKE`
- [x] Notifications in-app (`routes/notifications.routes.ts` + `NotificationService`, temps réel Socket.io) sur réponse/assignation
- [x] Webhook Discord (`NotificationService.sendDiscord`, anti-SSRF) sur nouveau commentaire
- [x] UI kanban drag-and-drop (page Kanban v2, DnD natif HTML5, 6 colonnes)

---

## Sous-phase 8.6 — Admin & paramètres studio

**Statut :** 🚧 Backend terminé (vérifié le 2026-06-20) — UI admin en attente du shell v2

### Tâches
- [x] Dashboard métriques (`GET /api/admin/dashboard` : utilisateurs par rôle, stockage, projets, uploads récents)
- [x] Gestion utilisateurs, rôles, permissions (`routes/users.routes.ts`, fait en 8.1)
- [x] Limites configurables (quotas stockage, taille fichier max, uploads simultanés) — `lib/settings.ts`, enforcement dans `media.routes`
- [x] Audit log (`AuditService.logAudit` + `GET /api/studio/audit`) sur create/delete projet, rôle, publication, partage
- [x] UI admin (page Admin v2 : dashboard métriques, gestion rôles utilisateurs, journal d'audit)
- [x] UI édition des quotas/réglages studio (taille fichier, quota stockage, uploads simultanés)

---

## Sous-phase 8.7 — Tests & CI/CD

**Statut :** 🚧 CI en place ; couverture de tests à étoffer

### Tâches
- [x] Tests unitaires (Vitest) — `fileSignatures` (magic bytes), 16 cas
- [x] GitHub Actions CI (`.github/workflows/ci.yml`) : backend typecheck+tests, frontend build, job intégration (Postgres+Redis+MinIO → migrate + smoke storage)
- [x] Tests d'intégration API (supertest, 10 cas) : santé/setup, auth/RBAC, studio/admin, pipeline complet projet→shot→task→version→média (upload présigné réel)→commentaire, partage client + commentaire invité
- [x] Docker Compose dev/prod séparés : base sécurisée (Postgres/Redis non exposés) + `docker-compose.override.yml` dev (auto-chargé, expose 5432/6379). Prod : `docker compose -f docker-compose.yml up -d`
- [ ] Durcissement prod restant : secrets managés, reverse-proxy TLS devant le frontend, exposition MinIO derrière proxy

---

# Phase 9 — Fixes pipeline & Refonte interface

> Série d'upgrades post-MVP (planifiée le 2026-06-20). Plan détaillé : [`phase-9/plan.md`](phase-9/plan.md).
> **Fixes + refonte UI menés en parallèle, par domaine.** Décisions Q&A consignées dans le plan.

### Bloc 1 — Fixes
- [x] **9.A1** Conversion 3D → GLB côté worker (assimp ; OBJ/FBX/USD/DAE/STL) + `glbUrl` exposé + ReviewPage utilise le GLB converti + état « conversion en cours » — ✅ vérifié e2e (OBJ→GLB)
- [x] **9.A2** Draft média (`MediaObject.published`, **visible uploader seul**, publié par l'uploader ; filtrage version/review/`GET media`/client ; bannière + bouton UI) — ✅ vérifié e2e (visibilité + publication)
- [ ] **9.A3** Éditeur SuperSplat vendoré (`public/supersplat-editor/`) + workflow édit → ré-upload → publish
- [x] **9.A4** Transform/rotation/échelle 3D avant publication (`Version.transform` + contrôles yaw/pitch/roll/échelle dans ReviewPage, application runtime model-viewer)
- [x] **9.A3** Éditeur SuperSplat **vendoré** dans `frontend/public/supersplat-editor/` (build v2.27.4, 9,6 Mo) + page `/editor/:mediaId` (iframe `?load=<url présignée>&filename=`) + ré-import → nouveau média brouillon → publish. Vérifié : éditeur servi à `:3429`, rendu dans l'iframe (titre/canvas/UI), sans erreur console.
- [x] **9.B4** Insertion bibliothèque média sur le board (endpoint `GET /api/media?projectId&kind` + panneau vignettes Excalidraw + `convertToExcalidrawElements`) — vérifié (3 images listées)

### Bloc 2 — Board (tldraw → Excalidraw MIT) ✅ vérifié e2e (2026-06-20)
- [x] **9.B1** tldraw supprimé (dép `tldraw`, ancienne `BoardPage` per-version, route `/board/:versionId`, lien TaskPage)
- [x] **9.B2** Nouveau modèle : `Board` Projet + Asset (`projectId?`/`assetId?` unique) + migration `board_project_asset`
- [x] **9.B3** Excalidraw 0.18 (React 19) intégré + persistance API (`/api/boards/project/:id`, `/api/boards/asset/:id`), sync debouncée + reload ; lazy-load (code-split) ; shim `process` navigateur
- [~] **9.B4** Board mood/reference : **upload direct natif** (drag-drop Excalidraw) OK ; insertion depuis la **bibliothèque média** = itération suivante

### Bloc 3 — Refonte interface (desktop)
- [~] **9.C1** Thème maison affiné (teintes conservées) + icônes lucide. shadcn/ui : primitives à généraliser (itération suivante)
- [x] **9.C2** Navigation : **sidebar gauche persistante** (Projets/Admin, état actif) + topbar (Shell refondu)
- [x] **9.C3** Animations framer-motion subtiles (transition de page)
- [x] **9.C4** Desktop only (Shell `h-screen`, plus de split mobile dans le shell v2)
- [x] **9.C5** Annotation review complète : **dessin libre + rect/ellipse/flèche + gomme + déplacement + undo/redo + sélecteur de couleurs/épaisseur** (overlay SVG, coords normalisées) + **hotspots de surface 3D** (model-viewer `positionAndNormalFromPoint`) + snapshot caméra. Persistance dans `Comment.annotation`. Vérifié e2e (2D : POST 201 + relecture 🖊).
- [ ] **9.C6 / polish** Généraliser les primitives shadcn sur toutes les pages, timeline vidéo à marqueurs, nettoyage final legacy v1
