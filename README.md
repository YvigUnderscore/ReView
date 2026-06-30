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

**ReView** est une plateforme de review collaborative conçue pour les studios VFX, équipes de post-production et créatifs. Review vidéo frame-par-frame, annotations, 3D, Gaussian Splat, board de référence — tout en un.

## ✨ Fonctionnalités

### 🎬 Review vidéo & image
Annotations vectorielles (crayon, formes, flèches) liées à la frame exacte. Commentaires horodatés, fils de discussion, mentions (@User).

### 🧊 Review 3D
Modèles GLB/glTF natifs via `@google/model-viewer`. Conversion serveur automatique depuis FBX, OBJ, USD, DAE, STL → GLB.

### 🌌 Gaussian Splat
Viewer SuperSplat (PlayCanvas) vendoré. Formats `.ply`, `.compressed.ply`, `.sog`, `.splat`. Éditeur SuperSplat intégré pour éditer et re-publier.

### 📋 Board de référence
Board Excalidraw (MIT) par Projet et par Asset — mood, références, médias insérables depuis la bibliothèque.

### 🔄 Versioning & pipeline
Hiérarchie Projet → Séquence → Shot → Asset → Version. Brouillon (draft) avant publication, historique complet, comparaison de versions.

### 👥 Collaboration temps réel
Socket.io · Kanban · Notifications · Rôles RBAC (Admin, Member, Client) · Liens de review sécurisés pour clients externes.

## 🚀 Démarrage rapide

```bash
# Cloner le dépôt
git clone https://github.com/YvigUnderscore/ReView-app.git
cd ReView-app

# Copier et configurer les variables d'environnement
cp .env.example .env
# → éditer .env (JWT_SECRET, MinIO, PostgreSQL, Redis…)

# Lancer avec Docker (recommandé)
docker compose up -d
```

L'application sera disponible sur `http://localhost:5173` (frontend) et `http://localhost:3000` (API).

## Stack

| Couche | Technologie |
|--------|-------------|
| Backend | Node.js + Express 5 + TypeScript + Prisma + PostgreSQL |
| Frontend | React 19 + Vite 7 + Tailwind CSS + shadcn/ui |
| Auth | JWT |
| Temps réel | Socket.io |
| Jobs | BullMQ + Redis (workers FFmpeg, conversion 3D) |
| 3D viewer | `@google/model-viewer` |
| Splat viewer | PlayCanvas SuperSplat (vendoré) |
| Board | Excalidraw (MIT) |
| Stockage | MinIO (S3-compatible) |

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
- **[FFmpeg](https://ffmpeg.org/)** (LGPL/GPL) · **[Google model-viewer](https://modelviewer.dev/)** (Apache-2.0)
- **[PlayCanvas SuperSplat](https://github.com/playcanvas/supersplat)** (MIT) · **[Excalidraw](https://excalidraw.com/)** (MIT)
- **[Socket.IO](https://socket.io/)** (MIT) · **[BullMQ](https://bullmq.io/)** (MIT) · **[MinIO](https://min.io/)** (AGPL-3.0)
- **[Bcrypt.js](https://github.com/dcodeIO/bcrypt.js)** (MIT) · **[JsonWebToken](https://github.com/auth0/node-jsonwebtoken)** (MIT)
- **[Helmet](https://helmetjs.github.io/)** (MIT) · **[Zod](https://zod.dev/)** (MIT)

## 📄 Licence

Ce projet est sous licence MIT.
