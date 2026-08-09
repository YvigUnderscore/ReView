// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useParams } from 'react-router-dom';
import { parseIdParam } from '../lib/slug';
import ReviewWorkspace from './review/ReviewWorkspace';

/**
 * Review d'un média (vidéo/image/3D).
 *
 * L'orchestration vit dans `ReviewWorkspace`, partagé avec la page de montage : les deux
 * écrans doivent offrir exactement les mêmes outils, ce que seule une implémentation
 * commune garantit dans la durée.
 */
export default function ReviewPage() {
  const { mediaId } = useParams();
  const id = parseIdParam(mediaId);
  // key : réinitialise tout l'état (annotations, sélection, vidéo) au changement de
  // média — navigation précédent/suivant ou changement de version sans quitter l'écran.
  return <ReviewWorkspace key={id} id={id} rawParam={mediaId} />;
}
