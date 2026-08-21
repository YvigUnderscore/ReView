# Validation & tests

> Updated: 2026-08-16

## The validation suite

Run **before every commit**:

```bash
bash scripts/validate.sh                     # all static checks + unit tests
bash scripts/validate.sh --with-integration  # + integration tests (docker stack required)
bash scripts/validate.sh --with-e2e          # + Playwright smoke (docker + browser)
```

The script fails on the first red step, in order:

1. **Licensing** — SPDX headers on every source file
   (`scripts/add-license-headers.mjs --check`), then `THIRD-PARTY-NOTICES.md`
   freshness against the lockfiles (`scripts/generate-notices.mjs --check`);
2. **i18n** — catalog coherence (`check-translations.mjs`), hardcoded UI strings
   (`check-untranslated.mjs`, ratchet at 0), raw translation keys reaching the
   screen (`check-raw-keys.mjs`);
3. **Theme** — no raw Tailwind palette classes (`bg-blue-500`…) or arbitrary
   color values outside theme tokens (`check-color-tokens.mjs`); no pixel font
   sizes (`check-text-sizes.mjs`), which would ignore the density setting since
   density scales the root font size and everything else is sized in `rem`;
4. **Tooling** — ESLint on the root `scripts/*.mjs` (`lint-scripts.mjs`, using
   the backend's ESLint through the Node API), Prettier check on the same files,
   `bash -n` syntax check on `scripts/*.sh`;
5. **Backend route size budget** (≤ 200 lines per route file, SPDX header
   excluded from the count);
6. **Backend** — Prettier check; **ESLint (zero warnings)**; `prisma validate`
   (with a placeholder `DATABASE_URL`, no database needed); typecheck through
   `tsconfig.eslint.json` (which, unlike the build tsconfig, **includes tests,
   `prisma/` and `scripts/`**); build (prisma generate + tsc); vitest unit tests
   (also collects `../scripts/**/*.test.mjs`); integration tests (optional);
7. **Frontend** — Prettier check (now covers `src/**/*.{ts,tsx,css}`,
   `e2e/`, `scripts/**/*.mjs` and the `.config.ts` files); **ESLint (zero
   warnings)**; typecheck (`tsc --noEmit` for `src/`, plus
   `tsconfig.e2e.json` for `e2e/` and the config files); vitest unit tests;
   Vite build; **entry bundle budget** (`check-bundle-budget.mjs`) — gzip size
   of the script the browser downloads before the first screen, so route-level
   code splitting cannot silently regress;
8. **Playwright end-to-end smoke** (optional; `E2E_CHANNEL=msedge` on local
   Windows).

The suite is a **protected principle**: it may be extended, never weakened — no
skipping, no commenting out tests to get to green.

## ESLint rule sets

Both packages run `npm run lint` (`eslint . --max-warnings 0`) and offer
`npm run lint:fix`.

### Backend (`backend/eslint.config.mjs`)

- `@eslint/js` recommended + `typescript-eslint` recommended;
- **type-aware promise safety** (via `tsconfig.eslint.json`):
  `no-floating-promises`, `no-misused-promises`, `await-thenable`,
  `no-unnecessary-type-assertion`, `prefer-promise-reject-errors`;
- `no-console` (**pino is the only log channel**) — off for CLI scripts
  (`prisma/seed.ts`, `scripts/`), one justified fail-fast exception in
  `config/env.ts`;
- `no-restricted-syntax` bans the `'fr-FR'` literal (server logs use ISO);
- `@vitest/eslint-plugin` on tests: `no-focused-tests`, `no-disabled-tests`,
  `no-identical-title`, `no-commented-out-tests`, `no-standalone-expect`,
  `valid-expect` (maxArgs 2 — `expect(value, message)` is supported vitest
  usage).

### Frontend (`frontend/eslint.config.js`)

Everything the backend has (browser flavor), plus:

- `eslint-plugin-react-hooks` v7 recommended with the analysis rules
  (`static-components`, `set-state-in-effect`, `immutability`, `purity`) as
  errors; `react-refresh/only-export-components`;
- **type-aware promise safety** on `src/` (`projectService`), with
  `no-misused-promises` tolerating async handlers in JSX attributes
  (`checksVoidReturn.attributes: false`) — fire-and-forget calls must be
  explicit (`void doThing()`);
- `eslint-plugin-jsx-a11y` recommended — two rules off with justification:
  `media-has-caption` (VFX dailies/playblasts have no captions) and
  `no-autofocus` (deliberate in dialogs, per ARIA Authoring Practices);
- `no-console` allowing `warn`/`error` only;
- `no-restricted-syntax` bans the `'fr-FR'` literal (use `intlLocale()`) and
  `fetch()` inside `useEffect` (data-fetching goes through TanStack Query);
- `max-lines` 300 (code lines) on components/pages — tests and `e2e/` exempt.

### Deliberately not enabled (yet)

- `typescript-eslint` `recommendedTypeChecked`/`strict` extras (the
  `no-unsafe-*` family, `restrict-template-expressions`…): large violation
  surface, to be evaluated as a dedicated pass;
- stylistic rule sets (formatting is Prettier's job);
- markdownlint / stylelint (2 CSS files, low value — Prettier formats CSS).

Any evolution must **extend** the suite; never trade a check away.

## Test layout

- Colocated: `foo.ts` + `foo.test.ts` next to each other, backend and frontend.
- Root tooling scripts (`scripts/*.mjs`) keep their tests next to them
  (`*.test.mjs`), collected by the **backend** vitest run; the frontend's
  `scripts/build-docs.mjs` is covered by the frontend vitest run.
- Frontend tests run under happy-dom; pure logic is extracted into testable
  modules (e.g. `lib/`, `pages/docs/…`) rather than tested through full pages.
- Integration tests need the docker stack (Postgres, Redis, MinIO) up.

## Documentation screenshots

The images under `DOCUMENTATION/assets/` are **generated**, never taken by hand:

```bash
cd frontend && DOCS_FIXTURES=/path/to/fixtures E2E_CHANNEL=msedge npx playwright test e2e/docs-capture.spec.ts
```

`e2e/docs-capture.spec.ts` signs in, forces the interface to English, builds a neutral demo
project (`Nebula Rising`) if it is missing, and captures the screens the documentation
refers to. Re-run it after a visual change: a stale screenshot misleads more than no
screenshot at all.

Three rules are enforced by the script itself, and matter if you extend it:

- **Nothing from a real production.** The repository is public. Other projects of the
  studio are hidden from the sidebar, and the demo data uses invented names.
- **Nothing that only exists in development.** The TanStack Query devtools button and the
  account's own overlays (pending drafts, ongoing uploads) are hidden.
- **Wait for content, never for a delay.** Heavy pages load lazily; a fixed timeout used to
  capture a `Loading…` on an empty background.

Demo media (FFmpeg test patterns) stay **outside** the repository — they weigh more than
the whole documentation. Regenerate them:

```bash
ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=24:duration=6" -f lavfi -i "sine=frequency=440:duration=6" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest SH010_comp_v001.mp4
```

## Related pages

- [Conventions](conventions.md)
- [Internationalisation](i18n.md)
- [Licensing](licensing.md)
- [Installation](../getting-started/installation.md)
