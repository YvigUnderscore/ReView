# Backups & restore

> Updated: 2026-07-19

Two things hold all persistent state: **PostgreSQL** (metadata) and **MinIO**
(media objects). Redis only carries queues/cache and needs no backup.

## Taking a backup

```bash
bash scripts/backup.sh [dir]        # default ./backups
```

Produces, timestamped, with rotation (`BACKUP_KEEP`, default 7 of each):

- `db-<stamp>.dump` — `pg_dump -Fc` of the app database (runs inside the postgres
  container, no local tooling needed);
- `minio-<stamp>.tar.gz` — tar of the MinIO data volume (via a throwaway alpine
  container, works on Git Bash/Windows and Linux).

Schedule it from the docker host (cron / Windows Task Scheduler) and ship the
directory off-machine. `COMPOSE_PROJECT` overrides the `review-app` container
prefix if yours differs.

## Restoring

```bash
# Database — into the live DB (stop backend+worker first):
docker compose stop backend worker
bash scripts/restore.sh db backups/db-<stamp>.dump
docker compose up -d backend worker

# Database — into a scratch DB (safe test / inspection):
bash scripts/restore.sh db backups/db-<stamp>.dump review_restore_test

# MinIO objects (stops/starts the minio container itself):
bash scripts/restore.sh minio backups/minio-<stamp>.tar.gz
```

The DB restore uses `pg_restore --clean --if-exists --no-owner`; DB and MinIO
backups taken at the same stamp form a consistent pair (take them during a quiet
period — uploads mid-backup could reference objects newer than the dump).

## Tested procedure

This flow is exercised for every release of the backup scripts (last:
2026-07-19): run `backup.sh`, restore the dump into a scratch database
(`restore.sh db <dump> review_restore_test`), verify row counts
(`psql -c 'select count(*) from "User"'`), list the tar contents, then drop the
scratch DB. Re-run it after any change to the scripts or to the compose volumes.

## Related

- [Monitoring](monitoring.md)
- MinIO versioning: for object-level point-in-time recovery, enable bucket
  versioning with `mc version enable` on your MinIO deployment (optional,
  storage-hungry; the tar backup above is the supported baseline).
