// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { badRequest } from './errors';
import { checkReviewNote, REVIEW_NOTE_MAX_LENGTH, type ReviewRequestRule } from './projectSettings';

/**
 * La consigne qui accompagne un upload (Phase 50).
 *
 * Le réglage projet `reviewRequest` s'appliquait à la PUBLICATION d'un brouillon : c'est là
 * qu'on refusait une livraison sans un mot d'explication. La publication n'étant plus un
 * geste, la règle se serait évaporée avec lui — un studio qui a coché « consigne
 * obligatoire » aurait cessé d'en recevoir sans que rien ne le lui dise. Elle s'applique
 * donc à l'upload, le seul moment où quelqu'un est encore en train de livrer.
 *
 * La fonction vit dans un `lib` et non dans un service parce que l'upload a **deux**
 * finalisations : un fichier unique (`MediaService.finalize`) et une séquence d'images
 * (`ImageSequenceService.completeSequence`). Deux copies de la règle auraient fait de la
 * séquence la porte de service de la consigne obligatoire.
 */

/**
 * Vérifie la consigne, et rend la forme à stocker (`null` quand il n'y en a pas).
 *
 * Le plancher de longueur vaut pour toute consigne écrite, obligatoire ou non : c'est la
 * règle déjà en vigueur pour les consignes de review, et deux planchers différents pour le
 * même réglage auraient été impossibles à expliquer. Les deux refus portent des codes
 * distincts — « il en faut une » et « celle-là est trop courte » n'appellent pas la même
 * correction de la part de celui qui livre.
 */
export function assertUploadNote(note: string | null | undefined, rule: ReviewRequestRule): string | null {
  const verdict = checkReviewNote(note, rule);
  if (verdict === 'missing')
    throw badRequest('This project requires a note with every upload', 'UPLOAD_NOTE_REQUIRED');
  if (verdict === 'too-short')
    throw badRequest('The upload note is shorter than this project requires', 'UPLOAD_NOTE_TOO_SHORT');
  const text = (note ?? '').trim();
  return text ? text.slice(0, REVIEW_NOTE_MAX_LENGTH) : null;
}
