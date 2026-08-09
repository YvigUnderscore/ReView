// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Hand } from 'lucide-react';
import { modesFor, type ReviewMode } from '../review/chrome/modes';
import { DRAW_TOOLS, type ReviewTool } from '../review/chrome/tools';

/**
 * Ce que la coquille de review propose sur un montage (Phase 46).
 *
 * Le montage n'a qu'un mode : le regarder. La comparaison A/B et la découpe portent sur un
 * média, pas sur un film assemblé — les offrir ici promettrait des gestes qui n'existent
 * pas. L'annotation, elle, s'arme depuis le composer, comme partout ailleurs.
 */
export const MONTAGE_MODES: ReviewMode[] = modesFor('VIDEO').filter((m) => m.value === 'explore');

/**
 * Outil de repos du montage. Celui de la review promet un panoramique et un zoom sur
 * l'image ; ici le clic lit ou met en pause, et rien d'autre — l'infobulle doit le dire.
 */
const MONTAGE_NAV: ReviewTool = {
  id: 'nav',
  labelKey: 'tool.nav',
  icon: Hand,
  key: 'V',
  hintKey: 'timeline.navHint',
};

/** Rail du montage : la navigation, et les tracés dès que l'annotation est armée. */
export function montageTools(annotating: boolean): ReviewTool[] {
  return annotating ? [MONTAGE_NAV, ...DRAW_TOOLS] : [MONTAGE_NAV];
}
