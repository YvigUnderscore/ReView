<p align="center">
  <img src="frontend/public/logo_full.png" alt="ReView Logo" width="400">
</p>

<p align="center">
  <b>Plateforme de review collaborative de médias pour studios VFX & post-production</b><br>
  Open-source · Self-hostable · Desktop-first<br>
  <a href="https://discord.gg/vw7h6BqcNc">
    <img src="https://img.shields.io/discord/1330663471017398292?color=5865F2&label=Discord&logo=discord&logoColor=white" alt="Discord Server" />
  </a>
</p>

---

**ReView** est une plateforme de review collaborative conçue pour les studios VFX, équipes de post-production et créatifs : review vidéo frame-par-frame, images annotées, modèles 3D, Gaussian splats, boards de référence, kanban et administration studio — tout en un, sur votre propre infrastructure. Une instance = un studio.

## ✨ Fonctionnalités

### 🎬 Review vidéo & image
Lecture HLS adaptative multi-rendition, navigation frame-par-frame précise, comparaison A/B et wipe entre versions, plein écran immersif. Annotations vectorielles ancrées au cadre de livraison, commentaires liés à la frame exacte, guide letterbox à l'aspect de livraison.

### 🧊 Review 3D
Viewer Three.js façon DCC : navigation orbit/fly unifiée, éclairage HDRI (bibliothèque studio), transform avec gizmo + undo/redo, caméra animée par F-curves (dopesheet + graph editor), focale en mm sur capteur 36 mm, aperçu PiP. **Inspection** : modes d'affichage (shaded/wireframe/normales/matcap/UV), fiche technique (polycount, matériaux, UV, extensions, provenance de conversion) + inspecteur de textures, bookmarks caméra partagés, turntable, plan de coupe, comparaison **A/B 3D** caméra liée. Conversion **USD native** (matériaux & variantes préservés, convertisseur `guc` optionnel, repli assimp), **HDRI par défaut du projet** + sol récepteur d'ombres, gestion de couleur **OCIO** (display/view par projet, catalogue ACES).

### ✨ Gaussian splats
Viewer **Spark (SparkJS)** + éditeur **non-destructif** : sélection pinceau/volumes, masquage, teinte, TRS — le fichier original n'est jamais modifié, les éditions sont rejouées à l'identique pour tous. Mise en scène (caméra, DoF) persistée par média.

### ✅ Approbation & dailies
Circuit d'approbation avec **statuts de review personnalisables** par studio (décisions historisées par version, badges partout). **Playlists de dailies** cross-shots avec lecture enchaînée, et **salle de review live** synchronisée : un pilote diffuse lecture, navigation et caméra 3D à toute la salle, passage de main en un clic.

### 💬 Commentaires v2
Fils de discussion avec mentions @, résolution, réactions, notes vocales, brouillons locaux, liens profonds à la frame ou au commentaire, conversion commentaire → tâche kanban, suivi (watch) par shot/asset/version.

### 📋 Boards & kanban
Board Excalidraw par projet et par asset (mood, références). Kanban par projet, tâches typées pipeline, multi-sélection et actions en masse.

### 🔄 Versioning & pipeline
Hiérarchie Projet → Séquence → Shot / Asset → Tâche → Version. Brouillon avant publication, **verrou de publication** (le contenu publié est immuable — on corrige par une nouvelle version), réglages de livraison hérités (résolution, framerate, plages de frames).

### 🔒 Diffusion sécurisée
Liens de partage client durcis (mot de passe, expiration, **limite de vues**, révocation, audit des consultations) avec **page client épurée** aux couleurs du studio. **Burn-ins configurables** (shot/version/timecode/logo) incrustés au transcodage, **slates** d'identification en tête des partages, **watermark** au nom du spectateur.

### 🛡️ Identité & API publique
**SSO OIDC** (Google…), **2FA TOTP** avec codes de secours, **sessions révocables** par appareil. **Tokens d'API** personnels à scopes lecture/écriture pour scripter l'API REST, **webhooks sortants signés HMAC** (média publié, décision, commentaire), **journal d'accès aux médias**.

### 👥 Collaboration & administration
Socket.io temps réel · Notifications · RBAC (Admin, Supervisor, Artist, Client) · Admin studio complet (utilisateurs, transcodage HLS, HDRI, SMTP, annonces, corbeille, audit).

### 📚 Documentation intégrée
Le manuel produit (dossier [`DOCUMENTATION/`](DOCUMENTATION/README.md), en anglais) est versionné avec le code et servi dans l'application sur la page `/docs`. La référence API interactive (OpenAPI/Scalar) est sur `/api/docs`.

## 🚀 Démarrage rapide

```bash
git clone https://github.com/YvigUnderscore/ReView-app.git
cd ReView-app
cp .env.example .env   # → éditer JWT_SECRET, MinIO, PostgreSQL, Redis…
docker compose up -d --build
```

L'application est disponible sur **http://localhost:3429** (API sur `:3430`). Guide complet : [Installation](DOCUMENTATION/getting-started/installation.md).

## 🔑 Comptes & premier lancement

- **Premier lancement réel** : sans seed, l'instance démarre en **mode setup** — le premier écran crée le studio et le compte administrateur. Aucun mot de passe par défaut n'existe en production.
- **Seed de développement** (`npm run seed` dans `backend/`) :

| Compte | Email | Mot de passe |
|--------|-------|--------------|
| Admin | `admin@review.local` | `admin1234` |
| Artiste | `artist@review.local` | `artist1234` |

> ⚠️ Réservé au développement local — ne jamais exposer une instance seedée.

## Stack

| Couche | Technologie |
|--------|-------------|
| Backend | Node.js + Express 5 + TypeScript + Prisma + PostgreSQL |
| Frontend | React 19 + Vite 7 + Tailwind CSS + primitives style shadcn |
| Auth / Temps réel | JWT / Socket.io |
| Jobs | BullMQ + Redis (worker FFmpeg : HLS multi-rendition, miniatures, conversion 3D→GLB — USD native via `guc` optionnel, repli assimp) |
| 3D / Splat | Three.js / Spark (SparkJS) |
| Board | Excalidraw (MIT) |
| Stockage | MinIO (S3-compatible), URLs présignées |

Détails d'architecture : [DOCUMENTATION/infrastructure/architecture.md](DOCUMENTATION/infrastructure/architecture.md).

## Star History

<a href="https://www.star-history.com/#YvigUnderscore/ReView-app&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=YvigUnderscore/ReView-app&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=YvigUnderscore/ReView-app&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=YvigUnderscore/ReView-app&type=date&legend=top-left" />
 </picture>
</a>

## 🙏 Remerciements & Licences

- **[React](https://react.dev/)** (MIT) · **[Vite](https://vitejs.dev/)** (MIT) · **[Node.js](https://nodejs.org/)** (MIT)
- **[Express](https://expressjs.com/)** (MIT) · **[Prisma](https://www.prisma.io/)** (Apache-2.0)
- **[TailwindCSS](https://tailwindcss.com/)** (MIT) · **[shadcn/ui](https://ui.shadcn.com/)** (MIT)
- **[Framer Motion](https://www.framer.com/motion/)** (MIT) · **[Lucide React](https://lucide.dev/)** (ISC)
- **[FFmpeg](https://ffmpeg.org/)** (LGPL/GPL) · **[Three.js](https://threejs.org/)** (MIT) · **[Spark](https://sparkjs.dev/)** (MIT)
- **[Excalidraw](https://excalidraw.com/)** (MIT) · **[marked](https://marked.js.org/)** (MIT)
- **[Socket.IO](https://socket.io/)** (MIT) · **[BullMQ](https://bullmq.io/)** (MIT) · **[MinIO](https://min.io/)** (AGPL-3.0)
- **[Bcrypt.js](https://github.com/dcodeIO/bcrypt.js)** (MIT) · **[JsonWebToken](https://github.com/auth0/node-jsonwebtoken)** (MIT)
- **[Helmet](https://helmetjs.github.io/)** (MIT) · **[Zod](https://zod.dev/)** (MIT)

## 📄 Licence

Ce projet est sous licence MIT.
