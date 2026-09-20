// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Gestion couleur du viewer — **celle du projet**, et rien d'autre : le couple display/view
 * défini dans les paramètres du projet (`ProjectColorSection`) décide de la transformée
 * d'affichage appliquée à l'image. Rien n'est renvoyé au serveur, rien n'est écrit sur le
 * fichier : c'est une transformée d'affichage, jamais une modification du média.
 *
 * Le réglage au coup par coup (display/view choisis dans le dock, exposition, gamma, bascule
 * avant/après) a disparu en Phase 50 avec le panneau Color — décision produit. Ce module ne
 * garde donc que ce qui sert encore : le pipeline du studio, et sa résolution contre la liste
 * des displays que la config expose vraiment.
 *
 * Module **pur** : la lecture des displays et de la LUT est dans `colorQueries.ts`, le rendu
 * dans `renderTransform.ts`.
 */

/** Configuration couleur héritée du projet, telle que la sert `GET /api/media/:id`. */
export interface ProjectColor {
  configId?: string;
  display?: string;
  view?: string;
}

export interface ResolvedDisplayView {
  configId: string;
  display: string;
  view: string;
}

/**
 * Couple display/view effectivement demandé au serveur — celui du projet, s'il existe **dans
 * la config chargée**. Une config remplacée laisse les projets qui la citaient avec un couple
 * mort : il ne faut pas cuire une LUT qui n'a plus de sens ici.
 */
export function resolveDisplayView(
  project: ProjectColor | null | undefined,
  displays: { name: string; views: string[] }[] = [],
): ResolvedDisplayView | null {
  const configId = project?.configId;
  if (!configId) return null;
  const { display, view } = project;
  if (!display || !view) return null;
  // Tant que la liste n'est pas chargée on fait confiance au projet ; une fois chargée, un
  // couple absent de la config (config remplacée) ne vaut plus rien.
  if (displays.length > 0 && !displays.some((d) => d.name === display && d.views.includes(view))) return null;
  return { configId, display, view };
}
