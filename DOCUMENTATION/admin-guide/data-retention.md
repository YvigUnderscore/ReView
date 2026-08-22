# Data retention & log lifecycle

> Updated: 2026-08-22

ReView writes nine journals that grow with every day of production: who did what
(audit), who watched which media, notifications, sign-in sessions, password reset
links, invitations, client share links, ShotGrid sync history and the API v1 event
log. Left alone they never shrink — and several of them hold **personal data** (IP
addresses, identities, timestamps) that a studio cannot keep indefinitely without
being able to say why.

This page is the retention policy of the instance. It is the page to open when
answering a GDPR request, a security questionnaire or a rights-holder audit.

**Screen:** *Admin → Maintenance → Retention* (`ADMIN` only).
**API:** `GET`/`PUT /api/admin/retention`, `POST /api/admin/retention/run`.
**Stored as:** the single `retention_policy` studio setting.

## Default retention periods

`0` in any field means **keep for ever** — the family is skipped entirely by the
sweep. Values are in days and capped at 3650 (ten years).

| Family | Table | Default | What is deleted | Why this default |
|--------|-------|---------|-----------------|------------------|
| Audit log | `AuditLog` | **365 days** | Every row older than the period | One year is the usual floor for a security audit trail: it covers a full production and any yearly review |
| Media access log | `MediaAccessLog` | **365 days** | Every row older than the period | Answers "who saw this shot, and when" for a full year. Holds IP addresses, so it must be bounded |
| Notifications | `Notification` | **90 days** | Every row older than the period, read or not | The bell only ever shows recent activity; a three-month-old notification is noise |
| Sign-in sessions | `UserSession` | **30 days** | Only sessions **revoked or expired** more than that long ago | A live session is never touched. The trace of a closed session is only useful while investigating a recent incident |
| Password reset links | `PasswordReset` | **7 days** | Only links **used**, or **expired**, more than that long ago | A consumed token opens nothing; keeping it is pure liability |
| Invitations | `Invitation` | **90 days** | Only invitations **accepted** or **expired** more than that long ago | Once accepted the account exists; once expired the admin re-invites |
| Client share links | `ShareLink` | **180 days** | Only links **revoked**, or **expired**, more than that long ago | A link with no expiry that has not been revoked is still active and is never deleted |
| ShotGrid sync history | `ShotgridSyncRun` (+ its `ShotgridSyncLog` rows, by cascade) | **90 days** | Only **finished** runs, and only if they carry **no unresolved conflict** | Long enough to explain a divergence from the current season; a run awaiting arbitration is never removed |
| API event log | `ApiEvent` | **30 days** | Every row older than the period | Historical value of the `GET /api/v1/events` cursor. A consumer further behind than this restarts from the present |

Two families are deliberately **not** configurable here:

- **Trash** keeps its own setting, `trash_retention_days` (30 days by default) — see
  [System & maintenance](system-and-maintenance.md). Emptying the trash deletes files
  from object storage, which is a different kind of operation.
- **Idempotency records** (`IdempotencyRecord`) expire on a fixed technical TTL; they
  are a replay buffer for the v1 API, not a journal.

## How the sweep runs

The sweep is part of the nightly maintenance job (BullMQ `maintenance` queue, same
pass as the trash purge and the obsolete-derivative purge), and runs once again about
a minute after the API starts.

It never issues a single large `DELETE`:

1. rows are selected **oldest first**, in batches of `batchSize` (default **2000**,
   adjustable between 100 and 20 000);
2. each batch is deleted, then the sweep pauses briefly before the next one;
3. a family stops at **200 batches per pass** (≈400 000 rows). Anything left over is
   taken by the next pass;
4. a family that fails — locked table, migration in flight — is logged and skipped;
   the other eight still run.

ShotGrid runs use a tenth of the batch size, because deleting one run cascades into
up to 2000 journal rows.

This matters when retention is switched on for the first time on an instance that has
been running for a year: the backlog is absorbed over several nights instead of
locking the database for the length of one enormous delete.

## Running a sweep on demand

*Admin → Maintenance → Retention → Run a sweep now* triggers the same sweep with a
reduced ceiling (10 batches per family) so the HTTP request answers. The result gives
the number of rows deleted; when the ceiling was reached the screen says so and the
nightly pass carries on.

Use it to make a purge effective immediately after shortening a period — for example
after agreeing a shorter access-log period with a client.

## Traceability

- Changing the policy writes an audit entry `RETENTION_CONFIG` with the new values.
- A manual sweep writes `RETENTION_RUN` with the per-family counts.
- Every automatic sweep that actually deleted something writes `RETENTION_SWEEP` with
  the per-family counts.

All three are visible in *Admin → Maintenance → Audit*, which is itself subject to the
audit retention period above. Set the audit period to `0` if the studio must keep an
unbroken trail, and archive the table by other means (database backup).

## Answering a GDPR request

For "what do you keep about me, and for how long":

1. the table above lists every journal, what it contains and how long it lives;
2. `MediaAccessLog` and `AuditLog` are the two families that identify people directly;
   both default to one year;
3. `UserSession` keeps a user agent and an IP address, but only while the session is
   alive and for 30 days after it dies;
4. deleting an account removes its sessions, notifications, invitations and push
   subscriptions by cascade; audit and media-access rows keep the action but drop the
   link to the person (`SET NULL`), so they become anonymous before retention expires.

Related: [System & maintenance](system-and-maintenance.md) ·
[Users & roles](users-and-roles.md) · [Secure distribution](secure-distribution.md) ·
[ShotGrid integration](shotgrid-integration.md)
