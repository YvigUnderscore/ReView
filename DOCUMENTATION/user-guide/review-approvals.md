# Review decisions & approvals

> Updated: 2026-07-18

Supervisors and admins can put a **review decision** on any version — distinct from
the task's kanban status. Decisions drive the approval circuit: pending → retake →
new version → approved.

## Statuses

Decision statuses are **customizable per studio**
(*Admin → Contextes de review → Statuts*). Fresh instances start with the classic
set: **Pending** (default), **Approved** (approval flag), **Retake** (retake flag)
and **CBB** (could be better). Each status has a name, a color, an order and
optional flags (approval / retake / proposed by default).

## Making a decision

Two surfaces (no extra buttons elsewhere):

- **Right-click a version card** (task or asset page) → *Décision de review…*
- The **clipboard button in the review header** while reviewing a media.

Both open the same dialog: pick a status, optionally add a comment, submit.
Only `SUPERVISOR` and `ADMIN` roles can decide; everyone can read the history.

## History & traceability

Every decision is **kept forever** (who, when, which status, comment) — the badge
on cards shows the *latest* decision. Each decision is also written to the audit
log, and the version's author receives a notification.

## Filtering

The Reviews page has a **decision filter** (any status, or "no decision"), which
combines with the project/type/status filters.

## Typical circuit

1. Artist uploads a version and publishes it.
2. Supervisor reviews, puts **Retake** with a comment.
3. Artist uploads **V02**, publishes.
4. Supervisor puts **Approved** — the badge turns green everywhere the version
   appears.

## Related pages

- [Projects & pipeline](projects-and-pipeline.md)
- [Kanban & tasks](kanban-and-tasks.md)
- [Admin overview](../admin-guide/overview.md)
