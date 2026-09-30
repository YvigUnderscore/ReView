// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fold } from '../../components/settings/settingsFilter';
import type { DocsPage, DocsSection } from './docsManifest';

/**
 * Le moteur de recherche de la documentation — **un seul**, pour les deux surfaces qui la
 * cherchent.
 *
 * Elles ne cherchaient pas la même chose. La palette Ctrl+K exploitait les titres de
 * chapitre du manifest (sa table des matières) ; le filtre du sommaire de `/docs`, lui, ne
 * regardait que le titre, le sous-titre et le chemin de la page. Taper « watermark » dans
 * la page de documentation ne rendait donc rien, alors que la palette ouvrait la bonne page
 * sur le bon chapitre : deux réponses contradictoires à la même question, dans le même
 * produit. Les deux passent désormais par les fonctions ci-dessous.
 *
 * Trois règles communes :
 *   - **casse et accents ignorés** des deux côtés (`fold`), comme pour les réglages ;
 *   - **tous les mots exigés** : « watermark client » ne rend pas la moitié du manuel ;
 *   - le **chapitre trouvé est rendu avec le résultat** — c'est la raison de la
 *     correspondance, et ce qui permet d'ouvrir la page au bon endroit.
 */

/**
 * Qualité d'une correspondance, du plus net au plus vague. Même raisonnement que
 * `lib/searchRank` côté serveur : le titre identifie, le chapitre situe, le chemin de
 * fichier ne fait qu'attester.
 */
export const DOC_SCORE = { title: 40, summary: 30, heading: 20, path: 10, words: 1 } as const;

/** Les mots d'une recherche, repliés. Liste vide = pas de recherche, tout passe. */
export function docWords(query: string): string[] {
  const needle = fold(query.trim());
  return needle ? needle.split(/\s+/) : [];
}

/** Tout ce par quoi une page peut être trouvée : titre, sous-titre, chemin, chapitres. */
export function docHaystack(page: DocsPage): string {
  return fold([page.title, page.summary, page.path, ...(page.headings ?? [])].join(' '));
}

/** La page répond-elle ? Tous les mots doivent être présents, où que ce soit dans la page. */
export function docMatches(page: DocsPage, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = docHaystack(page);
  return words.every((word) => hay.includes(word));
}

/**
 * Chapitres de la page qui portent la recherche — ce qu'on affiche sous le résultat pour
 * dire *pourquoi* la page correspond, et ce sur quoi on l'ouvre.
 *
 * Un seul mot suffit ici, là où `docMatches` les exige tous : la page a déjà répondu, on
 * cherche maintenant par où y entrer.
 */
export function matchingHeadings(page: DocsPage, words: string[], limit = 3): string[] {
  if (words.length === 0) return [];
  return (page.headings ?? [])
    .filter((heading) => {
      const folded = fold(heading);
      return words.some((word) => folded.includes(word));
    })
    .slice(0, limit);
}

/** Une page trouvée, avec sa section, son rang et le chapitre qui a répondu. */
export interface DocsHit {
  section: DocsSection;
  page: DocsPage;
  score: number;
  heading: string | null;
}

/** À quel point cette page est-elle ce qui a été tapé ? Le chapitre trouvé sert de raison. */
function docRank(page: DocsPage, needle: string, words: string[]): { score: number; heading: string | null } {
  // La saisie entière d'abord (« video review » désigne un chapitre, pas deux mots épars) ;
  // à défaut, le premier chapitre qui porte l'un des mots.
  const heading =
    (page.headings ?? []).find((h) => fold(h).includes(needle)) ??
    matchingHeadings(page, words, 1)[0] ??
    null;
  if (fold(page.title).includes(needle)) return { score: DOC_SCORE.title, heading };
  if (fold(page.summary).includes(needle)) return { score: DOC_SCORE.summary, heading };
  if ((page.headings ?? []).some((h) => fold(h).includes(needle)))
    return { score: DOC_SCORE.heading, heading };
  if (fold(page.path).includes(needle)) return { score: DOC_SCORE.path, heading };
  // Trouvée mot à mot, la saisie entière n'apparaissant nulle part d'un seul tenant.
  return { score: DOC_SCORE.words, heading };
}

/**
 * Pages répondant à la saisie, **classées** — l'ordre de la palette. Tri stable (ES2019) :
 * à score égal, l'ordre de lecture du sommaire départage.
 */
export function searchDocs(sections: DocsSection[], query: string): DocsHit[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  const words = needle.split(/\s+/);

  return sections
    .flatMap((section) =>
      section.pages
        .filter((page) => docMatches(page, words))
        .map((page) => ({ section, page, ...docRank(page, needle, words) })),
    )
    .sort((a, b) => b.score - a.score);
}

/**
 * Sections filtrées, **dans l'ordre du sommaire** — la vue du panneau latéral, où l'on ne
 * classe pas : on raye ce qui ne répond pas. Les sections vidées disparaissent.
 */
export function filterSections(sections: DocsSection[], query: string): DocsSection[] {
  const words = docWords(query);
  if (words.length === 0) return sections;
  return sections
    .map((section) => ({ ...section, pages: section.pages.filter((page) => docMatches(page, words)) }))
    .filter((section) => section.pages.length > 0);
}
