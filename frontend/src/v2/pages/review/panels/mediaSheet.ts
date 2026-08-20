// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from '../../../types/api';
import type { MessageKey } from '../../../i18n';
import type { InfoRow } from './InfoPanel';
import type { MediaResp } from '../reviewTypes';

/** Traducteur injecté : la fiche est une fonction pure, testable sans monter de React. */
type Tr = (key: MessageKey) => string;

/** Fiche technique du média, telle que l'API la renseigne. */
export function sheetRows(t: Tr, data: MediaResp, kind: MediaKind, fps: number): InfoRow[] {
  const rows: InfoRow[] = [{ label: t('review.file'), value: data.media.originalName }];
  // Le média importé de ShotGrid porte le code de la Version — le nom du fichier livré
  // reste ici : la convention d'un studio y porte souvent une information (espace
  // colorimétrique, encodage) que le code du site ne reprend pas.
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
