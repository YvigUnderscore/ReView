// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Box, Video } from 'lucide-react';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { useT } from '../../../i18n';

export type TrackId = 'camera' | 'clip';

/**
 * Track selector of the spatial transport: the camera animation of the staging, or the clips carried
 * by the file. Absent when the media has only one of the two.
 */
export default function TrackSwitch({
  track,
  onTrack,
  hasClips,
}: {
  track: TrackId;
  onTrack: (track: TrackId) => void;
  hasClips: boolean;
}) {
  const t = useT();
  return (
    <>
      <SegmentedControl
        label={t('track.animTrack')}
        items={[
          {
            value: 'camera' as const,
            label: t('review.track.camera'),
            icon: Video,
            hint: t('track.stageAnim'),
          },
          {
            value: 'clip' as const,
            label: t('review.track.model'),
            icon: Box,
            hint: hasClips ? t('track.fileClips') : t('track.noAnim'),
            disabled: !hasClips,
          },
        ]}
        value={track}
        onChange={onTrack}
      />
      <span className="rv-rule" />
    </>
  );
}
