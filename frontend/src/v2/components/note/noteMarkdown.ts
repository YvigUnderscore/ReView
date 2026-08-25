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

export interface RefsBlock {
  kind: 'refs';
  images: { src: string; alt: string }[];
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
const REFS_OPEN_RE = /^::refs\s*$/i;
const REFS_CLOSE_RE = /^::end\s*$/i;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
/** `## Titre` déplie, `##- Titre` reste replié : le brief long s'ouvre là où on le laisse. */
const HEADING_RE = /^##(-)?\s+(.+)$/;

/** Le pourcentage tel qu'il s'affichera : borné, et la virgule décimale acceptée. */
function parsePercent(raw: string): number {
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Les images d'un bloc `::refs`, dans l'ordre où elles sont écrites. */
function collectImages(lines: string[]): { src: string; alt: string }[] {
  const out: { src: string; alt: string }[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(IMAGE_RE)) {
      out.push({ alt: match[1] ?? '', src: match[2] ?? '' });
    }
  }
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
  let refs: string[] | null = null;

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) current.push({ kind: 'markdown', source: text });
    buffer = [];
  };

  for (const line of lines) {
    // Un carrousel avale tout jusqu'à `::end`, y compris les lignes vides.
    if (refs !== null) {
      if (REFS_CLOSE_RE.test(line)) {
        current.push({ kind: 'refs', images: collectImages(refs) });
        refs = null;
      } else {
        refs.push(line);
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

    if (REFS_OPEN_RE.test(line)) {
      flush();
      refs = [];
      continue;
    }

    buffer.push(line);
  }

  // Un `::refs` jamais fermé rend tout de même ses images : perdre le contenu d'un brief
  // parce qu'une ligne manque serait le pire des choix.
  if (refs !== null) current.push({ kind: 'refs', images: collectImages(refs) });
  flush();
  return root;
}

/** Les directives insérables par la barre d'outils, et ce qu'elles écrivent. */
export const NOTE_SNIPPETS = {
  section: '\n## Titre\n\n',
  collapsed: '\n##- Titre replié\n\n',
  progress: '\n::progress Animation 50\n',
  small: '\n::small Précision\n',
  divider: '\n---\n\n',
  refs: '\n::refs\n![Référence](https://)\n::end\n\n',
} as const;

export type SnippetKind = keyof typeof NOTE_SNIPPETS;
