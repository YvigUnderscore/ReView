// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Camera, FileArchive, FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Group } from '../chrome/DockGroup';
import NotesExportPanel from './NotesExportPanel';
import { downloadImage } from '../mediaCapture';
import { exportFileName } from '../useMediaExport';
import { useT } from '../../../i18n';

/**
 * Export panel of the dock: the media first (with or without the baked edits), then the staging, and
 * the review notes last. Inherits from `SplatExportPanel`. Exports always take the **saved** edits,
 * never the current selection: this is stated in plain words to the reader.
 */
export default function ExportPanel({
  cleaned,
  originalUrl,
  originalName,
  staging,
  notesMediaId,
}: {
  /** Export of the media with the edits applied (cleaned .spz, transformed .glb). */
  cleaned?: { label: string; hint: string; busy: boolean; onExport: () => void };
  originalUrl: string;
  originalName: string;
  /** Staging exports (camera animation, view capture). */
  staging?: ReactNode;
  /** Media from which notes can be exported (absent = viewer that has not yet plugged it in). */
  notesMediaId?: number;
}) {
  const t = useT();
  return (
    <>
      <Group title={t('review.export.media')}>
        {cleaned && (
          <Button
            size="sm"
            variant="outline"
            disabled={cleaned.busy}
            title={cleaned.hint}
            onClick={cleaned.onExport}
          >
            {cleaned.busy ? <Loader2 size={13} className="animate-spin" /> : <FileArchive size={13} />}
            {cleaned.label}
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild>
          <a
            href={originalUrl}
            download={originalName}
            target="_blank"
            rel="noopener noreferrer"
            title={t('review.export.original')}
          >
            <FileDown size={13} />
            {t('review.originalFile')}
          </a>
        </Button>
      </Group>
      {staging && <Group title={t('review.export.staging')}>{staging}</Group>}
      {notesMediaId !== undefined && <NotesExportPanel scope="media" id={notesMediaId} />}
      <span className="rv-optbar__hint whitespace-normal">{t('review.exportsHint')}</span>
    </>
  );
}

/**
 * View-capture button for the current view, shared by the spatial Export panels (3D, splat).
 * Download and feedback live here: both panels used to copy them, and the viewer only has one thing
 * to provide, the PNG (see `viewer/viewCapture`).
 */
export function CaptureViewButton({
  capture,
  originalName,
}: {
  /** Synchronous capture: PNG as a data URL, or `null` if the render produced nothing. */
  capture: () => string | null;
  originalName: string;
}) {
  const t = useT();
  const onClick = () => {
    const png = capture();
    if (!png) {
      toast.error(t('common.error.capture'));
      return;
    }
    void downloadImage(png, exportFileName(originalName, 'view', 'png'))
      .then(() => toast.success(t('review.viewCaptured')))
      .catch(() => toast.error(t('common.error.capture')));
  };
  return (
    <Button size="sm" variant="ghost" onClick={onClick} title={t('review.export.capture')}>
      <Camera size={13} />
      {t('review.export.captureShort')}
    </Button>
  );
}
