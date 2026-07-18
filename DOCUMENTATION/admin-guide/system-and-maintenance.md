# System & maintenance

> Updated: 2026-07-18

## Système

*Admin → Studio → Système* exposes runtime information and studio-wide limits,
including **maximum upload sizes** (in MB) per media kind.

## Corbeille (trash)

Deletions across the app are **soft deletes**: items land in
*Admin → Maintenance → Corbeille* where they can be **restored** or **purged**
(permanent, storage objects included). Purge is irreversible.

## Audit

*Admin → Maintenance → Audit* records sensitive actions (auth events, permission
changes, share links, publications, deletions…) with author, timestamp and
context — the studio's traceability baseline.

## Activité

*Admin → Studio → Activité* shows the recent activity feed across projects (who
uploaded/published/commented what, and when).

## Related pages

- [Security model](../infrastructure/security.md)
