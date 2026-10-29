// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useT } from '../i18n';
import { filesFromDataTransfer } from '../../lib/dropEntries';

/**
 * Full-screen drop zone (10.C7): an overlay appears as soon as files are dragged
 * anywhere on the page; releasing starts the upload. Listens to drag events
 * at the `window` level (drop possible everywhere). A local drop zone that has already handled
 * the drop (`e.preventDefault()`) is respected: we do not double the upload. A dropped folder
 * is unfolded (image sequence delivered as a directory).
 */
export default function FullPageDropzone({
  onDrop,
  label,
  enabled = true,
}: {
  onDrop: (files: File[]) => void;
  label?: string;
  enabled?: boolean;
}) {
  const t = useT();
  const text = label ?? t('dropzone.drop');
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setActive(false);
      }
    };
    const onDropEv = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = 0;
      setActive(false);
      if (e.defaultPrevented) return; // déjà géré par une drop-zone locale
      e.preventDefault();
      void filesFromDataTransfer(e.dataTransfer).then((files) => {
        if (files.length) onDrop(files);
      });
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDropEv);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDropEv);
    };
  }, [enabled, onDrop]);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-card/70 px-14 py-12 text-center">
        <UploadCloud size={42} className="text-primary" />
        <p className="text-lg font-semibold text-foreground">{text}</p>
        <p className="text-sm text-muted-foreground">{t('dropzone.release')}</p>
      </div>
    </div>
  );
}
