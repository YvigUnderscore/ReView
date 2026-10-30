// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  IMAGE_DEFAULTS,
  IMAGE_LINE_RE,
  REFS_COLS,
  REFS_HEIGHT,
  formatImageOptions,
  parseImageOptions,
  parseNote,
  type ImageAlign,
  type NoteBlock,
  type NoteImage,
} from './noteMarkdown';

/**
 * The note as it is written: a sequence of blocks, not a page of syntax.
 *
 * An artist does not need to know that `::progress Animation 60` makes a gauge, nor that `##-` collapses a section. The
 * editor therefore handles typed blocks (a title, a text, a gauge, a board), and this module translates in both
 * directions with markdown, which remains the storage format. Nothing to migrate: notes already written open as they are,
 * and an exported note stays readable in any text editor.
 *
 * The list is **flat**: a section does not wrap its blocks, it precedes them, like a title in a document. This is exactly
 * what markdown says, and it makes moving a block trivial: dragging a block under another title changes its section without
 * any structure having to be re-stitched.
 *
 * Everything is pure: no function here touches the DOM or the network, which makes them testable one by one and guarantees
 * the only invariant that matters, namely that writing then rereading a note does not distort it.
 */

/**
 * What every block carries.
 *
 * `depth` records membership: `1` for a block filed in the collapsible section that precedes it, `0` for a block of the
 * note itself. A section therefore no longer swallows everything that follows it: it holds what was put in it, and a block
 * leaves it with a gesture to the left. On saving, this return to the root is written as `::endsection`.
 */
interface BlockBase {
  id: string;
  depth?: 0 | 1;
}

export interface HeadingBlock extends BlockBase {
  kind: 'heading';
  title: string;
  /** Expanded when the note is opened? */
  open: boolean;
}
/**
 * A title that does not collapse.
 *
 * Not every note needs a dropdown: a short brief is split into three subheadings that one wants to read at once. It is an
 * ordinary markdown `###`, so nothing new to store, and one more title in the reading flow.
 */
export interface TitleBlock extends BlockBase {
  kind: 'title';
  text: string;
}

export interface TextBlock extends BlockBase {
  kind: 'text';
  /** Plain markdown: bold, lists, links, tables. Never a directive. */
  source: string;
}
export interface ProgressEditBlock extends BlockBase {
  kind: 'progress';
  label: string;
  value: number;
}
export interface SmallEditBlock extends BlockBase {
  kind: 'small';
  text: string;
}
export interface GalleryBlock extends BlockBase {
  kind: 'gallery';
  images: NoteImage[];
  layout: 'carousel' | 'grid';
  cols: number;
  height: number;
}
export interface ImageEditBlock extends BlockBase {
  kind: 'image';
  src: string;
  alt: string;
  align: ImageAlign;
  width: number;
}
export interface DividerBlock extends BlockBase {
  kind: 'divider';
}

export type EditorBlock =
  | HeadingBlock
  | TitleBlock
  | TextBlock
  | ProgressEditBlock
  | SmallEditBlock
  | GalleryBlock
  | ImageEditBlock
  | DividerBlock;

export type EditorBlockKind = EditorBlock['kind'];

/**
 * Block identifiers.
 *
 * A counter, not a hash of the content: two empty text blocks are two blocks, and React as well as drag-and-drop need to
 * tell them apart. The counter never leaves the editing session: nothing is saved from it.
 */
let counter = 0;
export const nextBlockId = (): string => `b${++counter}`;

// ───────────────────────────── Markdown → blocks ─────────────────────────────

/** An ordinary subheading: the one that does not collapse. `####` and beyond remain text. */
const TITLE_LINE_RE = /^###\s+(.+)$/;

/**
 * Splits a block of markdown into editing blocks.
 *
 * `parseNote` stops at the markdown, which is enough to render it; editing goes further: a separator and an image placed
 * on its own are things one moves and adjusts, not text in the middle of a paragraph.
 */
function splitMarkdown(source: string): EditorBlock[] {
  const out: EditorBlock[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) out.push({ id: nextBlockId(), kind: 'text', source: text });
    buffer = [];
  };

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      out.push({ id: nextBlockId(), kind: 'divider' });
      continue;
    }
    const title = TITLE_LINE_RE.exec(trimmed);
    if (title) {
      flush();
      out.push({ id: nextBlockId(), kind: 'title', text: title[1].trim() });
      continue;
    }
    const image = IMAGE_LINE_RE.exec(trimmed);
    if (image) {
      flush();
      const options = parseImageOptions(image[3]);
      out.push({ id: nextBlockId(), kind: 'image', alt: image[1] ?? '', src: image[2] ?? '', ...options });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}

/** A render block becomes one or several editing blocks. */
function toEditor(block: NoteBlock): EditorBlock[] {
  switch (block.kind) {
    case 'markdown':
      return splitMarkdown(block.source);
    case 'progress':
      return [{ id: nextBlockId(), kind: 'progress', label: block.label, value: block.value }];
    case 'small':
      return [{ id: nextBlockId(), kind: 'small', text: block.text }];
    case 'refs':
      return [
        {
          id: nextBlockId(),
          kind: 'gallery',
          images: block.images,
          layout: block.layout ?? 'carousel',
          cols: block.cols ?? REFS_COLS.default,
          height: block.height ?? REFS_HEIGHT.default,
        },
      ];
    case 'section': {
      const section = block;
      return [
        { id: nextBlockId(), kind: 'heading', title: section.title, open: section.open },
        // What the section holds is filed inside it: this is what `depth` records.
        ...section.blocks.flatMap(toEditor).map((child) => ({ ...child, depth: 1 as const })),
      ];
    }
  }
}

/**
 * The saved note, opened for editing.
 *
 * Each block comes out with an **explicit** depth: `0` for what lives at the root, including after an `::endsection`,
 * and `1` for what a section holds. Leaving the depth undefined would drop those blocks back into the previous section on
 * the first save, and the section end just placed would have vanished.
 */
export function toEditorBlocks(source: string): EditorBlock[] {
  return parseNote(source)
    .flatMap(toEditor)
    .map((block) => ({ ...block, depth: block.depth ?? 0 }));
}

// ───────────────────────────── Blocks → markdown ─────────────────────────────

/**
 * The format's keywords.
 *
 * Named rather than interpolated into templates: these are the only places in the repository where a note's syntax is
 * written, and gathering them prevents a directive from changing here without changing there. The translation check also
 * gains: a template starting with text is indistinguishable from a sentence to translate, and it is right to distrust it.
 */
const DIRECTIVE = {
  progress: '::progress',
  small: '::small',
  refs: '::refs',
  end: '::end',
  grid: 'grid',
  open: '##',
  collapsed: '##-',
  title: '###',
  endSection: '::endsection',
  divider: '---',
} as const;

/** A board only writes what departs from the original carousel. */
function galleryHeader(block: GalleryBlock): string {
  if (block.layout !== 'grid') return DIRECTIVE.refs;
  return [DIRECTIVE.refs, DIRECTIVE.grid, `cols=${block.cols}`, `h=${block.height}`].join(' ');
}

function serializeBlock(block: EditorBlock): string {
  switch (block.kind) {
    case 'heading':
      return [block.open ? DIRECTIVE.open : DIRECTIVE.collapsed, block.title.trim()].join(' ');
    case 'title':
      return [DIRECTIVE.title, block.text.trim()].join(' ');
    case 'text':
      return block.source.trim();
    case 'progress':
      // The decimal comma is read back when rereading, but is written with a point: it is a number, not a text, and a
      // note travels between machines of different languages.
      return [DIRECTIVE.progress, block.label.trim(), Number(block.value.toFixed(1))].join(' ');
    case 'small':
      return [DIRECTIVE.small, block.text.trim()].join(' ');
    case 'gallery':
      return [
        galleryHeader(block),
        ...block.images.map((image) => `![${image.alt}](${image.src})`),
        DIRECTIVE.end,
      ].join('\n');
    case 'image': {
      const options = formatImageOptions({ align: block.align, width: block.width });
      return `![${block.alt}](${block.src}${options ? ` "${options}"` : ''})`;
    }
    case 'divider':
      return DIRECTIVE.divider;
  }
}

/**
 * The blocks, turned back into the note.
 *
 * Empty blocks disappear: one leaves one behind each time one hesitates, and saving an extra blank line on every pass would
 * eventually push the text away.
 *
 * The section close (`::endsection`) is written here, never maintained by hand: it is deduced from the depth of the blocks,
 * and appears only where something really leaves a section. A stray `::endsection` would read in an export as nonsense.
 */
export function fromEditorBlocks(blocks: EditorBlock[]): string {
  const kept = normalizeDepth(blocks.filter((block) => !isEmptyBlock(block)));
  const lines: string[] = [];
  let inside = false;

  for (const block of kept) {
    const depth = block.depth ?? 0;
    if (inside && depth === 0 && block.kind !== 'heading') lines.push(DIRECTIVE.endSection);
    if (block.kind === 'heading') inside = true;
    else if (depth === 0) inside = false;
    lines.push(serializeBlock(block));
  }
  return lines.join('\n\n').trim();
}

/** A block that has nothing to say: no text, no image, no title. */
export function isEmptyBlock(block: EditorBlock): boolean {
  switch (block.kind) {
    case 'heading':
      return block.title.trim() === '';
    case 'title':
      return block.text.trim() === '';
    case 'text':
      return block.source.trim() === '';
    case 'progress':
      return block.label.trim() === '';
    case 'small':
      return block.text.trim() === '';
    case 'gallery':
      return block.images.length === 0;
    case 'image':
      return block.src.trim() === '';
    case 'divider':
      return false;
  }
}

/**
 * Brings depths back to what makes sense.
 *
 * Two rules, and not one more: a section does not nest (a title is always at the root), and nothing can be "inside" a
 * section that was never opened. A block inherited from a move above the first title therefore returns to the root rather
 * than describing an impossible membership.
 */
export function normalizeDepth(blocks: EditorBlock[]): EditorBlock[] {
  let open = false;
  return blocks.map((block) => {
    if (block.kind === 'heading') {
      open = true;
      return { ...block, depth: 0 as const };
    }
    if (!open) return { ...block, depth: 0 as const };
    // Unstated depth = that of the context: a block written under a title belongs to it, which is what markdown means.
    // An explicit `0`, on the other hand, is a decision.
    return { ...block, depth: block.depth ?? (1 as const) };
  });
}

/** Can a block enter a section? Only if a title precedes it. */
export function canIndent(blocks: EditorBlock[], id: string): boolean {
  const index = blocks.findIndex((block) => block.id === id);
  if (index <= 0 || blocks[index].kind === 'heading') return false;
  return blocks.slice(0, index).some((block) => block.kind === 'heading');
}

/**
 * Moves a block into the section that precedes it, or out of it.
 *
 * This is the lateral gesture of drag-and-drop, and the ←/→ arrows on the keyboard. Nothing moves if the movement makes no
 * sense: taking out a block already at the root, or putting the first block of a note into a section that does not exist yet.
 */
export function setDepth(blocks: EditorBlock[], id: string, depth: 0 | 1): EditorBlock[] {
  const block = blocks.find((b) => b.id === id);
  if (!block || block.kind === 'heading') return blocks;
  if ((block.depth ?? 0) === depth) return blocks;
  if (depth === 1 && !canIndent(blocks, id)) return blocks;
  return blocks.map((b) => (b.id === id ? { ...b, depth } : b));
}

// ───────────────────────────── Operations ─────────────────────────────

/** A new block of the requested type, with the values one most often keeps. */
export function emptyBlock(kind: EditorBlockKind): EditorBlock {
  const id = nextBlockId();
  switch (kind) {
    case 'heading':
      return { id, kind, title: '', open: true };
    case 'title':
      return { id, kind, text: '' };
    case 'text':
      return { id, kind, source: '' };
    case 'progress':
      return { id, kind, label: '', value: 50 };
    case 'small':
      return { id, kind, text: '' };
    case 'gallery':
      return {
        id,
        kind,
        images: [],
        layout: 'grid',
        cols: REFS_COLS.default,
        height: REFS_HEIGHT.default,
      };
    case 'image':
      return { id, kind, src: '', alt: '', ...IMAGE_DEFAULTS };
    case 'divider':
      return { id, kind };
  }
}

/**
 * Inserts after the given position; `-1` places at the head.
 *
 * The new block **inherits its upper neighbour**: added right under a title, it enters the section; added under a section
 * block, it joins it. Without this, the first block added under a title would have fallen back to the root and closed the
 * section just opened.
 */
export function insertBlock(blocks: EditorBlock[], index: number, block: EditorBlock): EditorBlock[] {
  const above = index >= 0 ? blocks[index] : undefined;
  const depth = above?.kind === 'heading' ? (1 as const) : (above?.depth ?? 0);
  const next = [...blocks];
  next.splice(index + 1, 0, block.kind === 'heading' ? block : { ...block, depth });
  return next;
}

export function removeBlock(blocks: EditorBlock[], id: string): EditorBlock[] {
  return blocks.filter((block) => block.id !== id);
}

export function updateBlock(blocks: EditorBlock[], id: string, patch: Partial<EditorBlock>): EditorBlock[] {
  return blocks.map((block) => (block.id === id ? ({ ...block, ...patch } as EditorBlock) : block));
}

/**
 * Moves a block by one step.
 *
 * One step at a time rather than a target index: this is what the keyboard does, and drag-and-drop is expressed very well
 * with the same primitive applied several times.
 */
export function moveBlock(blocks: EditorBlock[], id: string, delta: number): EditorBlock[] {
  const from = blocks.findIndex((block) => block.id === id);
  if (from === -1) return blocks;
  const to = from + delta;
  if (to < 0 || to >= blocks.length) return blocks;
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Moves a block to a given position: this is the drag-and-drop gesture.
 *
 * The depth is recomputed behind it: a block moved above the first title can no longer claim to belong to a section, and
 * the screen must show it straight away.
 */
export function reorderBlocks(blocks: EditorBlock[], id: string, toIndex: number): EditorBlock[] {
  const from = blocks.findIndex((block) => block.id === id);
  if (from === -1 || toIndex < 0 || toIndex >= blocks.length) return blocks;
  const moved = moveBlock(blocks, id, toIndex - from);
  return moved === blocks ? blocks : normalizeDepth(moved);
}
