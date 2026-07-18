# ReView — Documentation

ReView is a collaborative media review platform for VFX, post-production and creative
teams: frame-accurate video review, image review with overlay annotations, 3D model
review (Three.js), Gaussian splat review and non-destructive editing (Spark), 2D
mood/reference boards (Excalidraw), kanban task tracking and studio administration.

This folder is the single source of truth for product, admin, API and infrastructure
documentation. It is versioned with the code and served inside the application on the
`/docs` page.

## Structure

| Section | Content |
|---------|---------|
| [getting-started/](getting-started/) | Installation, Docker stack, first run, seed accounts |
| [user-guide/](user-guide/) | One file per feature: reviews (video/image/3D/splat), annotations, comments, boards, kanban, upload & publishing, navigation, sharing |
| [admin-guide/](admin-guide/) | Users & roles, pipeline settings, transcoding, HDRI library, SMTP, announcements, quotas, audit |
| [api/](api/) | Authentication, REST conventions, per-domain reference, errors, webhooks |
| [infrastructure/](infrastructure/) | Architecture, Docker services, MinIO, Redis/BullMQ workers, nginx/TLS, backups, security model |
| [development/](development/) | Code structure, conventions, validation suite, testing |
| [assets/](assets/) | Screenshots and GIFs referenced by the docs |

## Writing conventions

- **Language: English.** One topic = one file, kebab-case file names.
- Start each file with a `# Title` and an `> Updated: YYYY-MM-DD` line.
- Use relative links between pages; images live in `assets/<section>/<feature>-NN.png`.
- Add screenshots/GIFs only when text is not enough (captured via the in-app browser
  tooling against the local Docker stack).
- Keep pages task-oriented: what the feature does, how to use it, edge cases, related
  settings. Admin/API/infra pages also document defaults and security implications.
- Update the relevant pages **in the same phase** a feature ships (CP-DOC checkpoint);
  never let the docs lag behind released behavior.
