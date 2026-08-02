// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import {
  isAudioAttachment,
  isImageAttachment,
  type CommentAttachment,
} from '../../../lib/commentAttachments';
import { Lightbox } from '../ui/lightbox';
import { useT } from '../../i18n';

/**
 * Pièces jointes d'un commentaire : 2 vignettes image max + tuile « +x images » (toutes
 * visibles dans la lightbox carrousel), chips téléchargeables pour les PDF/zip/texte.
 */
export default function CommentAttachmentList({
  attachments,
  stop,
}: {
  attachments: CommentAttachment[];
  /** Empêche un clic interne de sélectionner la carte du commentaire. */
  stop: (e: React.MouseEvent) => void;
}) {
  const t = useT();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const imageAtts = attachments.filter((a) => !!a.url && isImageAttachment(a.contentType));

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {imageAtts.slice(0, 2).map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => {
            stop(e);
            setLightboxIdx(i);
          }}
          className="block"
        >
          <img
            src={a.url ?? ''}
            alt={a.name ?? ''}
            className="h-20 w-20 rounded border border-border object-cover"
          />
        </button>
      ))}
      {imageAtts.length > 2 && (
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            setLightboxIdx(2);
          }}
          title={t('board.seeAllImages')}
          className="flex h-20 w-20 flex-col items-center justify-center rounded border border-border bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <span className="text-sm font-semibold">+{imageAtts.length - 2}</span>
          <span className="text-[10px]">images</span>
        </button>
      )}
      {/* Notes vocales (32.F) : lecteur audio inline */}
      {attachments.map(
        (a, i) =>
          a.url &&
          isAudioAttachment(a.contentType) && (
            <audio
              key={`audio-${i}`}
              controls
              preload="metadata"
              src={a.url}
              onClick={stop}
              className="h-8 w-full max-w-[16rem]"
            />
          ),
      )}
      {attachments.map(
        (a, i) =>
          a.url &&
          !isImageAttachment(a.contentType) &&
          !isAudioAttachment(a.contentType) && (
            <a
              key={i}
              onClick={stop}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-[14rem] items-center gap-1 rounded border border-border bg-secondary/50 px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Paperclip size={12} className="shrink-0" />
              <span className="truncate">{a.name ?? 'Pièce jointe'}</span>
            </a>
          ),
      )}
      {lightboxIdx !== null && (
        <Lightbox
          images={imageAtts.map((a) => ({ src: a.url ?? '', alt: a.name ?? '' }))}
          index={lightboxIdx}
          open={lightboxIdx !== null}
          onOpenChange={(o) => !o && setLightboxIdx(null)}
          onIndexChange={setLightboxIdx}
        />
      )}
    </div>
  );
}
