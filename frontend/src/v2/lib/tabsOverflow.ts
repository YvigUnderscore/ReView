// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Répartition d'une barre d'onglets entre ce qui tient et ce qui part au menu « … » (A1).
 *
 * Fonctions pures : la mesure du DOM reste dans le composant, la décision est testable.
 * Onze onglets sur la page projet ne tiennent pas sous 1000 px ; sans repli, la barre
 * débordait et faisait défiler la page entière latéralement.
 */

/**
 * Nombre d'onglets affichables. Si tout ne tient pas, la place du bouton « … » est
 * réservée d'abord — sinon le dernier onglet visible le pousserait hors du cadre.
 */
export function computeVisibleTabs(
  widths: number[],
  gap: number,
  container: number,
  moreWidth: number,
): number {
  if (widths.length === 0) return 0;
  // Conteneur non encore mesuré : on montre tout, la mesure suivante corrigera.
  if (container <= 0) return widths.length;

  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  if (total <= container) return widths.length;

  const budget = container - moreWidth - gap;
  let used = 0;
  let visible = 0;
  for (const w of widths) {
    const next = used + w + (visible > 0 ? gap : 0);
    if (next > budget) break;
    used = next;
    visible += 1;
  }
  return visible;
}

/**
 * Découpe la liste en visibles / débordement. L'onglet actif reste toujours atteignable
 * d'un seul clic : s'il tombe dans le débordement, il prend la dernière place visible et
 * l'onglet délogé part à sa position dans le menu (l'ordre relatif du menu est conservé).
 */
export function splitTabs<T>(
  items: T[],
  visibleCount: number,
  activeIndex: number,
): { visible: T[]; overflow: T[] } {
  if (visibleCount >= items.length) return { visible: [...items], overflow: [] };

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);
  if (visibleCount > 0 && activeIndex >= visibleCount && activeIndex < items.length) {
    const displaced = visible[visibleCount - 1];
    visible[visibleCount - 1] = items[activeIndex];
    overflow[activeIndex - visibleCount] = displaced;
  }
  return { visible, overflow };
}
