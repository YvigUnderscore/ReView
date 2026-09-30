// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey, Tr } from '../../i18n';

/**
 * Types et helpers purs de la page /docs (documentation produit).
 * Le manifest est généré par frontend/scripts/build-docs.mjs à partir de DOCUMENTATION/.
 *
 * La **recherche** n'est pas ici : elle vit dans `docsSearch`, partagée par le sommaire de
 * la page et la palette Ctrl+K — deux surfaces, un seul moteur.
 */

export interface DocsPage {
  path: string; // chemin relatif dans /docs (ex. "user-guide/review-video.md")
  title: string;
  summary: string; // sous-titre d'une ligne, rendu sous le titre et cherché par le filtre
  updated: string; // date ISO du « Updated: » de la page, '' si la page n'en porte pas
  /**
   * Titres de chapitre — la table des matières de la page, seul index de son **contenu**
   * (cf. `pageHeadings` dans `scripts/build-docs.mjs`). Facultatif : un manifest produit
   * par un build antérieur reste servable, la page se cherche alors par son titre seul.
   */
  headings?: string[];
}

export interface DocsSection {
  dir: string; // "" pour la racine (README)
  label: string;
  pages: DocsPage[];
}

export interface DocsManifest {
  generatedAt: string;
  sections: DocsSection[];
}

/**
 * Libellé traduit d'une section. Le manifest en porte un, dérivé du nom de dossier et donc
 * en anglais comme la documentation ; l'interface, elle, suit la langue du lecteur. Un
 * dossier inconnu garde le libellé du manifest.
 */
const SECTION_LABEL_KEY: Record<string, MessageKey> = {
  '': 'docs.sectionOverview',
  'getting-started': 'docs.sectionGettingStarted',
  'user-guide': 'docs.sectionUserGuide',
  'admin-guide': 'docs.sectionAdminGuide',
  api: 'docs.sectionApi',
  infrastructure: 'docs.sectionInfrastructure',
  development: 'docs.sectionDevelopment',
};

export function sectionLabel(section: Pick<DocsSection, 'dir' | 'label'>, t: Tr): string {
  const key: MessageKey | undefined = SECTION_LABEL_KEY[section.dir];
  return key ? t(key) : section.label;
}

/** Résout un href relatif de page markdown vers un chemin de doc ("a/b.md" + "../c/d.md" → "c/d.md"). */
export function resolveDocHref(currentPath: string, href: string): string {
  const [pathPart, hash] = href.split('#');
  const baseSegments = currentPath.split('/').slice(0, -1);
  for (const seg of pathPart.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') baseSegments.pop();
    else baseSegments.push(seg);
  }
  const resolved = baseSegments.join('/');
  return hash ? `${resolved}#${hash}` : resolved;
}

/** Href interne de doc = relatif (ni protocole, ni ancre seule, ni chemin absolu). */
export function isInternalDocHref(href: string): boolean {
  return !/^([a-z]+:|\/|#)/i.test(href);
}

/** La section qui contient une page — celle dont le panneau latéral doit rester ouvert. */
export function sectionOf(sections: DocsSection[], path: string): DocsSection | undefined {
  return sections.find((s) => s.pages.some((p) => p.path === path));
}

/** Page précédente et suivante dans l'ordre du sommaire, sections mises bout à bout. */
export function neighbours(sections: DocsSection[], path: string): { previous?: DocsPage; next?: DocsPage } {
  const flat = sections.flatMap((s) => s.pages);
  const i = flat.findIndex((p) => p.path === path);
  if (i === -1) return {};
  return { previous: flat[i - 1], next: flat[i + 1] };
}
