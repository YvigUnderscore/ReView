// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus } from '@prisma/client';

/**
 * État de publication d'une version au regard de ses médias — analyse PURE, testée.
 *
 * Une version n'est plus un objet qu'on publie séparément : elle est publiée **parce que**
 * ses médias le sont. Publier trois fichiers un par un puis se souvenir de publier la
 * version par-dessus était une comptabilité que personne ne tenait, et qui laissait des
 * versions « brouillon » remplies de médias visibles de toute l'équipe.
 *
 * Deux règles, symétriques :
 *  - tous les médias publiés → la version l'est ;
 *  - la version publiée → un média qui la rejoint l'est aussi.
 */

/** Ce qu'il faut savoir d'un média pour trancher. */
export interface MediaPublishState {
  published: boolean;
  status: MediaStatus;
}

/**
 * Un média échoué ne compte pas : il ne sera jamais publié, et le laisser peser
 * empêcherait la version d'être publiée à tout jamais pour cause de fichier mort.
 */
const counts = (media: MediaPublishState) => media.status !== MediaStatus.FAILED;

/**
 * La version doit-elle passer publiée ? Il faut au moins un média — une version vide n'a
 * rien à montrer — et que tous ceux qui comptent soient publiés.
 */
export function shouldPublishVersion(media: readonly MediaPublishState[]): boolean {
  const kept = media.filter(counts);
  return kept.length > 0 && kept.every((m) => m.published);
}

/**
 * Un média ajouté à une version déjà publiée naît publié.
 *
 * C'est la contrepartie nécessaire de la règle précédente : sans elle, ajouter un rendu à
 * une version publiée la ferait retomber en brouillon aux yeux du calcul, ou obligerait à
 * republier à la main ce qui l'était déjà.
 */
export function inheritsPublication(versionPublished: boolean): boolean {
  return versionPublished;
}

/**
 * Une version publiée ne redescend jamais toute seule. Dépublier est une décision de
 * superviseur (elle retire la version des liens de partage, avec ses décisions de review) :
 * elle ne peut pas être l'effet de bord de la suppression d'un média.
 */
export function shouldUnpublishVersion(): false {
  return false;
}
