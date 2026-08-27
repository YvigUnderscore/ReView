// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * La fiche d'une entité : du markdown, plus quatre choses qu'il ne sait pas dire.
 *
 * Un brief de plan n'est pas un document : c'est une page qu'on relit tous les jours, dont
 * on ne veut voir que la partie qui concerne le moment. D'où les **titres dépliables** —
 * chaque `##` ouvre une section qu'on replie — et trois directives, écrites en toutes
 * lettres plutôt qu'en syntaxe inventée :
 *
 *   `::progress Animation 60`   une jauge d'avancement, lisible sans la lire
 *   `::small Livré le 12 mars`  un sous-texte, pour ce qui accompagne sans compter
 *   `::refs … ::end`            un carrousel des images qu'il contient
 *
 * Le reste est du markdown ordinaire (`---` pour un séparateur), rendu par le même moteur
 * que la documentation — donc avec les mêmes garde-fous contre l'injection.
 *
 * L'analyse est **pure** : elle ne produit que des blocs décrits, jamais de HTML. C'est ce
 * qui la rend testable, et ce qui garantit que le serveur n'a jamais à assainir quoi que
 * ce soit — il stocke du texte, et rien d'autre.
 */

export interface ProgressBlock {
  kind: 'progress';
  label: string;
  /** Pourcentage borné à [0, 100] : au-delà, la jauge mentirait sur sa propre échelle. */
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
   * Planche plutôt que carrousel. **Absent** pour les fiches déjà écrites, qui n'avaient
   * que le carrousel : leur rendu ne bouge pas d'un pixel.
   */
  layout?: 'grid';
  /** Colonnes de la planche, 1 à 4 — au-delà, une référence n'est plus qu'un timbre. */
  cols?: number;
  /** Hauteur d'une vignette, en pixels. */
  height?: number;
}

export interface MarkdownBlock {
  kind: 'markdown';
  /** Markdown brut, rendu par `docsRender`. */
  source: string;
}

export interface SectionBlock {
  kind: 'section';
  title: string;
  /** Ouverte au premier rendu ? Un `##` seul l'est, un `##-` (replié) ne l'est pas. */
  open: boolean;
  blocks: NoteBlock[];
}

export type NoteBlock = ProgressBlock | SmallBlock | RefsBlock | MarkdownBlock | SectionBlock;

const PROGRESS_RE = /^::progress\s+(.*?)\s+(-?\d+(?:[.,]\d+)?)\s*%?\s*$/i;
const SMALL_RE = /^::small\s+(.*)$/i;
/** `::refs` seul reste le carrousel ; les options qui suivent en font une planche. */
const REFS_OPEN_RE = /^::refs(?:\s+(.*?))?\s*$/i;
const REFS_CLOSE_RE = /^::end\s*$/i;
/** Le titre markdown (`![a](src "…")`) porte la disposition d'une image seule. */
const IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g;
/** `## Titre` déplie, `##- Titre` reste replié : le brief long s'ouvre là où on le laisse. */
const HEADING_RE = /^##(-)?\s+(.+)$/;
/**
 * Fin explicite d'une section.
 *
 * Sans elle, une section court jusqu'à la suivante et avale donc tout ce qui la suit —
 * y compris ce qui n'a rien à y faire, et qu'aucun geste ne pouvait en sortir. Les fiches
 * écrites avant n'en portent pas : leur découpage ne bouge pas d'une ligne.
 */
const SECTION_END_RE = /^::endsection\s*$/i;

/** Le pourcentage tel qu'il s'affichera : borné, et la virgule décimale acceptée. */
function parsePercent(raw: string): number {
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Les images d'un bloc `::refs`, dans l'ordre où elles sont écrites. */
function collectImages(lines: string[]): NoteImage[] {
  const out: NoteImage[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(IMAGE_RE)) {
      out.push({ alt: match[1] ?? '', src: match[2] ?? '' });
    }
  }
  return out;
}

/** Bornes d'une planche : au-delà, la vignette ne montre plus rien de la référence. */
export const REFS_COLS = { min: 1, max: 4, default: 3 } as const;
export const REFS_HEIGHT = { min: 80, max: 600, default: 180 } as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Les options écrites après `::refs` : `grid`, `cols=3`, `h=180`.
 *
 * Une option inconnue ou hors bornes est ignorée plutôt que refusée — une fiche se relit
 * des mois plus tard, et personne ne doit perdre sa planche parce qu'un mot a changé.
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
  // Régler les colonnes sans dire « grid » décrit tout de même une planche : l'option n'a
  // aucun sens pour un carrousel, et exiger le mot n'aurait fait qu'une faute de plus.
  if (out.cols !== undefined || out.height !== undefined) out.layout = 'grid';
  return out;
}

/**
 * Découpe une fiche en blocs.
 *
 * Les lignes de markdown consécutives sont regroupées en un seul bloc : les rendre ligne à
 * ligne casserait les listes, les tableaux et les blocs de code, qui tiennent sur plusieurs
 * lignes par définition.
 */
export function parseNote(source: string): NoteBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const root: NoteBlock[] = [];
  /** La section ouverte, ou la racine : tout bloc s'ajoute au sommet de cette pile. */
  let current: NoteBlock[] = root;
  let buffer: string[] = [];
  /** Le bloc de références ouvert : ses lignes, et la disposition lue sur `::refs`. */
  let refs: { lines: string[]; options: ReturnType<typeof parseRefsOptions> } | null = null;

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) current.push({ kind: 'markdown', source: text });
    buffer = [];
  };

  for (const line of lines) {
    // Un bloc de références avale tout jusqu'à `::end`, y compris les lignes vides.
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
      // Les sections ne s'imbriquent pas : un `##` ferme la précédente. Une hiérarchie de
      // dépliants dans un brief se replie plus vite qu'elle ne se lit.
      root.push(section);
      current = section.blocks;
      continue;
    }

    if (SECTION_END_RE.test(line)) {
      flush();
      // Refermer hors de toute section ne casse rien : on est déjà à la racine.
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

  // Un `::refs` jamais fermé rend tout de même ses images : perdre le contenu d'un brief
  // parce qu'une ligne manque serait le pire des choix.
  if (refs !== null) current.push({ kind: 'refs', images: collectImages(refs.lines), ...refs.options });
  flush();
  return root;
}

/**
 * Préfixe des images déposées dans la fiche elle-même (miroir de `EntityNoteImageService`).
 *
 * Ce qui est écrit dans le markdown est la **clé** de stockage, jamais une URL : une URL
 * présignée expire en une heure, un brief se relit six mois plus tard.
 */
export const NOTE_IMAGE_PREFIX = 'note-images/';

export const isNoteImageKey = (src: string): boolean => src.startsWith(NOTE_IMAGE_PREFIX);

/** Les clés d'images portées par une fiche — ce qu'il faut faire résoudre pour l'afficher. */
export function noteImageKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(IMAGE_RE)) {
    const src = match[2] ?? '';
    if (isNoteImageKey(src)) keys.add(src);
  }
  return [...keys];
}

// ───────────────────────── Disposition d'une image seule ─────────────────────────

/**
 * Où se pose une image isolée dans le fil.
 *
 * Le markdown ne sait pas le dire, mais son **titre** est un champ libre : `![a](src
 * "align=left width=40")` reste du markdown standard, lisible ailleurs, et se dégrade en
 * simple image chez qui l'ignore. Inventer une directive `::image` aurait rendu la fiche
 * illisible hors de ReView pour le seul plaisir d'une syntaxe propre.
 */
export const IMAGE_ALIGNS = ['full', 'center', 'left', 'right'] as const;
export type ImageAlign = (typeof IMAGE_ALIGNS)[number];

export interface ImageOptions {
  align: ImageAlign;
  /** Largeur en pourcentage de la colonne de texte. */
  width: number;
}

export const IMAGE_DEFAULTS: ImageOptions = { align: 'full', width: 100 };
export const IMAGE_WIDTH = { min: 10, max: 100 } as const;

/** Une ligne qui ne porte qu'une image — c'est ce qui en fait un bloc, et non du texte. */
export const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)$/;

/** Lit `align=left width=40` ; ce qui manque retombe sur la pleine largeur. */
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

/** L'inverse : rien à écrire pour une image pleine largeur, qui est le cas courant. */
export function formatImageOptions(options: ImageOptions): string {
  if (options.align === IMAGE_DEFAULTS.align && options.width === IMAGE_DEFAULTS.width) return '';
  return `align=${options.align} width=${Math.round(options.width)}`;
}
