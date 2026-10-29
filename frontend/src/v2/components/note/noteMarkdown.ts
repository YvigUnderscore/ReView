// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An entity's note: markdown, plus four things it cannot express.
 *
 * A shot brief is not a document: it is a page one rereads every day, of which one only wants the part concerning the
 * moment. Hence the **collapsible titles**: each `##` opens a section that can be collapsed, and three directives, written
 * in plain words rather than invented syntax:
 *
 *   `::progress Animation 60`   a progress gauge, readable without reading it
 *   `::small Delivered 12 March` a sub-text, for what accompanies without counting
 *   `::refs … ::end`            a carousel of the images it contains
 *
 * The rest is ordinary markdown (`---` for a separator), rendered by the same engine as the documentation, and therefore
 * with the same guards against injection.
 *
 * The parsing is **pure**: it only produces described blocks, never HTML. This is what makes it testable, and what guarantees
 * that the server never has to sanitise anything: it stores text, and nothing else.
 */

export interface ProgressBlock {
  kind: 'progress';
  label: string;
  /** Percentage clamped to [0, 100]: beyond that, the gauge would lie about its own scale. */
  value: number;
}

export interface SmallBlock {
  kind: 'small';
  text: string;
}

export interface NoteImage {
  src: string;
  alt: string;
}

export interface RefsBlock {
  kind: 'refs';
  images: NoteImage[];
  /**
   * Board rather than carousel. **Absent** for notes already written, which only had the carousel: their rendering does
   * not move by a pixel.
   */
  layout?: 'grid';
  /** Columns of the board, 1 to 4: beyond that, a reference is nothing more than a stamp. */
  cols?: number;
  /** Height of a thumbnail, in pixels. */
  height?: number;
}

export interface MarkdownBlock {
  kind: 'markdown';
  /** Raw markdown, rendered by `docsRender`. */
  source: string;
}

export interface SectionBlock {
  kind: 'section';
  title: string;
  /** Open at first render? A bare `##` is; a `##-` (collapsed) is not. */
  open: boolean;
  blocks: NoteBlock[];
}

export type NoteBlock = ProgressBlock | SmallBlock | RefsBlock | MarkdownBlock | SectionBlock;

const PROGRESS_RE = /^::progress\s+(.*?)\s+(-?\d+(?:[.,]\d+)?)\s*%?\s*$/i;
const SMALL_RE = /^::small\s+(.*)$/i;
/** A bare `::refs` stays the carousel; the options that follow turn it into a board. */
const REFS_OPEN_RE = /^::refs(?:\s+(.*?))?\s*$/i;
const REFS_CLOSE_RE = /^::end\s*$/i;
/** The markdown title (`![a](src "…")`) carries the layout of a lone image. */
const IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g;
/** `## Title` expands, `##- Title` stays collapsed: a long brief opens where it was left. */
const HEADING_RE = /^##(-)?\s+(.+)$/;
/**
 * Explicit end of a section.
 *
 * Without it, a section runs until the next one and therefore swallows everything that follows, including what has no
 * business in it and that no gesture could take out. Notes written before carry none: their division does not move by a line.
 */
const SECTION_END_RE = /^::endsection\s*$/i;

/** The percentage as it will be displayed: clamped, with the decimal comma accepted. */
function parsePercent(raw: string): number {
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** The images of a `::refs` block, in the order they are written. */
function collectImages(lines: string[]): NoteImage[] {
  const out: NoteImage[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(IMAGE_RE)) {
      out.push({ alt: match[1] ?? '', src: match[2] ?? '' });
    }
  }
  return out;
}

/** Bounds of a board: beyond that, the thumbnail no longer shows anything of the reference. */
export const REFS_COLS = { min: 1, max: 4, default: 3 } as const;
export const REFS_HEIGHT = { min: 80, max: 600, default: 180 } as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Options written after `::refs`: `grid`, `cols=3`, `h=180`.
 *
 * An unknown or out-of-bounds option is ignored rather than refused: a note is reread months later, and nobody should lose
 * their board because a word changed.
 */
export function parseRefsOptions(raw: string): Pick<RefsBlock, 'layout' | 'cols' | 'height'> {
  const out: Pick<RefsBlock, 'layout' | 'cols' | 'height'> = {};
  for (const token of raw.trim().split(/\s+/)) {
    if (!token) continue;
    if (/^grid$/i.test(token)) out.layout = 'grid';
    const cols = /^cols=(\d+)$/i.exec(token);
    if (cols) out.cols = clamp(Number(cols[1]), REFS_COLS.min, REFS_COLS.max);
    const height = /^h=(\d+)$/i.exec(token);
    if (height) out.height = clamp(Number(height[1]), REFS_HEIGHT.min, REFS_HEIGHT.max);
  }
  // Setting the columns without saying "grid" still describes a board: the option has no meaning for a carousel, and
  // requiring the word would only have added one more mistake.
  if (out.cols !== undefined || out.height !== undefined) out.layout = 'grid';
  return out;
}

/**
 * Splits a note into blocks.
 *
 * Consecutive lines of markdown are grouped into a single block: rendering them line by line would break lists, tables and
 * code blocks, which by definition span several lines.
 */
export function parseNote(source: string): NoteBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const root: NoteBlock[] = [];
  /** The open section, or the root: every block is added to the top of this stack. */
  let current: NoteBlock[] = root;
  let buffer: string[] = [];
  /** The open reference block: its lines, and the layout read from `::refs`. */
  let refs: { lines: string[]; options: ReturnType<typeof parseRefsOptions> } | null = null;

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) current.push({ kind: 'markdown', source: text });
    buffer = [];
  };

  for (const line of lines) {
    // A reference block swallows everything up to `::end`, blank lines included.
    if (refs !== null) {
      if (REFS_CLOSE_RE.test(line)) {
        current.push({ kind: 'refs', images: collectImages(refs.lines), ...refs.options });
        refs = null;
      } else {
        refs.lines.push(line);
      }
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      const section: SectionBlock = {
        kind: 'section',
        title: heading[2].trim(),
        open: heading[1] !== '-',
        blocks: [],
      };
      // Sections do not nest: a `##` closes the previous one. A hierarchy of
      // dropdowns in a brief collapses faster than it can be read.
      root.push(section);
      current = section.blocks;
      continue;
    }

    if (SECTION_END_RE.test(line)) {
      flush();
      // Closing outside any section breaks nothing: we are already at the root.
      current = root;
      continue;
    }

    const progress = PROGRESS_RE.exec(line);
    if (progress) {
      flush();
      current.push({ kind: 'progress', label: progress[1].trim(), value: parsePercent(progress[2]) });
      continue;
    }

    const small = SMALL_RE.exec(line);
    if (small) {
      flush();
      current.push({ kind: 'small', text: small[1].trim() });
      continue;
    }

    const refsOpen = REFS_OPEN_RE.exec(line);
    if (refsOpen) {
      flush();
      refs = { lines: [], options: parseRefsOptions(refsOpen[1] ?? '') };
      continue;
    }

    buffer.push(line);
  }

  // A `::refs` never closed still renders its images: losing the content of a brief because a line is missing would be the worst choice.
  if (refs !== null) current.push({ kind: 'refs', images: collectImages(refs.lines), ...refs.options });
  flush();
  return root;
}

/**
 * Prefix of the images dropped into the note itself (mirror of `EntityNoteImageService`).
 *
 * What is written in the markdown is the storage **key**, never a URL: a presigned URL expires after one hour, and a brief
 * is reread six months later.
 */
export const NOTE_IMAGE_PREFIX = 'note-images/';

export const isNoteImageKey = (src: string): boolean => src.startsWith(NOTE_IMAGE_PREFIX);

/** The image keys carried by a note: what must be resolved in order to display it. */
export function noteImageKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(IMAGE_RE)) {
    const src = match[2] ?? '';
    if (isNoteImageKey(src)) keys.add(src);
  }
  return [...keys];
}

// ───────────────────────── Layout of a standalone image ─────────────────────────

/**
 * Where an isolated image is placed in the thread.
 *
 * Markdown cannot express it, but its **title** is a free field: `![a](src "align=left width=40")` remains standard markdown,
 * readable elsewhere, and degrades into a simple image for whoever ignores it. Inventing a `::image` directive would have
 * made the note unreadable outside ReView, for the sole pleasure of a clean syntax.
 */
export const IMAGE_ALIGNS = ['full', 'center', 'left', 'right'] as const;
export type ImageAlign = (typeof IMAGE_ALIGNS)[number];

export interface ImageOptions {
  align: ImageAlign;
  /** Width as a percentage of the text column. */
  width: number;
}

export const IMAGE_DEFAULTS: ImageOptions = { align: 'full', width: 100 };
export const IMAGE_WIDTH = { min: 10, max: 100 } as const;

/** A line carrying only an image: this is what makes it a block, rather than text. */
export const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)$/;

/** Reads `align=left width=40`; whatever is missing falls back to full width. */
export function parseImageOptions(raw: string | undefined): ImageOptions {
  const out = { ...IMAGE_DEFAULTS };
  for (const token of (raw ?? '').trim().split(/\s+/)) {
    const align = /^align=(\w+)$/i.exec(token);
    if (align && (IMAGE_ALIGNS as readonly string[]).includes(align[1].toLowerCase())) {
      out.align = align[1].toLowerCase() as ImageAlign;
    }
    const width = /^width=(\d+)$/i.exec(token);
    if (width) out.width = clamp(Number(width[1]), IMAGE_WIDTH.min, IMAGE_WIDTH.max);
  }
  return out;
}

/** The reverse: nothing to write for a full-width image, which is the usual case. */
export function formatImageOptions(options: ImageOptions): string {
  if (options.align === IMAGE_DEFAULTS.align && options.width === IMAGE_DEFAULTS.width) return '';
  return `align=${options.align} width=${Math.round(options.width)}`;
}
