// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Lightbox } from '../ui/lightbox';
import { imageDrafts, type AttachmentDraft } from './attachmentDrafts';
import { useT } from '../../i18n';

/**
 * Pièces jointes d'un composeur, AVANT envoi : une vignette par image — ouvrable en grand
 * dans le carrousel commun — et sa croix de retrait. Le nom de fichier seul ne disait rien
 * de ce qu'on envoyait ; « image (3).png » encore moins.
 */
export default function AttachmentDraftList({
  drafts,
  onRemove,
}: {
  drafts: AttachmentDraft[];
  /** Retire la pièce désignée par son identifiant (clé stockée ou fichier en attente). */
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const images = imageDrafts(drafts);
  // Un clic interne ne doit ni envoyer le formulaire ni sélectionner la carte du commentaire.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <ul aria-label={t('comments.attachmentsList')} className="mb-2 flex flex-wrap gap-2">
      {drafts.map((d) => {
        const at = images.findIndex((i) => i.id === d.id);
        return (
          <li key={d.id} className="relative">
            {at >= 0 ? (
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  setLightboxIdx(at);
                }}
                title={d.name || t('comments.openAttachment')}
                aria-label={t('comments.openAttachment')}
                className="block"
              >
                <img
                  src={d.url ?? ''}
                  alt={d.name}
                  className="h-14 w-14 rounded border border-border object-cover"
                />
              </button>
            ) : (
              <span className="flex h-14 max-w-[9rem] items-center gap-1 rounded border border-border bg-secondary/50 px-2 text-2xs text-muted-foreground">
                <Paperclip size={12} className="shrink-0" />
                <span className="truncate">{d.name}</span>
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                onRemove(d.id);
              }}
              title={t('comments.removeAttachment')}
              aria-label={t('comments.removeAttachment')}
              className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-0.5 text-muted-foreground hover:text-destructive"
            >
              <X size={11} />
            </button>
          </li>
        );
      })}
      {lightboxIdx !== null && (
        <Lightbox
          images={images.map((i) => ({ src: i.url ?? '', alt: i.name }))}
          index={lightboxIdx}
          open={lightboxIdx !== null}
          onOpenChange={(o) => !o && setLightboxIdx(null)}
          onIndexChange={setLightboxIdx}
        />
      )}
    </ul>
  );
}
