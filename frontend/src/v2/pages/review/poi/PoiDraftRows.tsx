// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import AttachmentDraftList from '../../../components/comments/AttachmentDraftList';
import { fileIndexOf, toDrafts } from '../../../components/comments/attachmentDrafts';
import { useObjectUrls } from '../../../components/comments/useObjectUrls';
import { ATTACHMENT_ACCEPT } from '../../../../lib/commentAttachments';
import { Input } from '../../../components/ui/input';
import type { PoiDraft, PoiDraftState } from './usePoiDraft';
import { useT } from '../../../i18n';

/**
 * Points d'intérêt en préparation, dans le composeur : une rangée par point, numérotée dans
 * l'ordre de pose. On y écrit la remarque du point, on y joint ses images, on l'y supprime —
 * puis **un seul** envoi emporte tout.
 *
 * Les rangées vivent ici et pas dans le viewer : c'est dans le composeur qu'on lit ce qui va
 * partir, et un champ de texte par point ne tient pas dans une barre d'options.
 */
export default function PoiDraftRows({ poi }: { poi: PoiDraftState }) {
  const t = useT();
  if (poi.points.length === 0) return null;
  return (
    <div className="mb-2 space-y-1.5">
      <p className="text-xs font-medium text-primary">{t('poi.attached', { count: poi.points.length })}</p>
      {poi.points.map((point, index) => (
        <PoiDraftRow key={point.key} point={point} index={index} poi={poi} />
      ))}
    </div>
  );
}

/** Une rangée : le numéro (qui met le point en avant dans la scène), la remarque, les images. */
function PoiDraftRow({ point, index, poi }: { point: PoiDraft; index: number; poi: PoiDraftState }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const previews = useObjectUrls(point.files);
  const drafts = toDrafts([], point.files, previews);
  const active = poi.activeKey === point.key;

  return (
    <div className="rounded-md border border-border bg-secondary/30 p-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => poi.setActiveKey(active ? null : point.key)}
          title={t('poi.pointLabel', { n: index + 1 })}
          aria-label={t('poi.pointLabel', { n: index + 1 })}
          aria-pressed={active}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${
            active
              ? 'border-primary bg-background text-primary'
              : 'border-transparent bg-primary text-primary-foreground'
          }`}
        >
          {index + 1}
        </button>
        <Input
          value={point.text}
          onChange={(e) => poi.setText(point.key, e.target.value)}
          onFocus={() => poi.setActiveKey(point.key)}
          placeholder={t('poi.noteFor', { n: index + 1 })}
          aria-label={t('poi.noteFor', { n: index + 1 })}
          className="h-7 px-2 py-1 text-xs"
        />
        <input
          ref={fileRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            poi.addFiles(point.key, Array.from(e.target.files ?? []));
            if (fileRef.current) fileRef.current.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title={t('poi.addImages')}
          aria-label={t('poi.addImages')}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ImagePlus size={14} />
        </button>
        <button
          type="button"
          onClick={() => poi.remove(point.key)}
          title={t('poi.removePoint')}
          aria-label={t('poi.removePoint')}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
        >
          <X size={14} />
        </button>
      </div>
      {/* Vignettes du lot 5, réutilisées telles quelles : un seul rendu de pièce jointe en
          préparation dans toute l'application. */}
      {drafts.length > 0 && (
        <div className="mt-1.5 pl-6">
          <AttachmentDraftList
            drafts={drafts}
            onRemove={(id) => {
              const at = fileIndexOf(id);
              if (at !== null) poi.removeFile(point.key, at);
            }}
          />
        </div>
      )}
    </div>
  );
}
