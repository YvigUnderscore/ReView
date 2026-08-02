// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Types et helpers purs de la page /docs (documentation produit).
 * Le manifest est généré par frontend/scripts/build-docs.mjs à partir de DOCUMENTATION/.
 */

export interface DocsPage {
  path: string; // chemin relatif dans /docs (ex. "user-guide/review-video.md")
  title: string;
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

/** Filtre les sections par sous-chaîne (titre ou chemin), sections vides retirées. */
export function filterSections(sections: DocsSection[], query: string): DocsSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map((s) => ({
      ...s,
      pages: s.pages.filter((p) => p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)),
    }))
    .filter((s) => s.pages.length > 0);
}
