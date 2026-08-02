<p align="center">
  <img src="frontend/public/logo_full.png" alt="ReView Logo" width="400">
</p>

<p align="center">
  <b>Plateforme de review collaborative de médias pour studios VFX & post-production</b><br>
  Open-source · Self-hostable · Desktop-first
</p>

<p align="center">
  <a href="https://discord.gg/vw7h6BqcNc">
    <img src="https://img.shields.io/discord/1330663471017398292?color=5865F2&label=Discord&logo=discord&logoColor=white" alt="Discord Server" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/licence-AGPL--3.0--or--later-blue" alt="Licence AGPL-3.0-or-later" />
  </a>
</p>

---

**ReView** est une plateforme de review collaborative conçue pour les studios VFX, équipes de post-production et créatifs. Vidéo frame-par-frame, images annotées, scènes 3D & USD, Gaussian splats, boards de référence, kanban, dailies en direct, partages clients sécurisés et administration studio — tout en un, sur votre propre infrastructure. **Une instance = un studio.**

## Vue d'ensemble

| Domaine | Ce que ReView sait faire |
|---------|--------------------------|
| 🎬 **Vidéo** | HLS adaptatif, frame-par-frame, A/B · wipe · diff · grille 2×2, annotations à la frame, safe areas, planche contact |
| 🖼️ **Image** | Annotations overlay, comparaison A/B, référence, lightbox |
| 🧊 **3D & USD** | Viewer façon DCC, USD de bout en bout (scenegraph, variantes, overrides), inspection, OCIO, caméra F-curves |
| ✨ **Splats** | Viewer Spark, éditeur non-destructif, export SPZ, lecture SOG |
| 💬 **Collaboration** | Threads, mentions, vocal, statuts personnalisables, dailies & salle de review live |
| 🔒 **Diffusion** | Liens durcis, burn-ins, slates, watermark nominatif |
| 🛡️ **Identité & API** | SSO OIDC, 2FA, tokens à scopes, webhooks HMAC, OpenAPI |
| 🏭 **Production** | Pipeline hérité, verrou de publication, quotas, stats, calendrier, Gantt |
| ⚙️ **Infra** | Docker, workers FFmpeg (NVENC), uploads résumables + dédup, backups, Prometheus/Grafana |

## ✨ Fonctionnalités

### 🎬 Review vidéo

- Lecture **HLS adaptative multi-rendition**, navigation **frame-par-frame** précise, boucle in/out, marqueurs de timeline, miniatures au survol (sprite généré au transcodage).
- Comparaison de versions : côte-à-côte synchronisé, **wipe** (barre orientable), **diff** |A − B| composité GPU (avec heatmap), **grille 2×2** jusqu'à quatre versions.
- Annotations vectorielles ancrées au cadre de livraison (formes, polygone), **plages in→out** persistantes à la lecture, commentaires liés à la frame exacte.
- Guide **letterbox** à l'aspect de livraison, croix centrale, **action/title safe** (90 %/80 %).
- **Planche contact** exportable (grille PNG de la plage), export de frame annotée, trim, miniatures animées au survol des cartes, mode théâtre et lecteur détachable (PiP).

### 🖼️ Review image

Annotations en overlay, comparaison A/B entre versions, image de référence, lightbox et plein écran — mêmes commentaires et décisions que la vidéo.

### 🧊 Review 3D & USD

- Viewer **Three.js façon DCC** : navigation orbit/fly unifiée, éclairage **HDRI** (bibliothèque studio + HDRI par défaut du projet + sol récepteur d'ombres), focale en mm sur capteur 36 mm, aperçu PiP.
- **USD de bout en bout** : conversion native `.usd`/`.usdc`/`.usda`/`.usdz` et archives `.zip` par **Blender + usd-core** (repli `guc` puis assimp) — matériaux `UsdPreviewSurface`, variantes et animation `UsdSkel` préservés.
- **Scenegraph** : arbre de prims réel dans le panneau Scène, **sélection au clic** dans le viewer, halo de sélection, `F` cadre la sélection, menu clic droit par prim (variantes, cacher, isoler, réinitialiser).
- **Variantes cuites** dans le fichier converti : bascule instantanée, même sur média publié.
- **Overrides ReView** non-destructifs : TRS par prim au gizmo, visibilité, choix de variante — persistés, rejoués pour tous, ou attachés à un commentaire comme proposition de scène navigable.
- **Inspection** : modes shaded/wireframe/normales/matcap/UV, fiche technique (polycount, matériaux, UV, provenance de conversion), inspecteur de textures, bookmarks caméra partagés, turntable, plan de coupe, comparaison **A/B 3D** à caméras liées.
- **Animations GLB fiables** : rigs squelettiques, morph targets, sélecteur de clips, overlay de debug du squelette.
- **Caméra animée par F-curves** (canaux Hermite) : dopesheet + graph editor éditables, import de caméra **Alembic** (.abc), mise en scène persistée par média et rejouée à l'identique pour chaque spectateur.
- Gestion de couleur **OCIO** (display/view par projet, catalogue ACES).

### ✨ Gaussian splats

- Viewer **Spark (SparkJS)** intégré à la scène Three.js — formats **PLY**, **SPZ** et lecture **SOG/SOGS** (PlayCanvas).
- Éditeur **non-destructif** : sélection pinceau/volumes, masquage, teinte, TRS — le fichier original n'est jamais modifié, les éditions sont rejouées à l'identique pour tous.
- **Export du splat nettoyé en SPZ**, chargement progressif des gros fichiers, mise en scène (caméra, DoF) persistée par média.

### 💬 Commentaires & approbation

- **Fils de discussion** avec mentions @, résolution, réactions, **notes vocales**, brouillons locaux, liens profonds à la frame ou au commentaire, conversion commentaire → tâche kanban, suivi (watch) par shot/asset/version.
- **Circuit d'approbation** avec statuts de review **personnalisables** par studio : décisions historisées par version, badges partout, filtres.
- **Dailies** : playlists cross-shots à lecture enchaînée, et **salle de review live** synchronisée — un pilote diffuse lecture, navigation, comparaison et caméra 3D à toute la salle, passage de main en un clic.

### 📋 Boards, kanban & documents

- **Boards Excalidraw** par projet et par asset (mood, références).
- **Kanban** par projet : tâches typées pipeline, checklists, multi-sélection et actions en masse.
- **Documents** riches (briefs, notes de réunion) au niveau studio ou projet.

### 🔒 Diffusion sécurisée

- Liens de partage client **durcis** : mot de passe, expiration, limite de vues, révocation, audit des consultations — page client épurée aux couleurs du studio.
- **Burn-ins configurables** (shot/version/timecode/logo) incrustés au transcodage, **slates** d'identification en tête des partages, **watermark au nom du spectateur**.

### 🛡️ Identité & API publique

- **SSO OIDC** (Google…), **2FA TOTP** avec codes de secours, **sessions révocables** par appareil, journal d'accès aux médias.
- **Tokens d'API personnels** à scopes lecture/écriture pour scripter l'API REST, **webhooks sortants signés HMAC** (média publié, décision, commentaire).
- Référence API interactive (**OpenAPI/Scalar**, générée depuis les schémas Zod) servie sur `/api/docs`.

### 🏭 Pipeline, organisation & reporting

- Hiérarchie **Projet → Séquence → Shot / Asset → Tâche → Version** ; brouillon avant publication, **verrou de publication** (le contenu publié est immuable — on corrige par une nouvelle version).
- Réglages de livraison **hérités** studio → projet → séquence → shot (résolution, framerate, plages de frames).
- **Templates et duplication de projet**, archivage lecture seule restaurable, **quotas de stockage**, rôles par projet, conventions de nommage, **import/export CSV** (passerelle ShotGrid/Ftrack/Kitsu).
- **Reporting** : statistiques de review (temps par shot, notes & retakes, convergence par séquence), **calendrier des échéances**, **Gantt par séquence**, rapport hebdomadaire de production par mail.

### ⚙️ Infrastructure & exploitation

- Stack **Docker Compose** complète : PostgreSQL, MinIO (S3, URLs présignées), Redis, backend, worker, frontend — plus Prometheus, Grafana et ClamAV en option.
- Workers **BullMQ + FFmpeg** : HLS multi-rendition (**NVENC** en option avec repli x264), miniatures & sprites, conversion 3D → GLB, chaîne USD Blender/guc/assimp, opérations splat.
- **Uploads résumables** par parts avec vérification d'intégrité, **déduplication** SHA-256 (upload instantané), antivirus optionnel.
- **Sauvegarde/restauration** documentées (base + objets MinIO), métriques Prometheus + dashboard Grafana provisionné, tableau de bord des jobs in-app, corbeille et purge des fichiers dérivés, audit d'administration.

### 🎨 Personnalisation & UX quotidienne

Thème clair/sombre/système · densité d'affichage · **langue FR/EN** · raccourcis reconfigurables (cheatsheet `?`) · palette Ctrl+K & menus clic droit · favoris · vues de liste sauvegardées · reprise où on s'était arrêté · **thème studio** (accent + logo au login) · notifications **Web Push** et **Slack/Discord** · changelog in-app « Nouveautés » · tour d'onboarding · **workspace de review unifié** (modes, rail d'outils, barre d'options, dock inspecteur) commun aux quatre viewers.

### 📚 Documentation intégrée

Le manuel produit ([`DOCUMENTATION/`](DOCUMENTATION/README.md), en anglais) est versionné avec le code et servi **dans l'application** sur la page `/docs` : guides utilisateur, guide admin, référence API et infrastructure.

## 🚀 Démarrage rapide

```bash
git clone https://github.com/YvigUnderscore/ReView.git
cd ReView
cp .env.example .env   # → éditer JWT_SECRET, MinIO, PostgreSQL, Redis…
docker compose up -d --build
```

L'application est disponible sur **http://localhost:3429** (API sur `:3430`, Grafana optionnel sur `:3431`).
Guides complets : [Installation](DOCUMENTATION/getting-started/installation.md) · [Stack Docker](DOCUMENTATION/getting-started/docker-stack.md) · [Déploiement production (nginx/TLS)](DEPLOYMENT.md).

### 🔑 Comptes & premier lancement

- **Premier lancement réel** : sans seed, l'instance démarre en **mode setup** — le premier écran crée le studio et le compte administrateur. Aucun mot de passe par défaut n'existe en production.
- **Seed de développement** (`npm run seed` dans `backend/`) :

| Compte | Email | Mot de passe |
|--------|-------|--------------|
| Admin | `admin@review.local` | `admin1234` |
| Artiste | `artist@review.local` | `artist1234` |

> ⚠️ Réservé au développement local — ne jamais exposer une instance seedée.

## 🧱 Stack

| Couche | Technologie |
|--------|-------------|
| Backend | Node.js + Express 5 + TypeScript + Prisma + PostgreSQL 16 |
| Frontend | React 19 + Vite 7 + Tailwind CSS + primitives style shadcn |
| Auth / Temps réel | JWT (+ SSO OIDC, 2FA TOTP) / Socket.io |
| Jobs | BullMQ + Redis (workers FFmpeg : HLS multi-rendition, miniatures, conversion 3D→GLB, chaîne USD Blender + usd-core → `guc` → assimp) |
| 3D / Splat | Three.js / Spark (SparkJS) |
| Board | Excalidraw (MIT) |
| Stockage | MinIO (S3-compatible), URLs présignées ; nginx TLS frontal en prod |
| Observabilité | Prometheus + Grafana (optionnels), métriques `/metrics` |

Détails d'architecture : [DOCUMENTATION/infrastructure/architecture.md](DOCUMENTATION/infrastructure/architecture.md).

## 📂 Structure du dépôt

```
ReView-app/
├── docker-compose.yml       # postgres + minio + redis + backend + worker + frontend (+ monitoring)
├── DEPLOYMENT.md            # déploiement production (nginx, TLS, overlay prod)
├── DOCUMENTATION/           # doc produit/admin/API/infra (EN, servie in-app sur /docs)
├── backend/                 # Express 5 + Prisma : routes, services, workers, tests
├── frontend/                # React 19 + Vite : app v2 (pages, review, ui), stores, tests
├── monitoring/              # provisioning Prometheus/Grafana
├── nginx/                   # config reverse-proxy production
└── scripts/                 # validate.sh (typecheck + build + lint + tests), utilitaires
```

## 🧪 Développement

```bash
bash scripts/validate.sh                    # typecheck + build + lint + tests unitaires
bash scripts/validate.sh --with-integration # + tests d'intégration (stack docker requise)
bash scripts/validate.sh --with-e2e         # + smoke Playwright
```

Conventions, structure du code et suite de validation : [DOCUMENTATION/development/](DOCUMENTATION/development/code-structure.md).

## ⭐ Star History

<a href="https://www.star-history.com/#YvigUnderscore/ReView&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=YvigUnderscore/ReView&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=YvigUnderscore/ReView&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=YvigUnderscore/ReView&type=date&legend=top-left" />
 </picture>
</a>

## 🙏 Remerciements & licences

ReView tient debout sur le travail d'autres : **[React](https://react.dev/)**,
**[Vite](https://vitejs.dev/)**, **[Node.js](https://nodejs.org/)**,
**[Express](https://expressjs.com/)**, **[Prisma](https://www.prisma.io/)**,
**[TailwindCSS](https://tailwindcss.com/)**, **[Three.js](https://threejs.org/)**,
**[Spark](https://sparkjs.dev/)**, **[Excalidraw](https://excalidraw.com/)**,
**[Socket.IO](https://socket.io/)**, **[BullMQ](https://bullmq.io/)**,
**[MinIO](https://min.io/)**, **[FFmpeg](https://ffmpeg.org/)**,
**[Blender](https://www.blender.org/)**, **[OpenUSD](https://openusd.org/)** — et 594
paquets de plus.

La liste exhaustive, avec le texte de licence de chacun, est dans
**[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)** (généré par
`node scripts/generate-notices.mjs`, jamais à la main).

## 📄 Licence

ReView est un **logiciel libre sous [AGPL-3.0-or-later](LICENSE)**.

Vous pouvez l'installer, le modifier, le vendre et bâtir votre activité dessus. La seule
contrepartie : si vous en proposez une **version modifiée** à d'autres — y compris
simplement en l'hébergeant pour vos clients — vous devez leur en fournir les sources
(article 13). Concrètement, publiez votre fork et renseignez son URL dans
**Admin → Réglages → « Code source (AGPL §13) »**. Une instance non modifiée n'a rien à faire.

Vos médias, projets et données ne sont jamais concernés : la licence porte sur le logiciel.

- **[Licence commerciale](COMMERCIAL-LICENSE.md)** — pour les studios qui ne peuvent pas
  accepter les obligations de l'AGPL.
- **[Contribuer](CONTRIBUTING.md)** · **[CLA](CLA.md)** — les contributions passent par un
  accord de licence, c'est ce qui rend la double licence possible.
- **[Documentation de licence](DOCUMENTATION/development/licensing.md)** — obligations
  détaillées, compatibilité des dépendances, redistribution des images Docker.

> Jusqu'au 2 août 2026, ReView était distribué sous licence MIT. Une licence accordée ne se
> révoque pas : **les versions publiées avant cette date restent disponibles sous MIT**. Le
> changement ne vaut que pour la suite.
