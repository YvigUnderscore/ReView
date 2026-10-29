// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from '@/v2/types/api';
import type { MessageKey } from '@/v2/i18n';
import type { InfoRow } from './InfoPanel';
import type { MediaResp } from '../reviewTypes';

/** Injected translator: the sheet is a pure function, testable without mounting React. */
type Tr = (key: MessageKey) => string;

/** Technical sheet of the media, as the API provides it. */
export function sheetRows(t: Tr, data: MediaResp, kind: MediaKind, fps: number): InfoRow[] {
  const rows: InfoRow[] = [{ label: t('review.file'), value: data.media.originalName }];
  // The media imported from ShotGrid carries the Version code; the delivered file name remains here:
  // a studio's convention often carries information (colour space, encoding) that the site code does not repeat.
  if (data.sourceFilename && data.sourceFilename !== data.media.originalName)
    rows.push({ label: t('review.sourceFile'), value: data.sourceFilename });
  if (kind === 'VIDEO') {
    rows.push({ label: t('pipeline.fps'), value: `${fps} fps` });
    rows.push({ label: t('review.firstFrame'), value: String(data.startFrame) });
    if (data.hls) rows.push({ label: t('review.delivery'), value: 'HLS' });
    if (data.trim)
      rows.push({
        label: t('review.trim'),
        value: `${data.trim.inFrame} → ${data.trim.outFrame}`,
      });
  }
  if (data.projectColor?.display) rows.push({ label: t('ocio.display'), value: data.projectColor.display });
  if (data.projectColor?.view) rows.push({ label: t('ocio.view'), value: data.projectColor.view });
  rows.push({ label: t('common.status'), value: data.media.status });
  return rows;
}
