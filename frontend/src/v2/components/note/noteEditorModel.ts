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
 * La fiche telle qu'on l'écrit : une suite de blocs, pas une page de syntaxe.
 *
 * Un artiste n'a pas à savoir que `::progress Animation 60` fait une jauge, ni que `##-`
 * replie une section. L'éditeur manipule donc des blocs typés — un titre, un texte, une
 * jauge, une planche — et ce module fait la traduction dans les deux sens avec le markdown
 * qui reste, lui, le format de stockage. Rien à migrer, les briefs déjà écrits s'ouvrent
 * tels quels, et une fiche exportée reste lisible dans n'importe quel éditeur de texte.
 *
 * La liste est **plate** : une section n'enveloppe pas ses blocs, elle les précède, comme
 * un titre dans un document. C'est exactement ce que dit le markdown, et cela rend le
 * déplacement d'un bloc trivial — glisser un bloc sous un autre titre le change de section
 * sans qu'aucune structure n'ait à être recousue.
 *
 * Tout est pur : aucune fonction d'ici ne touche au DOM ni au réseau, ce qui les rend
 * testables une par une et garantit le seul invariant qui compte — écrire puis relire une
 * fiche ne la déforme pas.
 */

/**
 * Ce que tout bloc porte.
 *
 * `depth` dit l'appartenance : `1` pour un bloc rangé dans la section dépliable qui le
 * précède, `0` pour un bloc de la fiche elle-même. Une section n'avale donc plus tout ce
 * qui la suit — elle tient ce qu'on y a mis, et un bloc s'en sort d'un geste vers la
 * gauche. À l'enregistrement, ce retour à la racine s'écrit `::endsection`.
 */
interface BlockBase {
  id: string;
  depth?: 0 | 1;
}

export interface HeadingBlock extends BlockBase {
  kind: 'heading';
  title: string;
  /** Dépliée à l'ouverture de la fiche ? */
  open: boolean;
}
/**
 * Un titre qui ne se replie pas.
 *
 * Toutes les fiches n'ont pas besoin d'un dépliant : un brief court se découpe en trois
 * intertitres qu'on veut lire d'un coup. C'est un `###` de markdown ordinaire — donc rien de
 * nouveau à stocker, et un titre de plus dans le fil de lecture.
 */
export interface TitleBlock extends BlockBase {
  kind: 'title';
  text: string;
}

export interface TextBlock extends BlockBase {
  kind: 'text';
  /** Markdown courant : gras, listes, liens, tableaux. Jamais de directive. */
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
 * Identifiants de blocs.
 *
 * Un compteur, pas un hachage du contenu : deux blocs de texte vides sont deux blocs, et
 * React comme le glisser-déposer ont besoin de les distinguer. Le compteur ne sort jamais
 * de la session d'édition — rien n'en est enregistré.
 */
let counter = 0;
export const nextBlockId = (): string => `b${++counter}`;

// ───────────────────────────── Markdown → blocs ─────────────────────────────

/** Un intertitre ordinaire — celui qui ne se replie pas. `####` et au-delà restent du texte. */
const TITLE_LINE_RE = /^###\s+(.+)$/;

/**
 * Découpe un bloc de markdown en blocs d'édition.
 *
 * `parseNote` s'arrête au markdown, ce qui suffit à le rendre ; l'édition va plus loin —
 * un séparateur et une image posée seule sont des choses qu'on déplace et qu'on règle, pas
 * du texte au milieu d'un paragraphe.
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

/** Un bloc de rendu devient un ou plusieurs blocs d'édition. */
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
        // Ce que la section tient est rangé dedans : c'est ce que `depth` retient.
        ...section.blocks.flatMap(toEditor).map((child) => ({ ...child, depth: 1 as const })),
      ];
    }
  }
}

/**
 * La fiche enregistrée, ouverte à l'édition.
 *
 * Chaque bloc ressort avec une profondeur **explicite** : `0` pour ce qui vit à la racine —
 * y compris après un `::endsection` — et `1` pour ce qu'une section tient. Laisser la
 * profondeur indéfinie ferait retomber ces blocs-là dans la section précédente au premier
 * enregistrement, et la fin de section qu'on venait de poser aurait disparu.
 */
export function toEditorBlocks(source: string): EditorBlock[] {
  return parseNote(source)
    .flatMap(toEditor)
    .map((block) => ({ ...block, depth: block.depth ?? 0 }));
}

// ───────────────────────────── Blocs → markdown ─────────────────────────────

/**
 * Les mots-clés du format.
 *
 * Nommés plutôt qu'interpolés dans des gabarits : ce sont les seuls endroits du dépôt où la
 * syntaxe d'une fiche s'écrit, et les rassembler évite qu'une directive change ici sans
 * changer là. Le contrôle de traduction y gagne aussi — un gabarit qui commence par du texte
 * lui est indiscernable d'une phrase à traduire, et il a raison de s'en méfier.
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

/** Une planche n'écrit que ce qui s'écarte du carrousel d'origine. */
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
      // La virgule décimale se lit à la relecture, mais s'écrit avec un point : c'est un
      // nombre, pas un texte, et une fiche voyage entre des machines de langues différentes.
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
 * Les blocs, redevenus la fiche.
 *
 * Les blocs vides disparaissent : on en laisse un derrière soi chaque fois qu'on hésite, et
 * enregistrer une ligne vide de plus à chaque passage finirait par écarter le texte.
 *
 * La fermeture de section (`::endsection`) est écrite ici, jamais tenue à la main : elle se
 * déduit de la profondeur des blocs, et n'apparaît que là où quelque chose sort réellement
 * d'une section — un `::endsection` en trop se lirait dans un export sans rien vouloir dire.
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

/** Un bloc qui n'a rien à dire — ni texte, ni image, ni titre. */
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
 * Ramène les profondeurs à ce qui a un sens.
 *
 * Deux règles, et pas une de plus : une section ne s'imbrique pas (un titre est toujours à
 * la racine), et rien ne peut être « dans » une section qui n'a pas été ouverte — un bloc
 * hérité d'un déplacement au-dessus du premier titre revient donc à la racine plutôt que de
 * décrire une appartenance impossible.
 */
export function normalizeDepth(blocks: EditorBlock[]): EditorBlock[] {
  let open = false;
  return blocks.map((block) => {
    if (block.kind === 'heading') {
      open = true;
      return { ...block, depth: 0 as const };
    }
    if (!open) return { ...block, depth: 0 as const };
    // Profondeur non dite = celle du contexte : un bloc écrit sous un titre lui appartient,
    // c'est ce que veut dire le markdown. Un `0` explicite, lui, est une décision.
    return { ...block, depth: block.depth ?? (1 as const) };
  });
}

/** Un bloc peut-il entrer dans une section ? Seulement si un titre le précède. */
export function canIndent(blocks: EditorBlock[], id: string): boolean {
  const index = blocks.findIndex((block) => block.id === id);
  if (index <= 0 || blocks[index].kind === 'heading') return false;
  return blocks.slice(0, index).some((block) => block.kind === 'heading');
}

/**
 * Fait entrer un bloc dans la section qui le précède, ou l'en sort.
 *
 * C'est le geste latéral du glisser-déposer, et les flèches ←/→ au clavier. Rien ne bouge
 * si le mouvement n'a pas de sens : sortir un bloc déjà à la racine, ou faire entrer le
 * premier bloc d'une fiche dans une section qui n'existe pas encore.
 */
export function setDepth(blocks: EditorBlock[], id: string, depth: 0 | 1): EditorBlock[] {
  const block = blocks.find((b) => b.id === id);
  if (!block || block.kind === 'heading') return blocks;
  if ((block.depth ?? 0) === depth) return blocks;
  if (depth === 1 && !canIndent(blocks, id)) return blocks;
  return blocks.map((b) => (b.id === id ? { ...b, depth } : b));
}

// ───────────────────────────── Manipulations ─────────────────────────────

/** Un bloc neuf du type demandé, avec les valeurs qu'on garde le plus souvent. */
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
 * Insère après la position donnée ; `-1` place en tête.
 *
 * Le bloc neuf **hérite de son voisin du dessus** : ajouté juste sous un titre, il entre
 * dans la section ; ajouté sous un bloc de section, il la rejoint. Sans cela, le premier
 * bloc ajouté sous un titre serait retombé à la racine et aurait refermé la section aussitôt
 * ouverte.
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
 * Déplace un bloc d'un cran.
 *
 * Un cran à la fois plutôt qu'un index d'arrivée : c'est ce que fait le clavier, et le
 * glisser-déposer s'exprime très bien avec la même primitive appliquée plusieurs fois.
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
 * Déplace un bloc à une position donnée — c'est le geste du glisser-déposer.
 *
 * La profondeur est recalculée derrière : un bloc emmené au-dessus du premier titre ne peut
 * plus prétendre appartenir à une section, et l'écran doit le montrer tout de suite.
 */
export function reorderBlocks(blocks: EditorBlock[], id: string, toIndex: number): EditorBlock[] {
  const from = blocks.findIndex((block) => block.id === id);
  if (from === -1 || toIndex < 0 || toIndex >= blocks.length) return blocks;
  const moved = moveBlock(blocks, id, toIndex - from);
  return moved === blocks ? blocks : normalizeDepth(moved);
}
