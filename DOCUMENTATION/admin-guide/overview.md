# Admin overview

> Updated: 2026-07-18

The admin area (`/admin`, `ADMIN` role only) is organised in grouped sections:

| Group | Section | Purpose |
|-------|---------|---------|
| — | Tableau de bord | Studio metrics at a glance |
| Studio | Activité | Recent activity feed |
| Studio | Utilisateurs | Accounts, roles, invitations — see [Users & roles](users-and-roles.md) |
| Studio | Identité (SSO) | OIDC single sign-on — see [Identity, API & audit](identity-and-api.md) |
| Studio | Système | System information & limits (upload sizes…) |
| Studio | Réglages | Studio settings, default pipeline values — see [Pipeline settings](pipeline-settings.md) |
| Projets | Défauts projet | Default settings applied to new projects |
| Contextes de review | 3D & Splat | HDRI environment library — see [HDRI library](hdri-library.md) |
| Contextes de review | Vidéo | HLS transcoding ladder — see [Transcoding](transcoding.md) |
| Contextes de review | Diffusion | Studio logo, viewer watermark, burn-ins & slates — see [Secure distribution](secure-distribution.md) |
| Contextes de review | Statuts | Custom review decision statuses — see [Review decisions](../user-guide/review-approvals.md) |
| Communications | Annonces | Studio-wide announcements — see [SMTP & announcements](smtp-and-announcements.md) |
| Communications | SMTP | Outgoing mail configuration |
| Communications | API & Webhooks | Studio API tokens + outgoing webhooks — see [Identity, API & audit](identity-and-api.md) |
| Maintenance | Corbeille | Soft-deleted items, restore/purge |
| Maintenance | Audit | Audit log of sensitive actions |
| Maintenance | Accès médias | Who viewed which media, when — see [Identity, API & audit](identity-and-api.md) |

Each section is directly addressable (`/admin/<section>`).
