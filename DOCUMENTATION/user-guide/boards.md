# Boards

> Updated: 2026-08-21

Each **project** and each **asset** has a 2D board powered by **Excalidraw** — a free-form
canvas for moodboards, references, briefs and sketches. There is exactly one board per
project and one per asset; sequences and shots do not have one.

## Access

| Board | URL | Ways in |
|-------|-----|---------|
| Project board | `/projects/:id/board` | Project header **Board** button, sidebar **Board** link, command palette, shortcut **`g` then `b`** |
| Asset board | `/assets/:id/board` | The **Board** button in the asset page header |

The board fills the page: a thin ReView strip on top — **Media library** toggle, a save
indicator, a **Back** link — and the Excalidraw canvas below.

## Drawing and saving

Everything in the canvas is stock Excalidraw: freehand drawing, shapes, arrows, text,
sticky-note layouts, its own toolbar, its own context menu, its own export options.

**There is no save button.** The board saves itself **1.2 seconds after you stop
changing it**, and the strip says `… saving` then `✓ saved`. The scene is stored on the
server, so it follows you between machines and is shared with the whole team.

Two things are worth knowing about that model:

- **Editing is last-write-wins and not live.** Two people on the same board at the same
  time will overwrite each other, and neither sees the other's strokes appear. A second
  viewer picks up the current state on the next page load. Boards are a place to leave
  material, not a co-drawing surface — use a [live review session](playlists-and-live-review.md)
  when you need to be on the same screen at the same time.
- **The board loads fresh every time**, deliberately: Excalidraw reads its content once,
  at mount, so serving a cached board would silently show stale work.

## Putting images on a board

Two routes.

- **Drag and drop, or paste**, files straight onto the canvas — Excalidraw's own
  handling. The images are embedded **inside the board's scene**, not uploaded as project
  media.
- **Media library** — the button on the left of the strip opens a side panel listing the
  project's **published images** (`IMAGE` media only). Click a thumbnail and it is
  inserted on the canvas at a fixed size, ready to move and scale. On an asset board the
  project is resolved from the asset, so the panel shows the same library.

You cannot drag a ReView version, media card or shot onto a board: the media library
panel is the only bridge from the project's content into the canvas.

> **Keep boards light.** Images live inside the board document as embedded data, and the
> whole document travels in a single request capped at **2 MB**. A board loaded with
> full-resolution references will eventually stop saving. Insert from the media library
> (thumbnails and published images) rather than dropping raw plates, and split a
> moodboard that has grown too big between the project board and the asset boards.

## Who can do what

- **Reading** requires access to the project — admins and supervisors globally, everyone
  else through project membership.
- **Writing** is refused for `CLIENT` accounts: they can open the board and move things
  on screen, but the save is rejected by the server and the strip reports the error.
- Everyone else with project access can edit.

## Use cases

### Briefing a new asset

The modelling lead needs a reference sheet for a hero prop.

1. Open the asset → **Board**.
2. **Media library** → insert the published concept images that already live in the
   project. They come in as real images, at a workable size.
3. Drop the client's PDF exports and photos alongside them, draw arrows and write the
   notes that matter — silhouette, scale, materials.
4. Nothing to save. Anyone opening the asset finds the same board.

The board is attached to the asset, so it stays reachable from the entity itself rather
than from a folder somebody has to remember.

### Sketching a sequence layout before the shots exist

Use the **project** board: `g` then `b` from anywhere in the project. Block out the
sequence as boxes, name them with the shot codes you are about to generate, then create
the shots for real with the batch generator on the Shots tab (see
[Projects & pipeline](projects-and-pipeline.md#creating-sequences-and-shots-in-bulk)).

### Working on a board with someone else

Do not — not simultaneously. The board has no live cursors and no merge: whoever saves
last wins the whole document.

Agree who holds it, or split the work across the project board and the asset boards. If
you need to look at something together, open a **live review session** on the media
instead.

### Getting a board out of ReView

Use Excalidraw's own menu inside the canvas: it exports to PNG, SVG and `.excalidraw`.
ReView adds no export of its own, and no import — a `.excalidraw` file dropped on the
canvas is handled by Excalidraw directly.

## Related pages

- [Navigation & search](navigation-and-search.md) — shortcuts and the sidebar
- [Projects & pipeline](projects-and-pipeline.md)
- [Kanban & tasks](kanban-and-tasks.md)
- [Playlists & live review](playlists-and-live-review.md) — for looking at something
  together, in real time
