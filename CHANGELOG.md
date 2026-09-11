# Changelog

Release log of the ReView **distribution**: one entry per published version, newest first.

**This file does not duplicate the product release notes.** What changed *for the people
using the app* is written once, in [`DOCUMENTATION/CHANGELOG.md`](DOCUMENTATION/CHANGELOG.md),
and shown in the in-app **What's new** panel. What is written *here* is what an operator
needs in order to upgrade a running instance: version number, date, the matching user-facing
entry, migrations, breaking changes, and any manual step.

## Conventions

- **Versions follow [SemVer](https://semver.org/)** and are published as annotated git tags
  `vX.Y.Z`. Major = an upgrade requires a decision (data model, mandatory configuration);
  minor = features; patch = fixes.
- **Every release has a section here**, titled `## vX.Y.Z — YYYY-MM-DD`. The release
  workflow (`.github/workflows/release.yml`) refuses to publish a tag that has none, and
  uses the section as the body of the GitHub release.
- Each section uses only the headings it needs, in this order: **Highlights** (one line,
  linking to the user-facing entry), **Breaking**, **Migrations**, **Operator actions**,
  **Images**.
- Unreleased work accumulates under `## Unreleased` and is renamed on the day of the tag.
- Images are published as `ghcr.io/<owner>/review-backend|review-worker|review-frontend`
  with the same tag as the release. Upgrading is
  `bash scripts/update.sh --version vX.Y.Z`, which backs up first and rolls back if the
  readiness probe fails.

## Unreleased

### Highlights

Installable by a third-party studio without us: an installer, a versioned update path with
rollback, a health probe that actually probes, a visible version, published images, and
alerting that fires instead of being suggested.

### Operator actions

- New installs: `bash scripts/install.sh` writes `.env` and `deploy/` (rendered nginx
  configuration and site overlay), generates every secret, creates the data directories and
  starts the stack. Nothing else needs editing by hand.
- Existing installs keep working unchanged. To adopt the new paths on an instance installed
  by hand, set `COMPOSE_FILE` in `.env` to the exact stack you run (this is what removes the
  "forgot the second `-f` and silently fell back to development mode" trap) and add
  `APP_VERSION=` so the instance can name itself.
- Backups changed layout: `backups/<timestamp>/{db.dump,minio/,manifest.txt}` plus a live
  mirror in `backups/minio-current/`. The old `db-*.dump` / `minio-*.tar.gz` files are still
  restorable — `bash scripts/restore.sh db <file>` and `... minio <file.tar.gz>` accept them.
  `BACKUP_MODE=archive` keeps the previous whole-volume behaviour.
- Monitoring: alert rules live in `monitoring/rules/`. They are only loaded if that
  directory is mounted into the Prometheus container
  (`./monitoring/rules:/etc/prometheus/rules:ro`); without the mount, Prometheus still
  starts and the rules are simply absent.

- **Updates and backups from the administration.** `bash scripts/ops-agent.sh install`
  starts a small operations agent, mounts the backup directory and the order spool into the
  backend, and lets **Admin → Maintenance → Updates** back up and switch releases. The agent
  holds `/var/run/docker.sock` — equivalent to root on that machine — so it is optional and
  installed deliberately; its permissions live in `deploy/agent.conf`, which no container of
  the application mounts. Without it the screen still names the running release, lists the
  published ones with their notes, and prints the exact commands.
- **`scripts/install.sh` now proposes published images by default** (`--images`,
  `--image-tag`), and writes `REVIEW_ROOT` and `COMPOSE_PROJECT_NAME` into `.env`. On an
  instance installed earlier, add those two keys before installing the agent — it mounts the
  repository at that exact host path, and `scripts/backup.sh` passes its own `pwd` to
  `docker run`, which the daemon resolves host-side.
- **Fixed: the automatic rollback was unreachable** in the most common failure. `worker` and
  `frontend` both depend on `backend: service_healthy`; a failed Prisma migration made
  `docker compose up -d` exit non-zero, and `set -e` killed `update.sh` before its rollback
  section. Nothing to do — just re-read the script if you had copied it.
- **Fixed: published images could never be built.** The release workflow used the repository
  owner verbatim, and an OCI reference does not accept an uppercase path. Registry mode is
  usable for the first time; images also carry their version, commit and build date, which
  `GET /api/version` had been reporting as `null`.

### Migrations

- `20260911101957_assignation_review_version` — creates the `_VersionReviewers` link table
  (who a version's review was handed to). Additive: no column changes, no data rewritten,
  and an instance that skips the feature simply never writes a row. Applied by
  `migrate deploy` like the rest; nothing to do by hand.

## Earlier history

Versions before this log were not published as images. The tags that exist in the
repository (`V1.01`, `1.1.0`, `V1.1.1`, `Stable`) predate the 2.x line and predate SemVer
discipline; they are kept for archaeology, not for installation. The product history — what
each phase delivered, in the words of the people who use it — is in
[`DOCUMENTATION/CHANGELOG.md`](DOCUMENTATION/CHANGELOG.md).
