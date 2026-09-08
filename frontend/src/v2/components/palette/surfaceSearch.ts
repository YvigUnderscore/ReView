// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { adminGroupLabel, adminSections } from '../../pages/admin/adminSections';
import { fold, sectionHaystack, sectionMatches } from '../../pages/admin/settingsSearch';
import { sectionLabel, type DocsPage, type DocsSection } from '../../pages/docs/docsManifest';
import type { Tr } from '../../i18n';
import type { Role } from '../../types/api';

/**
 * Les deux familles de résultats qui ne sont pas des lignes de base : la **documentation**
 * et les **réglages**.
 *
 * Les treize autres familles viennent de `GET /api/search` — ce sont des données, filtrées
 * par le serveur. Celles-ci sont des **écrans** : ce qu'on cherche en tapant « watermark »
 * n'est pas un enregistrement, c'est l'endroit où on le règle. Elles se calculent donc ici,
 * pour trois raisons tenant ensemble :
 *
 *  - l'index des réglages **existe déjà** côté client (`admin/settingsSearch`, écrit pour la
 *    recherche interne de l'onglet Réglages) ; en écrire un second côté serveur, c'est se
 *    donner deux tables qui divergeront au premier renommage de section ;
 *  - les libellés de sections sont traduits dans la langue du lecteur, que le serveur ne
 *    connaît pas ;
 *  - le corpus `DOCUMENTATION/` n'est pas dans l'image du backend (son contexte de build est
 *    `backend/`) : le seul index existant est le manifest servi par le frontend.
 *
 * **Cloisonnement.** Même exigence que pour les familles serveur : le filtre d'accès est
 * posé à la source, pas sur les résultats produits. `/admin/*` est refusé à tout autre rôle
 * qu'ADMIN (`AdminPage` rend « accès restreint ») — proposer ces écrans à un artiste, ce
 * serait lui promettre une porte fermée. `/docs` est en revanche ouvert à tous les rôles
 * connectés (lien de la barre latérale sans condition), et la documentation est publique
 * dans le produit : elle n'a pas de cloisonnement à porter.
 */

/** Une destination proposée par la palette : un écran, pas un enregistrement. */
export interface SurfaceHit {
  /** Identifiant stable pour cmdk (`value`) et pour la clé de rendu. */
  id: string;
  label: string;
  /** Ligne secondaire : d'où vient ce résultat, ou pourquoi il correspond. */
  hint: string;
  to: string;
}

/**
 * Nombre de résultats par famille. Même échelle que les référentiels côté serveur
 * (`EXTRA_LIMITS`) : ce sont des écrans uniques, pas des listes qui suivent la production,
 * et la palette doit rester lisible d'un coup d'œil.
 */
export const SURFACE_LIMITS = { docs: 4, settings: 5 } as const;

/**
 * Qualité d'une correspondance de page de documentation, du plus net au plus vague. Même
 * raisonnement que `lib/searchRank` côté serveur : le titre identifie, le chapitre situe,
 * le chemin de fichier ne fait qu'attester.
 */
const DOC_SCORE = { title: 40, summary: 30, heading: 20, path: 10, words: 1 } as const;

/** Tout ce par quoi une page peut être trouvée : son titre, son sous-titre, ses chapitres. */
const docHaystack = (page: DocsPage): string =>
  fold([page.title, page.summary, page.path, ...(page.headings ?? [])].join(' '));

/**
 * La page répond-elle à la recherche ? Tous les mots doivent être présents, comme dans la
 * recherche des réglages : « watermark client » ne doit pas rendre la moitié du manuel.
 */
const docMatches = (haystack: string, words: string[]): boolean =>
  words.every((word) => haystack.includes(word));

/** À quel point cette page est-elle ce qui a été tapé ? Le chapitre trouvé sert de raison. */
function docRank(page: DocsPage, needle: string): { score: number; heading: string | null } {
  const heading = (page.headings ?? []).find((h) => fold(h).includes(needle)) ?? null;
  if (fold(page.title).includes(needle)) return { score: DOC_SCORE.title, heading };
  if (fold(page.summary).includes(needle)) return { score: DOC_SCORE.summary, heading };
  if (heading !== null) return { score: DOC_SCORE.heading, heading };
  if (fold(page.path).includes(needle)) return { score: DOC_SCORE.path, heading };
  // Trouvée mot à mot, la saisie entière n'apparaissant nulle part d'un seul tenant.
  return { score: DOC_SCORE.words, heading };
}

/**
 * Pages de documentation répondant à la saisie — par leur titre **et par leur contenu**,
 * les titres de chapitre du manifest tenant lieu de table des matières.
 */
export function searchDocSurfaces(sections: DocsSection[], query: string, t: Tr): SurfaceHit[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  const words = needle.split(/\s+/);

  return (
    sections
      .flatMap((section) =>
        section.pages
          .filter((page) => docMatches(docHaystack(page), words))
          .map((page) => ({ section, page, ...docRank(page, needle) })),
      )
      // Tri stable (ES2019) : à score égal, l'ordre de lecture du sommaire départage.
      .sort((a, b) => b.score - a.score)
      .slice(0, SURFACE_LIMITS.docs)
      .map(({ section, page, heading }) => ({
        id: `doc-${page.path}`,
        label: page.title,
        hint: [sectionLabel(section, t), heading ?? page.summary].filter(Boolean).join(' · '),
        to: `/docs?p=${encodeURIComponent(page.path)}`,
      }))
  );
}

/**
 * Écrans de réglages répondant à la saisie.
 *
 * L'index est celui de la recherche interne de l'onglet Réglages : les libellés de sections,
 * leurs mots-clés d'usage (« filigrane » autant que « watermark ») et les libellés de champs
 * de la section fourre-tout. Rien n'est recopié ici.
 *
 * Le rôle est lu **avant** de constituer la liste : un artiste n'obtient pas une liste
 * filtrée, il n'obtient rien — l'écran lui serait refusé.
 */
export function searchSettingsSurfaces(query: string, role: Role | undefined, t: Tr): SurfaceHit[] {
  if (role !== 'ADMIN') return [];
  const needle = query.trim();
  if (!needle) return [];

  return (
    adminSections(t)
      .filter((section) => sectionMatches(sectionHaystack(section.key, section.label, t), needle))
      // Le libellé de l'écran prime sur ses mots-clés : « corbeille » doit rendre la Corbeille
      // avant la section fourre-tout, qui porte le mot dans sa liste de synonymes. Tri stable :
      // à égalité, l'ordre de la barre latérale départage.
      .map((section) => ({ section, score: fold(section.label).includes(fold(needle)) ? 2 : 1 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, SURFACE_LIMITS.settings)
      .map(({ section }) => ({
        id: `setting-${section.key}`,
        label: section.label,
        hint: adminGroupLabel(t, section.group),
        to: `/admin/${section.key}`,
      }))
  );
}
