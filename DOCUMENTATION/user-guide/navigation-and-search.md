# Navigation & search

> Updated: 2026-08-21

![The command palette (Ctrl/Cmd + K): search and navigation in one place.](../assets/user-guide/command-palette.png)

## Layout

- **Home** (`/`) — a personal dashboard of configurable widgets.
- **Projects** (`/projects`) and **Reviews** (`/reviews`) — global lists with filters.
- **Sidebar** — three things, in this order: where you go, what you are looking at, what
  you pinned. It can be collapsed.

The sidebar carries **Home**, **Projects**, **Reviews**, then the **project switcher**
and, once a project is in context, direct links to its sections — Sequences, Shots,
Assets, Playlists, Production, Kanban, Board. No expandable tree: the old one cost a
request per open sequence to show a list of codes. Below that come your **favourites**,
and at the bottom **Settings** (admins) and **Documentation**.

The sidebar has **no search field**. Search lives in the header.

## Search

### The header search button

At the top right of every page sits a wide button that looks like an input, with a
`Ctrl K` hint. It is a button: clicking it opens the command palette. On a narrow window
it shrinks to a magnifier icon so it does not eat the breadcrumb.

### The command palette

**Ctrl+K** (or **Cmd+K**) opens it; pressing the shortcut again closes it. It wins over
whatever has focus, including text inputs.

Typing searches **projects, sequences, shots, assets and tasks**, case-insensitively,
with at most **five results per type**. Sequences and shots match on their name *or*
their code; projects, assets and tasks match on name. Trashed entities are excluded, and
results respect your project memberships — admins and supervisors see everything.

There is **no prefix or filter syntax**: the text is sent as is. Input is debounced by
200 ms.

With the field **empty**, the palette shows two groups instead of results:

- **Go to** — Projects, plus Kanban and Board of the current project when there is one,
  plus Documentation.
- **Actions** — copy the current page link, refresh the data on screen, toggle the
  sidebar, toggle the theme, open the shortcut help.

Inside a review, the palette also lists the viewer's contextual commands, filtered as you
type.

### List search boxes

The **Shots**, **Assets**, **Kanban** and **Reviews** lists have their own filter bar with
a free-text field. That search is client-side over what is already loaded, and applies
instantly — it is a filter, not a query. See
[Projects & pipeline](projects-and-pipeline.md#filters-and-saved-views).

## Keyboard shortcuts

These are the shortcuts the application registers globally.

| Keys | Action |
|------|--------|
| **Ctrl / Cmd + K** | Open (or close) the command palette |
| **`g` then `p`** | Go to Projects |
| **`g` then `k`** | Kanban of the current project |
| **`g` then `b`** | Board of the current project |
| **`?`** | Open the shortcut help panel |
| **Escape** | Clear the current multi-selection |

Notes on the `g` sequences:

- the leader key is `g` and cannot be changed; you have **one second** to press the
  second key before the sequence is forgotten;
- `g k` and `g b` do nothing when no project is in context;
- shortcuts are inert while you are typing in a text field, and while a dialog is open.

**The second key of each shortcut is reconfigurable.** Open the help panel with `?`,
click a key in the **Navigation** section, and press the new one. A key already taken by
another shortcut of the same kind is refused, and `g` itself is never accepted. A small
revert arrow appears next to any key you have changed. The mapping is stored on your
account, so it follows you between machines.

The help panel also lists the contextual review shortcuts, which are handled by the
viewers and are not reconfigurable — transport (`Space`, `←`/`→`, `Shift+←/→`, `J`/`K`/`L`,
`I`/`O`, `M`), tools, and the splat editor's own set. See
[Review workspace](review-workspace.md) and [Review splat](review-splat.md).

## Right-click

Most cards — projects, shots, assets, sequences, versions, media, comments, playlist
items — expose their actions through a **context menu**. That is the primary way of
acting on an entity: the interface stays uncluttered and every action lives where the
thing is.

Right-clicking somewhere the application has nothing to offer opens **nothing at all**:
the browser's own menu is suppressed on purpose. Two escape hatches remain — **hold Shift
while right-clicking** to force the browser menu anywhere, and inside text fields,
text areas and editable zones the native menu always works, so copy and paste behave
normally.

The **Home** page is an exception: right-clicking its empty space offers *edit the
layout*, *add a widget*, *reset the layout* and *refresh the data*.

## Multi-selection

Lists that support it show a **checkbox** on each card, invisible until you hover or
select. Clicking the card body still navigates — selection is the checkbox's job.

| Gesture | Effect |
|---------|--------|
| Click a checkbox | Toggle that card |
| **Shift-click** a checkbox | Extend the range from the last anchor, in display order |
| **Ctrl / Cmd-click** | Same as a plain click — toggle |
| **Escape** | Clear the selection |

A floating **selection bar** appears at the bottom with the count and the available
actions.

| List | Selection bar actions |
|------|----------------------|
| **Reviews** | Add to playlist (admin/supervisor/artist), Delete |
| **Project → Assets** | Assign, Delete — managers only |
| **Projects** | Delete — managers only, on the *active* tab |
| **Project → Trash** | Restore, Delete |
| **Admin → Trash** | Purge |

The **Shots**, **Sequences** and **Kanban** lists have no multi-selection. Their bulk
operations go through the API.

Selection only covers what is displayed: a bulk action can never reach rows a filter has
hidden. There is no select-all keyboard shortcut; the two trash lists carry a header
checkbox for that.

## Favourites

Star any **project, sequence, shot or asset** to pin it in the sidebar. Two gestures:

- the **star button** in the header of a project, sequence, shot or asset page, and on
  sequence rows;
- **right-click a card → Pin / Unpin**, on cards that support it (projects, assets). A
  pinned card also shows a small star badge.

The sidebar lists them flat, without a heading, and the whole block disappears when you
have none.

## Recents

Recently visited entities are recorded **in your browser**, not on the server: the last
**five**, deduplicated, newest first. They are captured from the breadcrumb, so a page
without one records nothing, and the `live` parameter is stripped so a recent never drops
you back into a live session.

They are not shown in the sidebar. The Home page uses the most recent **media** entry for
a compact *resume* chip.

## Home widgets

Home is a 12-column grid of five widgets: **statistics**, **projects**, **my tasks**,
**latest reviews** and **activity**. Right-click the page background to enter edit mode,
add a widget you had hidden, reset the layout, or refresh the data.

In edit mode each widget can be resized (the allowed widths differ per widget), given a
height, a density and a variant (list, grid or KPI), or hidden. Widgets are reordered by
drag-and-drop. The layout is stored on your account.

## Use cases

### Getting to a shot you half-remember

You know it is `SH0120`, somewhere in the film.

Press **Ctrl+K**, type `0120`. The palette matches shot codes as well as names and shows
up to five per type. Enter opens it. No need to know which sequence it lives in, or which
project — the search spans everything you are a member of.

### Living on one project for a week

1. Open the project once. The sidebar switches to it and shows its sections as direct
   links.
2. Star it (the star next to the title). It is now pinned above the fold whatever page
   you are on.
3. Use `g k` for the kanban and `g b` for the board — both act on the project in context,
   so you never go back to the project page just to change screen.

### Rebinding a shortcut that clashes with your habits

Your other tools use `g t` for the board.

Press **`?`**, click the key shown next to *Board of the current project*, press `t`. The
change is saved to your account immediately. If `t` were already used by another `g`
shortcut the panel would refuse it and say so. The revert arrow next to the key restores
the default.

### Clearing forty trashed assets

1. Project → **Trash** tab.
2. Tick the header checkbox to select the page, or tick the first row and **Shift-click**
   the last.
3. The bar offers **Restore** and **Delete**. Deleting from the project trash is still
   recoverable by an admin; **Purge**, in *Admin → Trash*, is not.
4. **Escape** at any point drops the selection without touching anything.

## Related pages

- [Projects & pipeline](projects-and-pipeline.md) — filters, saved views, right-click
  status and assignment
- [Kanban & tasks](kanban-and-tasks.md)
- [Review workspace](review-workspace.md) — the viewer's own shortcuts
- [Personalization](personalization.md) — theme, language, notification preferences
