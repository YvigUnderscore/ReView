// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Portier de l'auto-key (Phase 50, lot 7). L'auto-key écoute les gestes sur le **canvas**, où
 * l'on trouve aussi bien la caméra libre que le gizmo de la caméra-objet. Hors caméra (mode
 * layout), aucun de ces gestes ne déplace la caméra du plan :
 *  - orbiter/molette bouge la caméra **libre** — poser une clé n'aurait aucun sens ;
 *  - tirer le gizmo écrit déjà ses clés lui-même, et le `pointerup` final posait par-dessus une
 *    clé de 8 canaux qui écrasait ce que le gizmo venait d'écrire.
 *
 * `useCameraAnim` monte l'auto-key lui-même (`useCameraAutoKey(autoKey, getDom, insertKeyAtView)`)
 * et ne connaît pas le mode : le portier est le canal par lequel `useLayoutMode`, seule source de
 * vérité du « dans/hors caméra », le suspend. Un seul viewer spatial est monté à la fois, d'où
 * l'état de module — volontairement minimal et réinitialisable.
 */

let suspended = false;

/** Suspend (ou rétablit) l'auto-key. Appelé par `useLayoutMode` à l'entrée/sortie du mode. */
export function suspendAutoKey(on: boolean): void {
  suspended = on;
}

/** Vrai quand un geste sur le canvas ne doit pas poser de clé. */
export function isAutoKeySuspended(): boolean {
  return suspended;
}
