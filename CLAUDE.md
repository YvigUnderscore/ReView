# CLAUDE.md — ReView-app

> Fichier de contexte pour Claude Code. Mis à jour au fil des phases.

---

## Présentation du projet

**ReView** est une plateforme de review collaborative de médias pour studios VFX, post-production et équipes créatives.

- **Review vidéo** (frame-par-frame, annotations, commentaires horodatés)
- **Review image** (annotations overlay)
- **Board 2D** mood/reference par Projet et par Asset (Excalidraw, 9.B)
- **Review 3D** — modèles via `@google/model-viewer` (GLB/glTF ; FBX/OBJ/USD convertis en GLB)
- **Review Gaussian Splat** — `.ply`, `.compressed.ply`, `.sog`, `.splat` via SuperSplat viewer (PlayCanvas, vendoré dans `frontend/public/supersplat-viewer/`)

**Installation** : une instance = un studio.

---

## Stack actuelle

| Couche | Techno |
|--------|--------|
| Backend | Node.js + **Express 5 + TypeScript** + Prisma + **PostgreSQL** |
| Frontend | React 19 + Vite 7 + Tailwind CSS (+ **shadcn/ui** prévu en Phase 9) |
| Auth | JWT |
| Temps réel | Socket.io |
| Jobs | **BullMQ + Redis** (workers FFmpeg ; conversion 3D→GLB prévue en 9.A1) |
| 3D viewer | `@google/model-viewer` (**GLB/glTF natif** ; FBX/OBJ/USD → conversion serveur GLB) |
| Splat viewer | PlayCanvas SuperSplat (vendoré, iframe) ; **éditeur** SuperSplat à vendorer (9.A3) |
| Board 2D | **Excalidraw (MIT)** prévu en 9.B (remplace tldraw — licence commerciale) |
| Stockage | **MinIO** (S3-compatible), URLs présignées |

---

## Décisions techniques actées

| Décision | Détail |
|----------|--------|
| **Même repo** | ReView 2.0 se construit dans ce repo — refactoring libre, on garde ce qui est utile |
| **Refactoring autorisé** | Toute partie du code peut être réécrite ou supprimée si nécessaire |
| **Zustand** | À ajouter pour la gestion d'état global (uploads cross-page) |
| **MinIO** | Migration du stockage filesystem → MinIO (S3-compatible) — décision prise |
| **SuperSplat éditeur** | Self-hosté / vendoré (9.A3) ; workflow édit splat → ré-upload → publish |
| **Board 2D** | **Excalidraw (MIT)** — remplace tldraw. **Board Projet + board par Asset** (plus de board par version). Rôle **mood/reference** ; médias insérables (bibliothèque + upload). Persistance + sync simple d'abord. |
| **Draft média (9.A2)** | Brouillon au niveau **MediaObject** (`published`), visible par l'**uploader seul**, publié par lui ; vérif/édition avant diffusion équipe |
| **Conversion 3D (9.A1)** | FBX/OBJ/USD → **GLB** côté worker (model-viewer ne lit que GLB/glTF) |
| **UI Phase 9** | shadcn/ui + thème maison (teintes conservées), sidebar gauche + topbar, framer-motion subtil, **desktop only** (suppression split mobile), review complète avec outils d'annotation (dessin/formes/gomme/déplacement/couleurs) + hotspots 3D/splat |

---

## Phases de travail

> **Décision (2026-06-19) :** personne n'utilise la solution, aucune contrainte de continuité.
> On refactorise ce repo progressivement vers ReView 2.0. Tout refactoring est autorisé.
> Les Phases 1-7 sont fusionnées dans la Phase 8 et traitées dans l'ordre logique.

Voir le plan détaillé : [`logs/roadmap.md`](logs/roadmap.md)

| Sous-phase | Titre | Statut |
|-----------|-------|--------|
| 8.1 | Architecture & fondations (monorepo, stack, auth, RBAC) | ✅ Terminée |
| 8.2 | Modèle de données pipeline (Projet > Séquence > Shot > Asset > Version) | ✅ Terminée |
| 8.3 | Upload & médias (Zustand, workers FFmpeg, MinIO) | ✅ Terminée |
| 8.4 | Review & annotations (vidéo, 3D, splat, board 2D Miro) | ✅ Backend + UI (vidéo/image/3D/splat/board) ; reste snapshot caméra splat + transform 3D |
| 8.5 | Kanban & tâches (assignation, statuts, notifications) | ✅ Backend + UI kanban |
| 8.6 | Admin & paramètres studio (quotas, audit log, rôles) | ✅ Backend + UI admin (dashboard, rôles, audit, réglages) |
| 8.7 | Tests & CI/CD | 🚧 CI + 16 unit + 10 intégration + compose dev/prod ; durcissement prod (TLS/secrets) restant |

### Phase 9 — Fixes pipeline & Refonte interface (planifiée)

> Plan détaillé : [`logs/phase-9/plan.md`](logs/phase-9/plan.md). **Fixes + UI menés en parallèle, par domaine.**

| Workstream | Titre | Statut |
|-----------|-------|--------|
| 9.A1 | Conversion 3D → GLB (assimp ; fix erreur DataView model-viewer) | ✅ Terminée |
| 9.A2 | Draft média (review/édition avant publication, uploader) | ✅ Terminée |
| 9.A3 | Édition splat (éditeur SuperSplat vendoré + workflow édit→ré-upload→publish) | ✅ Terminée |
| 9.A4 | Transform/rotation 3D avant publication | ✅ Terminée |
| 9.B | Board tldraw → **Excalidraw (MIT)**, board Projet + Asset + bibliothèque média | ✅ Terminée |
| 9.C | Refonte UI (sidebar+topbar, framer-motion, review+annotations, hotspots 3D), desktop only | ✅ Cœur livré (polish shadcn/timeline : itération) |

---

## Structure clé du projet (v2)

> Point d'entrée backend = `backend/src/server.ts`. Les fichiers JS racine de `backend/`
> (`server.js`, `*.routes.js`, `services/*.js`…) sont le **legacy v1 en quarantaine** (non
> importés, supprimés au fil du temps). Point d'entrée frontend = `frontend/src/v2/App.tsx`
> (les fichiers v1 `src/components`, `src/pages`, `src/desktop`… restent en référence).

```
ReView-app/
├── docker-compose.yml             # postgres + minio + redis + backend + worker + frontend
├── backend/
│   ├── src/
│   │   ├── server.ts / app.ts     # bootstrap + montage Express
│   │   ├── config/env.ts          # env validé par Zod
│   │   ├── lib/                    # prisma, redis, jwt, errors, sanitize,
│   │   │                          #   fileSignatures (magic bytes), pipeline, settings
│   │   ├── middleware/            # auth, rbac, validate (Zod), error, rateLimit
│   │   ├── services/             # StorageService (MinIO), JobService (BullMQ),
│   │   │                          #   SocketService, NotificationService, AuditService
│   │   ├── workers/ffmpeg.worker.ts  # transcode + miniatures + ffprobe
│   │   └── routes/               # 1 fichier/domaine (auth, setup, users, studio, projects,
│   │                             #   sequences, shots, assets, tasks, versions, media,
│   │                             #   comments, boards, share, client, admin, notifications)
│   └── prisma/schema.prisma       # PostgreSQL (pipeline) + migrations/ versionnées
└── frontend/
    ├── src/
    │   ├── v2/                    # SHELL v2 (entrée)
    │   │   ├── App.tsx            # routing + bootstrap (setup/auth)
    │   │   ├── stores/useAuth.ts
    │   │   ├── pages/            # Login, Setup, Projects, Project, Task, Review,
    │   │   │                     #   Board, Kanban, Admin, Asset
    │   │   └── components/       # Shell, UploadWidget
    │   ├── lib/apiClient.ts       # client API v2 (fetch + JWT)
    │   ├── lib/uploadClient.ts    # upload présigné MinIO + finalize
    │   └── stores/useUploadStore.ts  # uploads globaux non-bloquants (Zustand)
    └── public/supersplat-viewer/  # SuperSplat viewer vendoré
        # public/supersplat-editor/ # éditeur SuperSplat vendoré (9.A3, build v2.27.4)
```

---

## Bugs connus (à adresser dans les sous-phases concernées)

- ✅ **Upload ZIP modèle 3D** : résolu en 8.3 (magic bytes PK + hint `.zip`)
- ✅ **SOG en production** : résolu en 8.3 (`optimizeDeps.exclude` + copie `webp.wasm` au nom stable + MIME nginx)
- ✅ **Upload bloquant** : résolu en 8.3 (upload présigné direct MinIO + store Zustand global)
- ✅ **Boutons superposés** : résolu en 8.4 (layout sidebar côte-à-côte, plus de fenêtre flottante sur le viewer)
- ✅ **Pas d'outils de review sur splats** : résolu en 8.4 (viewer SuperSplat en iframe + commentaires unifiés fonctionnels sur splats)
  - Reste : snapshot caméra sur splats (nécessite un bridge postMessage vers l'iframe) → traité avec 9.C5
- ✅ **Erreur 3D `RangeError: Offset is outside the bounds of the DataView`** (model-viewer) : résolu en 9.A1 (conversion serveur → GLB via assimp ; OBJ/FBX/USD/DAE/STL → `glbKey` ; model-viewer charge le GLB converti)

---

## Conventions de développement

- **Langue** : réponses et commentaires en français
- **Commits** : messages en français, préfixe `fix:` / `feat:` / `refactor:` / `chore:`
- **Branches** : `v2/description-courte`
- **Pas de code mort** : supprimer plutôt que commenter
- **Refactoring libre** : pas de compatibilité ascendante forcée
- **Docker** : tester en Docker avant de valider une sous-phase
