# ReView documentation

*Six sections, one per audience — start where you stand, and follow the links from there.*

> Updated: 2026-08-23

ReView is a collaborative media review platform for VFX, post-production and creative teams:
frame-accurate video review, image and EXR-sequence review with overlay annotations, 3D and
USD scenes, Gaussian splats with a non-destructive editor, Excalidraw boards, kanban task
tracking, secure client distribution and full studio administration. **One instance = one
studio.**

This folder is the single source of truth for product, admin, API and infrastructure
documentation. It is versioned with the code, read on GitHub, and served inside the
application on the **`/docs`** page — searchable, organised by chapter.

![Six sections branch off the documentation root, each written for one audience: getting started for the operator, the user guide for artists and supervisors, the admin guide for the studio administrator, the API section for integrators, infrastructure for ops and development for contributors.](assets/documentation-map.svg)

## Where to start

| If you are… | Read, in this order |
|-------------|---------------------|
| **Installing ReView** | [Installation](getting-started/installation.md) → [First run](getting-started/first-run.md) → [Docker stack](getting-started/docker-stack.md) → [Updating](getting-started/updating.md) |
| **An artist or a supervisor** | [The review workspace](user-guide/review-workspace.md) → the viewer you use → [Annotations & comments](user-guide/annotations-and-comments.md) → [Approvals](user-guide/review-approvals.md) |
| **Setting up a studio** | [Admin overview](admin-guide/overview.md) → [Users & roles](admin-guide/users-and-roles.md) → [Pipeline settings](admin-guide/pipeline-settings.md) → [Transcoding](admin-guide/transcoding.md) |
| **Wiring ReView into a pipeline** | [API overview](api/overview.md) → [Authentication](api/authentication.md) → [Public API v1](api/v1-integration.md) → [Python client](api/python-client.md) |
| **Keeping it alive** | [Architecture](infrastructure/architecture.md) → [Backups](infrastructure/backups.md) → [Monitoring](infrastructure/monitoring.md) → [Security](infrastructure/security.md) |
| **Contributing code** | [Code structure](development/code-structure.md) → [Conventions](development/conventions.md) → [Validation & tests](development/validation-and-tests.md) |

Not sure what ReView can do at all? The [Feature tour](getting-started/feature-tour.md) lists
every area in one page, each with a link to its guide.

## The six sections

| Section | For whom | What it covers |
|---------|----------|----------------|
| [getting-started/](getting-started/) | Whoever runs the instance | Feature tour, installation, first run, the Docker stack, updating with rollback |
| [user-guide/](user-guide/) | Artists and supervisors | The four viewers, annotations and comments, approvals, playlists and live review, kanban, boards, sharing, note export, personalisation, account security |
| [admin-guide/](admin-guide/) | The studio administrator | Users and roles, project organisation, pipeline defaults, transcoding, colour management, storage and retention, secure distribution, identity and API, ShotGrid, SMTP, branding, HDRI, USD and Alembic, maintenance |
| [api/](api/) | Integrators and pipeline TDs | REST conventions, authentication and tokens, per-domain reference, the read-only public v1, the Python client |
| [infrastructure/](infrastructure/) | Whoever keeps it running | Architecture, containers and configuration, MinIO, jobs and workers, HLS delivery, monitoring, backups, the security model |
| [development/](development/) | Contributors | Code structure, conventions, the validation suite, internationalisation, accessibility, writing documentation, licensing |

Two files sit outside the six: **[CHANGELOG.md](CHANGELOG.md)**, which feeds the in-app
"What's new" panel, and **assets/**, which holds every screenshot and figure.

## Conventions

Every page opens the same way — a title, a one-line subtitle in italics, and a date:

```markdown
# Video review

*Frame-accurate playback, comparison modes and timeline markers for delivered shots.*

> Updated: 2026-08-23
```

The reader renders those three from the manifest and removes them from the body, so the header
of every page looks the same and the date is shown in the reader's own language.

The rest — chapters, callouts, tables, the SVG figure contract and its palette, screenshots,
links and anchors, and how to register a new page — is written down in
**[Writing documentation](development/documentation-style.md)**.

> [!IMPORTANT]
> A feature is documented in the same session it ships. Documentation that lags behind the
> product is worse than none: it teaches people things that are no longer true.

Before committing a change to this folder:

```bash
node scripts/check-docs.mjs --list
```

It checks every preamble, internal link, anchor, image and figure, and runs inside
[`scripts/validate.sh`](development/validation-and-tests.md).
