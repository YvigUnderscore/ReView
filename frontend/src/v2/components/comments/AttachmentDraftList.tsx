// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Lightbox } from '../ui/lightbox';
import { imageDrafts, type AttachmentDraft } from './attachmentDrafts';
import { useT } from '../../i18n';

/**
 * Attachments of a composer, BEFORE sending: one thumbnail per image, openable full size
 * in the shared carousel, with its remove button. The file name alone said nothing about
 * what was being sent, and "image (3).png" said even less.
 */
export default function AttachmentDraftList({
  drafts,
  onRemove,
}: {
  drafts: AttachmentDraft[];
  /** Removes the item identified by its id (stored key or pending file). */
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const images = imageDrafts(drafts);
  // An internal click must neither submit the form nor select the comment card.
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
