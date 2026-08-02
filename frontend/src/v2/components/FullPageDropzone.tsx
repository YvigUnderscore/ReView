// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { UploadCloud } from 'lucide-react';

/**
 * Drop-zone plein-écran (10.C7) : un overlay apparaît dès qu'on glisse des fichiers
 * n'importe où sur la page ; relâcher lance l'upload. Écoute les événements de drag
 * au niveau `window` (dépôt possible partout). Une drop-zone locale qui a déjà traité
 * le dépôt (`e.preventDefault()`) est respectée : on ne double pas l'upload.
 */
export default function FullPageDropzone({
  onDrop,
  label = 'Déposez vos fichiers ici',
  enabled = true,
}: {
  onDrop: (files: File[]) => void;
  label?: string;
  enabled?: boolean;
}) {
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
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) onDrop(files);
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
        <p className="text-lg font-semibold text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">Relâchez pour lancer l’upload</p>
      </div>
    </div>
  );
}
