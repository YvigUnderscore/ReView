# Conventions

> Updated: 2026-07-18

## Languages

- **UI, code comments, commit messages: French.**
- **This documentation: English.**
- Commits use prefixes `feat:` / `fix:` / `refactor:` / `chore:` / `docs:` /
  `test:`, on the single `dev` branch.

## Frontend

- **TypeScript strict**; no unjustified `any`; ESLint + Prettier must be clean
  (zero warnings).
- **Theme tokens only** for colors (`bg-primary`, `text-muted-foreground`…) —
  never raw Tailwind palette classes.
- Reusable primitives live in `src/v2/components/ui/`; no hand-rolled overlays.
- Never define a component inside another component's render.
- **Simple UI rule**: a new action goes to the right-click context menu, the
  Ctrl+K palette, a contextual HUD or a shortcut first — a visible button is the
  last resort.

## Backend

- **Every input Zod-validated** (`middleware/validate`); never touch raw
  `req.body`/`req.query`.
- **RBAC on every route** (`auth` + `rbac`); reads filtered by membership.
- Multi-step writes in `prisma.$transaction`; MinIO effects after commit.
- Typed errors from `lib/errors`; pino logging (no `console.log`).
- Schema changes only via `prisma migrate dev`, with the migration committed.

## Testing

- New code ships with tests (vitest backend + frontend happy-dom, colocated).
- Never comment out, skip or delete a test to get the suite green.

## Related pages

- [Validation & tests](validation-and-tests.md)
- [Code structure](code-structure.md)
