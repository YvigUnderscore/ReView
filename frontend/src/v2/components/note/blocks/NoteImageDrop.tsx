// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { NOTE_IMAGE_ACCEPT, isAcceptedNoteImage } from '../noteImages';
import { useT } from '../../../i18n';

/**
 * Faire entrer une image dans une fiche.
 *
 * Trois gestes, parce qu'on ne se souvient jamais de celui qui marche : **déposer** un
 * fichier, **coller** depuis le presse-papier (le geste des artistes, capture au clavier
 * puis Ctrl+V) et **choisir** au sélecteur de fichiers. Le troisième ne sert qu'à ceux qui
 * n'ont pas essayé les deux premiers, mais il doit exister — c'est le seul qui s'atteint
 * au clavier.
 *
 * Les fichiers d'un autre type sont écartés en silence : lâcher un dossier de rendus sur
 * une planche est courant, et une erreur par fichier refusé n'apprendrait rien.
 */
export default function NoteImageDrop({
  onFiles,
  busy,
  multiple = true,
  compact,
}: {
  onFiles: (files: File[]) => void;
  busy?: boolean;
  multiple?: boolean;
  /** Version réduite, pour un bloc qui porte déjà une image. */
  compact?: boolean;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter(isAcceptedNoteImage);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        // Ce dépôt-ci est traité : le garde-fou de l'éditeur ne doit pas l'ajouter une
        // seconde fois à la fin de la fiche.
        e.stopPropagation();
        setOver(false);
        take(e.dataTransfer.files);
      }}
      onPaste={(e) => take(e.clipboardData.files)}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-2xs transition-colors ${
        over ? 'border-primary bg-primary/5' : 'border-border bg-secondary/20'
      } ${compact ? 'p-2' : 'p-5'}`}
    >
      <input
        ref={input}
        type="file"
        accept={NOTE_IMAGE_ACCEPT}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          // Sans cette remise à zéro, redéposer le même fichier ne déclencherait rien.
          e.target.value = '';
        }}
      />
      {!compact && <span className="text-muted-foreground">{t('note.images.drop')}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-foreground transition-colors hover:bg-secondary/60 disabled:opacity-60"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
        {busy ? t('note.images.uploading') : t('note.images.choose')}
      </button>
    </div>
  );
}
