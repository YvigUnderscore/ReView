// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaResp } from '../reviewTypes';
import VersionNavigator from '../VersionNavigator';
import PlaylistNavigator from '../PlaylistNavigator';
import TimelineNavigator from '../TimelineNavigator';
import { useT } from '@/v2/i18n';

/**
 * Left corner of the merged header: what is being looked at. Media name, draft badge, version
 * selector, and previous/next navigation, between media of a playlist as well as between shots of an edit.
 *
 * Rendered by the review page and placed in the chrome's header (`headerLeft`), so that the four
 * media types share a single top bar.
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
