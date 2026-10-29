// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { FilePlus2 } from 'lucide-react';
import { useFileDrop } from '../../lib/useFileDrop';
import { useT } from '../../i18n';

/**
 * "Drop to create the next version" zone (Phase 46).
 *
 * Delivering work used to take three steps — create the version, aim at its upload button, go
 * through a file picker — for a single intention. Here, dropping creates the version and fills it;
 * clicking remains available for whoever prefers to browse.
 */
export default function NewVersionDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const { over, dropProps } = useFileDrop(onFiles);

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      {...dropProps}
      className={`flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-4 text-sm transition-colors ${
        over
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:border-primary/60 hover:text-foreground'
      }`}
    >
      <FilePlus2 size={18} className="shrink-0" />
      <span>{t('version.dropNew')}</span>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </button>
  );
}
