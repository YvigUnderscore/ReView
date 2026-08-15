# Admin overview

> Updated: 2026-08-02

The admin area (`/admin`, `ADMIN` role only) is organised in grouped sections.
The **Contenus** group provides dedicated, detail-rich pages per entity
(users, projects, versions, comments, storage) — the dashboard metric cards
link straight into them.

| Group | Section | Purpose |
|-------|---------|---------|
| — | Tableau de bord | Studio metrics at a glance, linked to the detail pages |
| Studio | Activité | Recent activity feed |
| Studio | Identité (SSO) | OIDC single sign-on — see [Identity, API & audit](identity-and-api.md) |
| Studio | Système | System information & limits (upload sizes…) |
| Studio | Réglages | Studio settings, default pipeline values — see [Pipeline settings](pipeline-settings.md) |
| Studio | Défauts projet | Default settings applied to new projects |
| Contenus | Utilisateurs | Account list (search/filter/sort) + per-user detail page — see [Content explorer](content-explorer.md) |
| Contenus | Projets | All projects with counters/quotas + per-project detail page (members, hierarchy, inherited settings) — see [Content explorer](content-explorer.md) |
| Contenus | Versions | Global filterable list of every version — see [Content explorer](content-explorer.md) |
| Contenus | Commentaires | Studio-wide comment search & moderation — see [Content explorer](content-explorer.md) |
| Contenus | Stockage | MinIO occupancy + map of where each file type lives — see [Storage map](storage.md) |
| Contextes de review | 3D & Splat | HDRI environment library — see [HDRI library](hdri-library.md) |
| Contextes de review | Couleur (OCIO) | Color management configs — see [Color management](color-management.md) |
| Contextes de review | Vidéo | HLS transcoding ladder — see [Transcoding](transcoding.md) |
| Contextes de review | Diffusion | Studio logo, viewer watermark, burn-ins & slates — see [Secure distribution](secure-distribution.md) |
| Contextes de review | Statuts | Custom review decision statuses — see [Review decisions](../user-guide/review-approvals.md) |
| Communications | Annonces | Studio-wide announcements — see [SMTP & announcements](smtp-and-announcements.md) |
| Communications | SMTP | Outgoing mail configuration |
| Communications | API & Webhooks | Studio API tokens + outgoing webhooks — see [Identity, API & audit](identity-and-api.md) |
| Communications | ShotGrid | Studio-wide ShotGrid sites and credentials — see [ShotGrid integration](shotgrid-integration.md) |
| Maintenance | Jobs | BullMQ queues (retry, purge) + derived-files purge — see [Monitoring](../infrastructure/monitoring.md) |
| Maintenance | Corbeille | Soft-deleted items, restore/purge |
| Maintenance | Audit | Audit log of sensitive actions |
| Maintenance | Accès médias | Who viewed which media, when — see [Identity, API & audit](identity-and-api.md) |

Each section is directly addressable (`/admin/<section>`), and detail pages add
an id segment (`/admin/users/<id>`, `/admin/projects/<id>`).

Project-level organization (archiving, duplication, storage quotas, upload naming,
per-project roles, CSV import/export, task checklists) is managed from each
project rather than the admin area — see
[Project organization & per-project rights](project-organization.md).
