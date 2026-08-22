# Accessibility

> Updated: 2026-08-22

ReView aims at WCAG 2.1 level AA. This page states what is **guaranteed**, what is
**measured by the validation suite**, and what is **still missing** — in that order,
because a conformance claim is only worth the tests behind it.

The target audience is a studio workstation: desktop browsers, keyboard and mouse, long
sessions in a dark room. That shapes the priorities (contrast, focus, text size) but does
not remove any obligation.

## What is guaranteed

| Area | Guarantee |
|------|-----------|
| Zoom | The page can be zoomed and reflowed. The viewport meta tag sets `width=device-width, initial-scale=1.0` and nothing else (WCAG 1.4.4). |
| Text contrast | `--foreground` and `--muted-foreground` hold at least 4.5:1 on `--background` in both themes. Status hues (success, warning, info, destructive, accent-2) hold 4.5:1 on their `/15` badge as well as on the page (WCAG 1.4.3). |
| Control boundaries | `--input`, the border of every text field and select, holds at least 3:1 against `--background`, `--card`, `--popover`, `--secondary` and `--muted` (WCAG 1.4.11). `--border` is decoration only — separators, card edges — and is deliberately not held to that threshold. |
| Text size | The type ramp is expressed in `rem` and bottoms out at `0.6875rem` (11 px). The compact density lowers the root font size to 15 px, so the smallest text on screen is 10.3 px — never below 10. |
| Keyboard focus | A global `:focus-visible` outline is drawn from `--ring` on every focusable element. Primitives that draw their own ring disable it, so there is never a double ring. |
| Dialogs | Every modal goes through the Radix primitive (`components/ui/dialog.tsx`): portal, focus trap, `Escape`, `aria-labelledby` from the title. No hand-rolled overlay. |
| Motion | `prefers-reduced-motion: reduce` sets `--duration-fast` to `0ms`, which removes the colour and layout transitions built on it. |
| Images | Every `<img>` carries an `alt`; decorative icons are `aria-hidden`. |
| Language | `<html lang>` and `dir` follow the reader's language, set by `applyDocumentLocale()`. |
| Error messages | API errors are translated by their code, so a screen reader announces them in the reader's language rather than in English (see [i18n](i18n.md)). |

## What the validation suite measures

These run in `scripts/validate.sh`; a regression fails the build rather than waiting for
an audit.

| Check | What it enforces |
|-------|------------------|
| `frontend/src/theme.a11y.test.ts` | Recomputes the contrast ratios above from `src/index.css` (both themes), the typographic floor in both densities, and the absence of `user-scalable=no` / `maximum-scale` in `index.html`. |
| `frontend/src/a11y.names.test.ts` | Counts input, select and textarea elements with **no** name source (`aria-label`, `aria-labelledby`, `id`, `title`, `placeholder`, an enclosing label, or props forwarded by a primitive) and fails if the count rises. Hidden file pickers and `type="hidden"` are excluded: `display: none` removes them from the accessibility tree. |
| `scripts/check-color-tokens.mjs` | No raw Tailwind palette class and no arbitrary colour — every colour comes from a theme token, which is what makes the contrast measurement meaningful. |
| `scripts/check-text-sizes.mjs` | No font size in pixels: a `text-[10px]` would ignore the density setting and escape the floor. |
| `eslint-plugin-jsx-a11y` (recommended, as errors) | Roles, `alt`, keyboard handlers on interactive elements, label association when a label exists. |
| `scripts/check-untranslated.mjs` | No hard-coded UI string, including strings returned by label functions and label tables — a screen reader must not read French out of a Japanese page. |

## What is still missing

- **24 form controls have no accessible name**, all in administration and ShotGrid
  panels (`SgSettingsPanel`, `SgStepsPanel`, `SgSyncPanel`, `SgDiffPanel`, `MembersTab`,
  `ShotAssets`, `ProjectActivity`, `ProjectSettingsTab`, `CommentItem`, `ColorPicker`,
  `TaskPickerDialog`, `MontagePanels`, `SmtpTab`, `LoginAppearanceTab`). They are counted
  and capped by `a11y.names.test.ts`; the cap only ever goes down.
- **`jsx-a11y/control-has-associated-label` is not enabled** (it belongs to the strict
  preset). The test above stands in for it until the remaining controls are named.
- **No right-to-left language is shipped.** The mechanism exists (`dir` on `<html>`, a
  `dir` field per locale) but the code uses physical spacing utilities (`ml-`, `pr-`,
  `text-left`) rather than logical ones (`ms-`, `pe-`, `text-start`), so enabling an RTL
  language would need a sweep first.
- **Touch pinch-zoom over 3D, splat and board canvases has not been re-verified** since
  the viewport was unlocked. If a canvas turns out to swallow or fight the browser
  gesture, the fix belongs on that canvas (`touch-action`), never back on the viewport.
- **No screen-reader pass** has been run on the review viewers (timeline scrubbing,
  annotation tools, the 3D gizmo). The static checks say nothing about them.
- **No documented keyboard path** for the drag-only interactions: the curve editor
  handles, the wipe divider, and the numeric field's drag-to-scrub (the field does accept
  typed input, which is the accessible path).

## Reporting a problem

Accessibility defects are ordinary bugs: open an issue with the page, the assistive
technology and its version, and what you expected to hear or see. Fixes to this page are
welcome too — see [CONTRIBUTING](../../CONTRIBUTING.md).

## Related pages

- [Internationalisation](i18n.md) — how a message reaches the screen in the reader's language
- [Validation and tests](validation-and-tests.md) — the full suite and how to run it
- [Conventions](conventions.md) — theme tokens, UI primitives, component budgets
