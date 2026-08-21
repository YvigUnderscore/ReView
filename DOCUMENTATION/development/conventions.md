# Conventions

> Updated: 2026-08-21

## Languages

- **Code comments and commit messages: French.**
- **UI text never hardcoded**: everything goes through `t()` with English-first
  catalogs (14 languages — see [Internationalisation](i18n.md)).
- **This documentation: English.**
- Commits use prefixes `feat:` / `fix:` / `refactor:` / `chore:` / `docs:` /
  `test:`, on the single `dev` branch.

A commit message states the problem before the solution, because the diff already shows
the solution:

```
fix(shotgrid): réparer la synchronisation des statuts de bout en bout

- runSync jetait toute demande arrivée pendant qu'une passe tournait, en la
  déclarant réussie. Les demandes sont désormais fusionnées et rejouées.
- conflictPolicy n'était lu nulle part : « ReView gagne » se comportait comme
  « ShotGrid gagne ».
```

## Licensing

Every new source file carries the SPDX header. Do not type it by hand — run the generator,
which is idempotent and covers `.ts`, `.tsx`, `.js`, `.mjs`, `.prisma`, `.py`, `.sh` and
`.css`:

```bash
node scripts/add-license-headers.mjs
```

```ts
// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later
```

A new dependency must be AGPL-compatible and is followed by
`node scripts/generate-notices.mjs`, which refuses anything outside the allow-list. Both
checks run first in `validate.sh`. Details: [Licensing](licensing.md).

## Frontend

- **TypeScript strict**; no unjustified `any`; ESLint + Prettier must be clean
  (zero warnings).
- **Theme tokens only** for colors (`bg-primary`, `text-muted-foreground`…) —
  never raw Tailwind palette classes. `scripts/check-color-tokens.mjs` rejects
  `bg-blue-500` and friends.
- Reusable primitives live in `src/v2/components/ui/`; no hand-rolled overlays.
- Never define a component inside another component's render.
- **Simple UI rule**: a new action goes to the right-click context menu, the
  Ctrl+K palette, a contextual HUD or a shortcut first — a visible button is the
  last resort.

### Data fetching

Fetching in a `useEffect` is not allowed. Every read is a TanStack Query hook keyed from
`qk` (`lib/query.ts`), and every mutation invalidates the keys it touched **and** gives
feedback:

```tsx
const qc = useQueryClient();
const setStatus = useMutation({
  mutationFn: (body: StatusPatch) => api.patch(`/api/shots/${id}`, body),
  onSuccess: async () => {
    await qc.invalidateQueries({ queryKey: qk.project(projectId) });
    toast.success(t('status.updated'));
  },
});
```

Keys are hierarchical on purpose: invalidating `qk.project(id)` also invalidates
`qk.projectActivity(id)`, `qk.projectSettings(id)` and the rest of that subtree.

Server-pushed changes go the same way. Routes emit with `emitToProject`, and
`lib/socketBridge.ts` translates each socket event into targeted invalidations — an
invalidation only refetches queries that are currently mounted, so screens that do not
display the entity pay nothing. **A backend write that users watch live must emit its
event, and the bridge must listen for it**: several kinds of update reached the database
but never reached an open screen because one half of that pair was missing.

### Layout

- Pages render `PageShell`, never the `Shell` itself: `Shell` is a router layout
  mounted once for every authenticated route, and pages live in its `<Outlet/>`.
  Titles and breadcrumbs are portalled into the top bar.
- `PageShell` takes a `width`: `default` (centred, max 1600 px — all data pages),
  `fluid` (full width, same gutter — kanban, board) or `flush` (no gutter, full
  space — review, timeline player). The gutter belongs to the container, not to
  `<main>`.
- Page headers use `PageHeader` (`components/ui/page.tsx`), which wraps title and actions
  onto separate lines instead of squeezing them.
- Supported window widths: **900 px to 3440 px**. Below 1100 px
  (`NARROW_WIDTH_QUERY` in `lib/useMediaQuery.ts`) the sidebar collapses on its own and
  overlays the content when reopened.
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

A menu is a value, so its shape is unit-testable without a DOM:

```ts
const entries: MenuEntry[] = [
  { id: 'open', label: t('entity.open'), onSelect: open },
  separator('status'),
  {
    kind: 'submenu',
    id: 'status',
    label: t('status.title'),
    // A radio group, not a list of actions: the current status is *ticked*,
    // instead of being guessed from the colour of a dot.
    items: [{ kind: 'radiogroup', id: 'status', value: current, onValueChange: setStatus, items }],
  },
];
```

`tidyMenu` runs before rendering: it drops empty submenus and removes leading, trailing and
duplicated separators, so a menu whose actions are half hidden by permissions does not show
lines in the void. It handles radio groups *before* the separator branch — the **Status**
submenu contains nothing else, and counting a group as "not an entry" would throw away a
submenu that is in fact full.

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

A route reads like a declaration, not like a program:

```ts
const bodySchema = z.object({ name: z.string().min(1).max(60) });

router.post(
  '/projects/:projectId/departments',
  authenticate,
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: projectParam, body: bodySchema }),
  async (req, res) => {
    res.status(201).json({
      department: await DepartmentService.create(Number(req.params.projectId), req.body),
    });
  },
);
```

Three traps that have each cost a bug:

- **A router mounted on `/api` must never call `router.use(authenticate)`.** Express runs
  it for every request crossing the mount point, public routes included — client shares
  answered `401` instead of serving the page. Apply authentication route by route.
- **Never widen a permission by merging defaults.** When a client sends only the section it
  changed, merge one level deep from the *normalised* current value. A flat merge re-parses
  the untouched sections with their schema defaults, and defaults are usually permissive.
- **A fallback fails closed.** If configuration cannot be parsed, fall back to the
  restrictive shape, never to the schema defaults.

### Naming and side effects

- Services export named functions, not classes, unless they hold state.
- A function that queues work is named `enqueue*` and never throws into the caller's path:
  a remote system being down must not fail a local action.
- A pure rule worth testing gets its own module — `arbitrate(policy)`,
  `statusPatch(code, statuses)`, `mergeSyncOptions(a, b)` are all one-line decisions
  extracted so the decision itself has a test.

## Testing

- New code ships with tests (vitest backend + frontend happy-dom, colocated).
- Never comment out, skip or delete a test to get the suite green.
- Prefer testing the pure module over the component: `statusMenu.test.ts` covers what the
  menu offers and what it PATCHes; the hook that renders it needs no DOM assertions.

## Related pages

- [Validation & tests](validation-and-tests.md)
- [Code structure](code-structure.md)
- [Internationalisation](i18n.md)
- [Licensing](licensing.md)
