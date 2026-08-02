# Validation & tests

> Updated: 2026-07-18

## The validation suite

Run **before every commit**:

```bash
bash scripts/validate.sh                     # typecheck + build + lint + unit tests
bash scripts/validate.sh --with-integration  # + integration tests (docker stack required)
bash scripts/validate.sh --with-e2e         # + Playwright smoke (docker + browser)
```

The script fails on the first red step, in order:

1. Backend route size budget (≤ 200 lines per route file);
2. Backend: prettier check, `tsc --noEmit`, build (prisma generate + tsc), vitest
   unit tests, then integration tests (optional);
3. Frontend: prettier check, ESLint (`max-lines` 300, zero warnings),
   `tsc --noEmit`, vitest unit tests, Vite build;
4. Playwright end-to-end smoke (optional; `E2E_CHANNEL=msedge` on local Windows).

The suite is a **protected principle**: it may be extended, never weakened — no
skipping, no commenting out tests to get to green.

## Test layout

- Colocated: `foo.ts` + `foo.test.ts` next to each other, backend and frontend.
- Frontend tests run under happy-dom; pure logic is extracted into testable
  modules (e.g. `lib/`, `pages/docs/…`) rather than tested through full pages.
- Integration tests need the docker stack (Postgres, Redis, MinIO) up.

## Related pages

- [Conventions](conventions.md)
- [Internationalisation](i18n.md)
- [Installation](../getting-started/installation.md)
