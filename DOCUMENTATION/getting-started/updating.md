# Updating

> Updated: 2026-08-22

Updating a ReView instance is one command. It backs up first, switches, waits for the
instance to report itself healthy, and puts the previous version back if it does not.

```bash
cd /path/to/ReView-app
bash scripts/update.sh --version v2.3.0
```

## What it does, in order

1. **Reads the current state** — `APP_VERSION` (and `REVIEW_IMAGE_TAG` in registry mode)
   from `.env`, plus the current git commit. That is what a rollback goes back to.
2. **Backs up** — runs `scripts/backup.sh` and refuses to continue if it fails. Skip with
   `--no-backup` only if you have another snapshot (a ZFS one, say).
3. **Switches** — pulls the published images, or checks out the tag and rebuilds, and
   writes the new `APP_VERSION` so the instance can name itself.
4. **Migrates** — the backend container runs `prisma migrate deploy` at boot. There is no
   destructive fallback: a failed migration fails the boot, which fails the next step.
5. **Verifies** — polls `GET /health/ready` *inside* the backend container (no assumption
   about host ports or the TLS front) until every dependency answers, for up to
   `--timeout` seconds (default 300).
6. **Rolls back if needed** — restores the previous tag or commit, restarts, and re-checks.
   If the previous version does not come back either, it says so: the problem is not the
   version.

## Versions and release notes

Versions are `vX.Y.Z` git tags. Two changelogs, on purpose:

- [`CHANGELOG.md`](https://github.com/YvigUnderscore/ReView/blob/main/CHANGELOG.md) at the
  repository root — the **operator** log: what each version requires (breaking changes,
  migrations, manual steps, images). Read it before updating.
- `DOCUMENTATION/CHANGELOG.md` — the **product** notes, the ones your artists read in the
  in-app *What's new* panel.

After the update, the running version is visible in three places: `GET /api/version`,
**Admin → System → About this instance**, and the `review_worker_info` metric.

## Two modes

### Published images (recommended)

No compilation on the studio's server: the release workflow publishes
`review-backend`, `review-worker` and `review-frontend` for every tag. Point the instance
at them once, in `.env`:

```dotenv
COMPOSE_PATH_SEPARATOR=:
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.release.yml:deploy/compose.site.yml
REVIEW_IMAGE_PREFIX=ghcr.io/yvigunderscore
REVIEW_IMAGE_TAG=v2.3.0
```

`update.sh` then requires `--version`: there is no implicit `latest` in production,
because an instance that cannot name its version cannot be supported — nor can it point at
the *corresponding* sources the AGPL asks for.

### Local build

The default after `scripts/install.sh`. `update.sh` fetches tags, checks out the requested
one (or fast-forwards the branch) and rebuilds. It refuses to run with locally modified
tracked files — commit or discard them first. This is why the installer never edits a
versioned file: everything specific to your site is in `.env` and `deploy/`.

## Rolling back on purpose

```bash
bash scripts/update.sh --version v2.2.4 --yes
```

The same machinery runs in reverse, with one caveat the script prints and this page
repeats: **the code goes back, the database does not**. Prisma migrations are one-way. If
the older version cannot run on the migrated schema, restore the dump taken just before
the update:

```bash
docker compose stop backend worker
bash scripts/restore.sh db backups/<timestamp>/db.dump
docker compose up -d backend worker
```

Everything written since the update is lost by that restore — do it only if the instance
is unusable. Restoring media objects as well is `bash scripts/restore.sh all backups/<timestamp>`.

## Checking a backup before you need it

```bash
bash scripts/restore.sh verify backups/<timestamp>
```

Restores the dump into a throwaway database, counts what came out, compares the object
snapshot with the live bucket, then drops the throwaway database. Nothing on the instance
is touched. Worth scheduling monthly — a backup that has never been restored is not a
backup. See [Backups & restore](../infrastructure/backups.md).

```
▶ Restauration d'essai dans la base jetable review_restore_check_1787412217…
  base   : 57 tables, 40 comptes, 20054 médias
  objets : 2290 dans l'instantané, 2295 dans le bucket vivant
✅ Sauvegarde 20260822-172229 vérifiée (rien n'a été modifié sur l'instance).
```

A small object delta is normal — uploads that landed after the mirror ran. The check only
fails on something that means the backup is not usable: an empty snapshot, or a dump that
restores fewer than eleven tables.

## If something goes wrong

| Symptom | Meaning | What to do |
|---------|---------|-----------|
| `la sauvegarde n'a pas abouti` | `backup.sh` failed before anything was switched | The instance is untouched. Check disk space and `docker compose ps postgres minio` |
| Rollback ran, previous version healthy | The new version cannot start here | Read `docker compose logs --tail=100 backend`; a failed migration or a new required variable is the usual cause |
| Rollback ran, previous version *also* unhealthy | Not a version problem | Look at the dependencies: disk full, MinIO down, database unreachable |
| `des fichiers suivis sont modifiés localement` | Someone edited a versioned file on the server | `git diff` to see what, then commit or `git checkout --` it. Site configuration belongs in `.env` and `deploy/` |
| Update succeeded but users see the old interface | Browser cache on `index.html` | The bundled nginx sends `no-cache` for `index.html`; a custom front proxy must not cache it |

## Related pages

- [Installation](installation.md)
- [Backups & restore](../infrastructure/backups.md)
- [Monitoring & operations](../infrastructure/monitoring.md) — probes, metrics, alerts
- [Containers & configuration](../infrastructure/containers-and-configuration.md)
