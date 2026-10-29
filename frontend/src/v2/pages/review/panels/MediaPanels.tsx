// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Camera, FileDown, LayoutGrid, Scissors } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { MediaKind } from '../../../types/api';
import type { PanelId } from '../chrome/panels';
import { sheetRows } from './mediaSheet';
import InfoPanel from './InfoPanel';
import ExportPanel from './ExportPanel';
import type { MediaResp } from '../reviewTypes';
import { useT } from '../../../i18n';

/**
 * Inspector dock content for flat viewers: the technical sheet and the export.
 *
 * The other tabs left in Phase 50: `chrome/panels.ts` says which and why. What they used to adjust now
 * lives where one looks: the A/B comparison in the options bar of the "Compare" mode, and the
 * composition guides on the viewer's right-click.
 */
export default function MediaPanels({
  panel,
  kind,
  data,
  fps,
  onExportFrame,
  onContactSheet,
}: {
  panel: PanelId | null;
  kind: MediaKind;
  data: MediaResp;
  fps: number;
  onExportFrame?: () => void;
  onContactSheet?: () => void;
}) {
  const t = useT();

  if (panel === 'info') return <InfoPanel sheet={sheetRows(t, data, kind, fps)} />;

  if (panel === 'export')
    return (
      <ExportPanel
        originalUrl={data.url}
        originalName={data.media.originalName}
        notesMediaId={data.media.id}
        staging={
          <>
            {onExportFrame && (
              <Button size="sm" variant="outline" onClick={onExportFrame}>
                <Camera size={13} />
                {kind === 'VIDEO' ? t('panels.currentFramePng') : t('panels.viewPng')}
              </Button>
            )}
            {onContactSheet && (
              <Button size="sm" variant="ghost" onClick={onContactSheet}>
                <LayoutGrid size={13} />
                {t('ctx.contactSheet')}
              </Button>
            )}
            {/* The already-cut proxy is no longer regenerated (the cutting disappeared in Phase 50),
                but saying so is still due: the original file exported here is longer than what the
                reader shows. */}
            {kind === 'VIDEO' && data.trim && (
              <span className="rv-optbar__hint whitespace-normal">
                <Scissors size={12} /> {t('review.trimmedProxy')}
              </span>
            )}
            {!onExportFrame && !onContactSheet && (
              <span className="rv-optbar__hint whitespace-normal">
                <FileDown size={12} /> {t('review.onlyOriginal')}
              </span>
            )}
          </>
        }
      />
    );

  return null;
}
