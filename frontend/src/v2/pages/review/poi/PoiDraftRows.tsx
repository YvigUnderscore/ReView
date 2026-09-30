// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import AttachmentDraftList from '../../../components/comments/AttachmentDraftList';
import { fileIndexOf, toDrafts } from '../../../components/comments/attachmentDrafts';
import { useObjectUrls } from '../../../components/comments/useObjectUrls';
import { ATTACHMENT_ACCEPT } from '../../../../lib/commentAttachments';
import { Textarea } from '../../../components/ui/textarea';
import type { PoiDraft, PoiDraftState } from './usePoiDraft';
import { useT } from '../../../i18n';

/**
 * Points d'intérêt en préparation, dans le composeur : une rangée par point, numérotée dans
 * l'ordre de pose. On y écrit la remarque du point, on y joint ses images, on l'y supprime —
 * puis **un seul** envoi emporte tout.
 *
 * Les rangées vivent ici et pas dans le viewer : c'est dans le composeur qu'on lit ce qui va
 * partir, et un champ de texte par point ne tient pas dans une barre d'options.
 *
 * La remarque s'ÉCRIT comme elle se lira (cf. `PoiNoteBody`) : elle revient à la ligne, montre
 * trois lignes au plus, et ses vignettes se posent à côté d'elle. Un champ mono-ligne défilait
 * en largeur par construction — c'est là, en tapant, que le défaut se voyait d'abord.
 */

/**
 * Trois lignes : ce qu'une remarque montre sans qu'on ait à dérouler, à l'écriture comme à la
 * lecture. Au-delà, le champ défile verticalement plutôt que de manger le composeur.
 */
const NOTE_ROWS = 3;

/**
 * Largeur de la bande de vignettes : deux d'affilée (`h-14` + l'écart), le reste passe à la
 * ligne. Sans plafond, six images écraseraient le champ de texte — elles sont `shrink-0`.
 */
const THUMBS_WIDTH = 'w-[7.5rem]';

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
      {/* `items-start` : le numéro et les actions restent en haut quand la remarque grandit. */}
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={() => poi.setActiveKey(active ? null : point.key)}
          title={t('poi.pointLabel', { n: index + 1 })}
          aria-label={t('poi.pointLabel', { n: index + 1 })}
          aria-pressed={active}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${
            active
              ? 'border-primary bg-background text-primary'
              : 'border-transparent bg-primary text-primary-foreground'
          }`}
        >
          {index + 1}
        </button>
        {/* `min-w-0` : sans lui, un enfant de flex refuse de rétrécir sous la largeur de son
            contenu, et un chemin de plan repousserait les vignettes hors de la rangée. */}
        <Textarea
          autoGrow
          minRows={1}
          maxRows={NOTE_ROWS}
          value={point.text}
          onChange={(e) => poi.setText(point.key, e.target.value)}
          onFocus={() => poi.setActiveKey(point.key)}
          placeholder={t('poi.noteFor', { n: index + 1 })}
          aria-label={t('poi.noteFor', { n: index + 1 })}
          className="min-w-0 flex-1 break-words px-2 py-1 text-xs"
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
        {/* Vignettes du lot 5, réutilisées telles quelles : un seul rendu de pièce jointe en
            préparation dans toute l'application. Elles se posent À CÔTÉ de la remarque — leur
            marge basse de composeur n'a plus de sens dans une rangée. */}
        {drafts.length > 0 && (
          <div className={`${THUMBS_WIDTH} shrink-0 [&>ul]:mb-0`}>
            <AttachmentDraftList
              drafts={drafts}
              onRemove={(id) => {
                const at = fileIndexOf(id);
                if (at !== null) poi.removeFile(point.key, at);
              }}
            />
          </div>
        )}
        <div className="flex shrink-0 items-center">
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
      </div>
    </div>
  );
}
