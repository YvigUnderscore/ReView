# Phase 8 — ReView 2.0 (nouveau repo, Prism-like)

**Statut :** ⏳ À démarrer — **PRIORITÉ UNIQUE**  
**Repo :** Nouveau repo séparé (`review-2.0` ou équivalent)  
**Prérequis :** Aucun — ce repo est gelé, on démarre 2.0 directement

---

## Vision

ReView 2.0 est une refonte complète sur une base propre :
- **Architecture pipeline** inspirée de Prism Pipeline (séquences, shots, assets, tâches)
- **Stack production-ready** : Next.js + TypeScript + Tailwind + PostgreSQL + MinIO + Redis
- **Multi-rôles studio** : Admin, Superviseur, Artiste, Client externe
- **Look UI conservé** : même palette de couleurs, même style Tailwind que l'actuel
- **DB vierge** : pas de migration de l'ancienne DB, repartir proprement

---

## Ressources à consulter

- Prism Pipeline repo : https://github.com/PrismPipeline/Prism
- Prism docs : https://prism-pipeline.com/documentation/
- Forums Prism : pour les conventions de nomenclature (shots, séquences, assets)
- `AGENTS.md` de ce repo : instructions pour la génération du prompt maître ReView 2.0
- `docs/REVIEW-2.0-audit-report.md` : analyse complète de l'existant

---

## Hiérarchie des entités (Prism-like)

```
Studio (une instance = un studio)
└── Projet
    ├── Séquence (optionnelle, pour VFX/animation)
    │   └── Shot
    │       └── Task (type: anim, fx, comp, lighting...)
    │           └── AssetVersion
    │               └── MediaObject (vidéo, image, 3D, splat)
    └── Asset (réutilisable cross-shots : personnage, décor, prop...)
        └── AssetVersion
            └── MediaObject
```

---

## Sous-phases

### 8.1 — Architecture & fondations
- Initialiser monorepo (Turborepo recommandé)
- `apps/web` : Next.js 15 + TypeScript + Tailwind
- `apps/api` : Fastify ou NestJS + TypeScript
- `apps/worker` : Bull/BullMQ (jobs FFmpeg, miniatures, etc.)
- `packages/database` : Prisma + PostgreSQL
- `packages/contracts` : types/zod schemas partagés
- `packages/ui` : composants Tailwind partagés (garder le look actuel)
- Auth : NextAuth.js ou JWT custom
- RBAC : définir les rôles dès le départ

### 8.2 — Modèle de données pipeline
- Schéma PostgreSQL complet (entités listées ci-dessus)
- Migrations versionnées
- Seeds de dev (données d'exemple)
- ERD documenté

### 8.3 — Upload & médias
- Reprise du système d'upload (Zustand store global)
- Workers FFmpeg (transcodage vidéo, GIF turnaround 3D)
- MinIO (déjà connu depuis Phase 7)
- File de jobs BullMQ

### 8.4 — Review & annotations
- Board 2D Miro-like (Phase 4 portée en 2.0)
- Review vidéo avec annotations
- Review 3D + Splat (Phases 2-3 portées en 2.0)
- Commentaires + réponses + réactions
- Statuts de review

### 8.5 — Kanban & tâches
- Kanban par projet/séquence/shot
- Assignation tâches → utilisateurs
- Statuts : `todo`, `in_progress`, `pending_review`, `approved`, `rejected`, `retake`
- Notifications en-app + optionnellement Discord

### 8.6 — Admin & paramètres studio
- Panel admin complet (Phase 6 portée en 2.0)
- Configuration des limites (quotas, stockage)
- Audit log
- Gestion des rôles

### 8.7 — Tests & CI/CD
- Tests unitaires critiques (Vitest)
- Tests d'intégration API
- GitHub Actions CI
- Docker Compose dev + prod

---

## Nomenclature Prism-like à adopter

| Terme Prism | Équivalent ReView 2.0 |
|-------------|----------------------|
| Project | Projet |
| Sequence | Séquence |
| Shot | Shot |
| Step | Tâche (type) |
| Asset | Asset |
| Version | Version |
| Department | Département (si applicable) |

*À affiner après lecture de la doc Prism*

---

## Notes importantes

- **Ne pas migrer la DB** de ce repo vers ReView 2.0 — base vierge
- **Conserver le look** : exporter les tokens de design (couleurs Tailwind) dans `packages/ui`
- **MinIO réutilisé** : la config MinIO de ce repo peut servir d'exemple
- **SuperSplat viewer et éditeur** : à re-vendorer dans le nouveau repo
