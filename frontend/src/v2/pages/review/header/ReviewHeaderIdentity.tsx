// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaResp } from '../reviewTypes';
import VersionNavigator from '../VersionNavigator';
import PlaylistNavigator from '../PlaylistNavigator';
import TimelineNavigator from '../TimelineNavigator';
import { useT } from '../../../i18n';

/**
 * Coin gauche de l'en-tête fusionné : ce qu'on regarde. Nom du média, badge brouillon,
 * sélecteur de version, et la navigation précédent/suivant — entre médias d'une playlist
 * comme entre plans d'un montage.
 *
 * Rendu par la page de review et posé dans l'en-tête du chrome (`headerLeft`), pour que les
 * quatre types de média partagent une seule barre du haut.
 */
export default function ReviewHeaderIdentity({ data }: { data: MediaResp }) {
  const t = useT();
  return (
    <>
      <h1 className="truncate text-base font-semibold">{data.media.originalName}</h1>
      {!data.media.published && (
        <span className="shrink-0 rounded bg-primary/15 px-2 py-0.5 text-xs text-primary">
          {t('reviews.draft')}
        </span>
      )}
      <VersionNavigator versionId={data.media.versionId} mediaId={data.media.id} />
      <PlaylistNavigator versionId={data.media.versionId} />
      <TimelineNavigator mediaId={data.media.id} />
    </>
  );
}
