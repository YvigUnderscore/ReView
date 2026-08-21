# Backups & restore

> Updated: 2026-08-21

Two things hold all persistent state: **PostgreSQL** (metadata) and **MinIO** (media
objects). They must be backed up **together** — the database stores MinIO object keys,
and a restore that mixes stamps produces versions pointing at objects that do not
exist.

What is *not* backed up, on purpose:

| Volume | Why |
|--------|-----|
| `redisdata` | Queue state only. A lost queue means re-running `POST /api/media/:id/reprocess` on the affected media |
| `prometheus_data`, `grafana_data` | Observability history, rebuildable |
| `clamav_db` | Re-downloaded on first start |

## Taking a backup

```bash
bash scripts/backup.sh [dir]        # default ./backups
```

Produces, timestamped (`YYYYmmdd-HHMMSS`), with rotation:

- `db-<stamp>.dump` — `pg_dump -Fc` of the app database, run **inside** the postgres
  container, so no local PostgreSQL tooling is needed. The script aborts if the dump
  comes out empty;
- `minio-<stamp>.tar.gz` — tar of the MinIO data volume, taken through a throwaway
  alpine container attached with `--volumes-from`. Works on Git Bash/Windows and Linux.

Two environment variables:

| Variable | Default | Role |
|----------|---------|------|
| `BACKUP_KEEP` | `7` | Backups kept **per type** (older ones are deleted) |
| `COMPOSE_PROJECT` | `review-app` | Container name prefix — the script targets `${COMPOSE_PROJECT}-postgres-1` and `${COMPOSE_PROJECT}-minio-1` |

```bash
# a project deployed under another name
COMPOSE_PROJECT=review-prod BACKUP_KEEP=14 bash scripts/backup.sh /srv/backups/review
```

Check which prefix you actually have before scheduling anything:

```bash
docker compose ps --format '{{.Name}}'
```

Schedule it from the docker host and ship the directory off-machine:

```cron
# /etc/cron.d/review-backup — 03:15 every day
15 3 * * * root cd /srv/review && BACKUP_KEEP=14 bash scripts/backup.sh /srv/backups/review >> /var/log/review-backup.log 2>&1
```

On Windows, use Task Scheduler with
`"C:\Program Files\Git\bin\bash.exe" -c "cd /c/srv/review && bash scripts/backup.sh"`.

### Consistency

The dump and the tar are taken back to back, not atomically. Take them during a quiet
period: an upload that lands between the two produces an object with no row (harmless,
an orphan) or a row with no object (a broken media). The second is the one that hurts,
so run the backup **before** the tar of MinIO — which is the order the script uses.

For a stricter guarantee, stop the writers for the duration:

```bash
docker compose stop backend worker
bash scripts/backup.sh
docker compose start backend worker
```

## Restoring

```bash
# Database — into the live DB (stop backend+worker first):
docker compose stop backend worker
bash scripts/restore.sh db backups/db-20260821-031500.dump
docker compose up -d backend worker

# Database — into a scratch DB (safe test / inspection):
bash scripts/restore.sh db backups/db-20260821-031500.dump review_restore_test

# MinIO objects (stops and restarts the minio container itself):
bash scripts/restore.sh minio backups/minio-20260821-031500.tar.gz
```

The DB restore uses `pg_restore --clean --if-exists --no-owner`. Passing a third
argument creates that database if needed and restores into it, leaving the live one
untouched — this is the only safe way to inspect a backup.

The MinIO restore is destructive: it runs `rm -rf /data/*` in the volume before
extracting the archive. It stops and restarts the `minio` container itself, so nothing
else needs stopping — but the backend will fail every storage call in between.

⚠️ **On a production host, restart with both compose files.** A bare
`docker compose up -d backend worker` auto-loads `docker-compose.override.yml` and
silently drops the instance back to `NODE_ENV=development`, disabling the production
guards and republishing PostgreSQL and Redis:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend worker
```

`restore.sh db` prints both commands at the end for exactly this reason.

## Testing a restore

Untested backups are not backups. Run this drill after any change to the scripts, to
the compose volumes, or to the PostgreSQL major version — and at least once a quarter
otherwise. It never touches the live database.

```bash
# 1. take a fresh pair
bash scripts/backup.sh

# 2. restore the dump into a scratch database
bash scripts/restore.sh db backups/db-<stamp>.dump review_restore_test

# 3. compare row counts with the live database
docker exec review-app-postgres-1 \
  psql -U review -d review -t -c 'select count(*) from "User", "Project", "MediaObject"'
docker exec review-app-postgres-1 \
  psql -U review -d review_restore_test -t -c 'select count(*) from "User", "Project", "MediaObject"'

# 4. sanity-check the object archive without extracting it
tar tzf backups/minio-<stamp>.tar.gz | head
tar tzf backups/minio-<stamp>.tar.gz | wc -l

# 5. drop the scratch database
docker exec review-app-postgres-1 dropdb -U review review_restore_test
```

A full drill goes further: restore both halves into a throwaway stack (a separate
`COMPOSE_PROJECT`), open the app, and play one video and one 3D media. That is the only
check that proves the object keys in the database still resolve.

This flow is exercised for every release of the backup scripts (last: 2026-07-19).

## Disaster recovery order

1. Bring up `postgres` and `minio` alone: `docker compose up -d postgres minio`.
2. Restore MinIO first, then the database — the backend crash-loops at boot while MinIO
   is unavailable, so there is no point starting it earlier.
3. Start the rest with the production command.
4. Check `GET /api/admin/system` reports `database`, `redis` and `minio` all `true`.
5. Look for media stuck in `PROCESSING` (the queue was not restored) and retry them
   with `POST /api/media/:id/reprocess`.

## Related

- [Monitoring & operations](monitoring.md)
- [MinIO storage](storage-minio.md)
- [Docker stack](../getting-started/docker-stack.md)
- MinIO versioning: for object-level point-in-time recovery, enable bucket versioning
  with `mc version enable` on your MinIO deployment (optional, storage-hungry; the tar
  backup above is the supported baseline).
