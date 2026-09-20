// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus } from '@prisma/client';
import { forbidden } from './errors';

/**
 * Verrou de publication — ce qu'il gèle, et ce qu'il ne gèle plus (Phase 50).
 *
 * La Phase 11 avait posé une règle d'un seul mot : publié = figé. Elle tenait parce que la
 * publication était un geste de fin de course. Depuis que le média est publié **dès son
 * upload** (réglage `draftMode` désactivé par défaut), la même règle gèlerait le média au
 * moment où l'artiste commence à peine à travailler dessus : nettoyer un splat, recomposer
 * une scène USD, relancer un transcodage raté deviendraient impossibles sans réuploader.
 *
 * Le verrou est donc **conservé, et sa table d'exceptions écrite noir sur blanc**. Ce qui
 * reste verrouillé l'est par choix, pas par oubli — c'est précisément pour cela que chaque
 * entrée de la table porte sa raison, et qu'aucun appel n'a été simplement retiré : le
 * service demande au verrou, et le verrou répond selon la table.
 *
 * Ligne de partage : est permise l'écriture qui **corrige la lecture** d'un média sans
 * réécrire ce qui a été livré (éditions non destructives, mise en scène, rattrapage d'un
 * traitement échoué) ; est refusée celle qui **change la livraison** sous les yeux de ceux
 * qui l'ont déjà vue et commentée. Pour changer la livraison, il reste une seule voie :
 * une nouvelle version.
 */

/** Les écritures qui se présentent devant le verrou, nommées une fois pour toutes. */
export type PublishedWrite =
  'splatEdit' | 'usdOverride' | 'usdRecompose' | 'versionTransform' | 'uploadFinalize';

/**
 * La table. `true` = l'écriture reste permise sur un média publié ; la raison est à côté.
 *
 * Elle est exhaustive par construction (`Record<PublishedWrite, …>`) : ajouter une écriture
 * au type oblige à trancher son cas ici, au lieu de le laisser retomber sur un défaut que
 * personne n'a choisi.
 */
const ALLOWED_WHILE_PUBLISHED: Record<PublishedWrite, boolean> = {
  // Éditions splat (splat-edits, masque de suppression, sous-ensembles) : non destructives
  // par construction — le fichier d'origine n'est jamais touché, tout est rejoué à la
  // lecture pour tous les spectateurs. Nettoyer un splat EST le travail de review d'un
  // splat ; l'interdire après publication revenait à l'interdire tout court.
  splatEdit: true,
  // Override de scène USD (46.D) : une mise en scène rejouée au chargement du viewer. Même
  // nature que `splatPresentation`, qui était déjà une exception depuis la Phase 11.
  usdOverride: true,
  // Recomposition USD (46) : choisir les variantes et le purpose à cuire. C'est le geste
  // qui rend une scène lisible ; il ne remplace pas le fichier livré, il en dérive une
  // représentation.
  usdRecompose: true,
  // Transform d'une version publiée : c'est l'assise de la comparaison A/B et des
  // annotations ancrées au cadre. La déplacer après coup fausse tout ce qui s'y réfère.
  versionTransform: false,
  // Finalisation d'un upload déjà finalisé : réécrirait statut, taille et pipeline d'un
  // média dont le contenu a été diffusé. L'appelant garde sa nuance pour le média encore
  // en UPLOADING, qui n'a jamais été servi à personne (cf. MediaService.finalize).
  uploadFinalize: false,
};

/** L'écriture est-elle permise sur un média publié ? Lecture de la table, sans lever. */
export function isAllowedWhilePublished(write: PublishedWrite): boolean {
  return ALLOWED_WHILE_PUBLISHED[write];
}

/**
 * Garde d'écriture : laisse passer un brouillon, et un média publié dont l'écriture figure
 * à la table des exceptions. Refuse le reste en 403 `PUBLISHED_LOCKED`.
 */
export function assertWritable(entity: { published: boolean }, write: PublishedWrite): void {
  if (!entity.published || ALLOWED_WHILE_PUBLISHED[write]) return;
  throw forbidden('Editing is locked once published', 'PUBLISHED_LOCKED');
}

/**
 * Relances de traitement accordées à un média **publié** dont le traitement a échoué.
 *
 * Une seule, et c'est un cul-de-sac réel qu'elle débouche : un média publié d'office dont
 * le transcodage échoue serait mort à jamais — ni relançable (verrou), ni remplaçable sur
 * place. Une relance suffit à rattraper l'incident d'infrastructure ; au-delà, l'échec est
 * dans le fichier, et c'est une nouvelle version qu'il faut, pas une quatrième tentative
 * qui occupe la file.
 */
export const PUBLISHED_REPROCESS_ALLOWANCE = 1;

/**
 * Champ de `metadata` qui porte le compteur. Dans `metadata` et non en colonne : l'exception
 * est bornée à un cas d'exploitation et ne vaut pas une migration de schéma.
 */
const REPROCESS_COUNT_KEY = 'publishedReprocessCount';

/** Relances déjà consommées par ce média publié — absent, illisible ou négatif ⇒ zéro. */
export function publishedReprocessCount(metadata: unknown): number {
  const raw = (metadata as Record<string, unknown> | null | undefined)?.[REPROCESS_COUNT_KEY];
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** `metadata` avec une relance de plus au compteur — le reste intact. */
export function withPublishedReprocess(metadata: unknown): Record<string, unknown> {
  return {
    ...((metadata ?? {}) as Record<string, unknown>),
    [REPROCESS_COUNT_KEY]: publishedReprocessCount(metadata) + 1,
  };
}

/** Ce qu'il faut savoir d'un média pour trancher une relance. */
export interface ReprocessCandidate {
  published: boolean;
  status: MediaStatus;
  metadata: unknown;
}

/**
 * Le traitement de ce média peut-il être relancé ?
 *
 * Un brouillon : toujours. Un média publié : seulement si son traitement a ÉCHOUÉ, et une
 * seule fois. Les deux refus portent leur propre code — un 403 générique laisserait
 * l'interface dire « verrouillé » là où la vraie réponse est « ce média va bien » ou
 * « la relance a déjà été consommée ».
 */
export function assertReprocessable(media: ReprocessCandidate): void {
  if (!media.published) return;
  if (media.status !== MediaStatus.FAILED)
    throw forbidden(
      'A published media whose processing succeeded cannot be reprocessed — upload a new version',
      'REPROCESS_ONLY_AFTER_FAILURE',
    );
  if (publishedReprocessCount(media.metadata) >= PUBLISHED_REPROCESS_ALLOWANCE)
    throw forbidden(
      'This published media has already used its single reprocess attempt',
      'REPROCESS_ALREADY_RETRIED',
    );
}
