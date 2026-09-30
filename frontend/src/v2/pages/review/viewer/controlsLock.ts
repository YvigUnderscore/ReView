// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Propriétaire unique de `controls.enabled` des viewers spatiaux (Phase 50, lot 8).
 *
 * Trois modules gelaient l'orbite en écrivant le booléen directement — le vol (`flyControls`),
 * les gizmos de transformation, et le relais de molette des overlays qui compte sur elle. Aucun
 * ne savait ce que les autres voulaient : chaque démontage de gizmo remettait `enabled` à `true`
 * sans se demander si quelqu'un d'autre retenait encore l'orbite. Armer puis désarmer un gizmo
 * pendant un vol rendait donc l'orbite **en plein vol**, derrière le dos de `flyControls` : la
 * souris se remettait à orbiter au lieu de diriger le regard.
 *
 * Un booléen ne peut pas porter deux raisons à la fois. On compte donc les **inhibiteurs** :
 * chacun prend un jeton nommé, le rend quand il a fini, et l'orbite ne revient qu'au dernier
 * jeton rendu. Plus personne n'écrit `enabled` à la main — c'est la seule façon d'empêcher la
 * rustine suivante de réintroduire le même défaut ailleurs.
 */

/** Cible minimale : tout objet portant l'interrupteur d'orbite (`OrbitControls`). */
export interface OrbitToggle {
  enabled: boolean;
}

/** L'orbite répond-elle, avec ce nombre d'inhibiteurs ? Fonction pure, testable seule. */
export function orbitEnabled(inhibitors: number): boolean {
  return inhibitors <= 0;
}

/**
 * Jetons en cours par cible. Une `WeakMap` : rien ne retient un viewer démonté, et deux viewers
 * montés en même temps (comparaison A/B) comptent chacun les leurs.
 */
const held = new WeakMap<OrbitToggle, { reason: string }[]>();

/** Raisons qui retiennent l'orbite, dans l'ordre de prise — diagnostic et tests. */
export function orbitInhibitors(target: OrbitToggle): readonly string[] {
  return (held.get(target) ?? []).map((token) => token.reason);
}

/**
 * Retient l'orbite au nom de `reason` et rend la fonction qui la relâche.
 *
 * La libération est **idempotente** et ne relâche que son propre jeton : un nettoyage rejoué
 * (démontage d'effet React, dispose appelé deux fois) ne rend jamais l'orbite à la place d'un
 * autre inhibiteur encore actif.
 */
export function inhibitOrbit(target: OrbitToggle, reason: string): () => void {
  const list = held.get(target) ?? [];
  const token = { reason };
  list.push(token);
  held.set(target, list);
  target.enabled = orbitEnabled(list.length);
  return () => {
    const current = held.get(target);
    const at = current ? current.indexOf(token) : -1;
    if (!current || at < 0) return; // déjà relâché
    current.splice(at, 1);
    target.enabled = orbitEnabled(current.length);
  };
}
