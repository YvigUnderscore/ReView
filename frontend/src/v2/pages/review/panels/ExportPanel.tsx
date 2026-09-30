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
 * Panneau Export du dock : le média d'abord (avec ou sans les éditions cuites), la mise en
 * scène ensuite, les notes de review pour finir. Hérite de `SplatExportPanel`. Les exports
 * reprennent les éditions **enregistrées**, jamais la sélection en cours — c'est dit en
 * toutes lettres au lecteur.
 */
export default function ExportPanel({
  cleaned,
  originalUrl,
  originalName,
  staging,
  notesMediaId,
}: {
  /** Export du média avec les éditions appliquées (.spz nettoyé, .glb transformé). */
  cleaned?: { label: string; hint: string; busy: boolean; onExport: () => void };
  originalUrl: string;
  originalName: string;
  /** Exports de mise en scène (animation caméra, capture de vue). */
  staging?: ReactNode;
  /** Média dont on peut sortir les notes (absent = viewer qui ne l'a pas encore branché). */
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
 * Bouton de capture de la vue courante — partagé par les panneaux Export spatiaux (3D, splat).
 * Le téléchargement et les retours vivent ici : les deux panneaux les recopiaient, et le viewer
 * n'a qu'une chose à fournir, le PNG (cf. `viewer/viewCapture`).
 */
export function CaptureViewButton({
  capture,
  originalName,
}: {
  /** Capture synchrone : PNG en data URL, ou `null` si le rendu n'a rien donné. */
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
