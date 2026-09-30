// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Codes générés en série (SH010, SH020, SH030…).
 *
 * La règle vivait dans un `useMemo` du générateur : elle n'était vérifiable qu'en montant
 * le composant, alors qu'elle n'est faite que d'arithmétique — un départ, un pas, un
 * nombre de chiffres. Elle est donc sortie ici, testée pour elle-même.
 */

export interface GeneratedItem {
  code: string;
  name: string;
  /** `undefined` hors mode plans ; `null` = créé hors séquence. */
  sequenceId?: number | null;
}

/** Un lot reste un lot : au-delà, c'est un import, pas une saisie. */
export const MAX_BATCH_ITEMS = 200;

export interface BatchSpec {
  prefix: string;
  start: number;
  step: number;
  padding: number;
  count: number;
  /** Destination commune du lot, quand elle a un sens (création de plans). */
  sequenceId?: number | null;
}

/**
 * Les éléments du lot, dans l'ordre.
 *
 * Le nom reprend le code : c'est ce qu'un import de production produit, et l'écran de
 * réglages du plan sert ensuite à le nommer autrement. Le nombre est borné à
 * `MAX_BATCH_ITEMS` et un compte négatif ne rend rien plutôt que de lever.
 */
export function buildBatchItems({
  prefix,
  start,
  step,
  padding,
  count,
  sequenceId,
}: BatchSpec): GeneratedItem[] {
  const n = Math.min(Math.max(Math.trunc(count), 0), MAX_BATCH_ITEMS);
  return Array.from({ length: n }, (_, i) => {
    const code = `${prefix}${String(start + i * step).padStart(padding, '0')}`;
    return { code, name: code, sequenceId };
  });
}
