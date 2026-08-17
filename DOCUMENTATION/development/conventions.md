# Conventions

> Updated: 2026-08-17

## Languages

- **Code comments and commit messages: French.**
- **UI text never hardcoded**: everything goes through `t()` with English-first
  catalogs (14 languages — see [Internationalisation](i18n.md)).
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

### Layout

- Pages render `PageShell`, never the `Shell` itself: `Shell` is a router layout
  mounted once for every authenticated route, and pages live in its `<Outlet/>`.
  Titles and breadcrumbs are portalled into the top bar.
- `PageShell` takes a `width`: `default` (centred, max 1600 px — all data pages),
  `fluid` (full width, same gutter — kanban, board) or `flush` (no gutter, full
  space — review, timeline player). The gutter belongs to the container, not to
  `<main>`.
- Page headers use `PageHeader`, which wraps title and actions onto separate
  lines instead of squeezing them.
- Supported window widths: **900 px to 3440 px**. Below ~1100 px the sidebar
  collapses on its own and overlays the content when reopened.
- Tab bars overflow into a `…` menu (`components/Tabs.tsx`); never horizontal
  scrolling, which pushes the whole page sideways.

### Right-click

- Right-click is **only** for business menus attached to a target. On anything
  else nothing opens, and the browser menu stays blocked (`ContextMenuGuard`).
  Page-wide actions belong in the Ctrl+K palette.
- Never call `preventDefault` on `contextmenu` inside a `ContextMenuTrigger`:
  Radix composes handlers with `checkForDefaultPrevented`, so the business menu
  would silently never open.
- Describe menus as data (`lib/menuSpec.ts`) and render them with
  `components/ui/entity-menu.tsx`, which also handles keyboard opening
  (Menu key / Shift+F10) and nesting.
- No action may exist *only* behind a right-click: mirror it in Ctrl+K.
- When a clicked card belongs to the current multi-selection, the action applies
  to the whole selection (`lib/entityActions.ts`).

### Colour and type

- Status colours coming from data (ShotGrid, studio) go through
  `statusSwatch()` (`lib/contrast.ts`), which keeps the hue and fixes the
  lightness so text holds 4.5:1 in both themes.
- Theme status tokens must pass WCAG AA on the page background *and* on a
  `bg-X/15` badge — enforced by `lib/themeTokens.test.ts`.
- Font sizes use the rem ramp (`text-2xs`, `text-xs`, …). Pixel sizes are
  rejected by `scripts/check-text-sizes.mjs`: they ignore the density setting,
  which scales the root font size.
- Focus rings are global (`:focus-visible` in `index.css`); never remove an
  outline without providing a replacement.

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
