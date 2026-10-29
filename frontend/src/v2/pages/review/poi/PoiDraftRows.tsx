// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import AttachmentDraftList from '@/v2/components/comments/AttachmentDraftList';
import { fileIndexOf, toDrafts } from '@/v2/components/comments/attachmentDrafts';
import { useObjectUrls } from '@/v2/components/comments/useObjectUrls';
import { ATTACHMENT_ACCEPT } from '@/v2/lib/commentAttachments';
import { Textarea } from '@/v2/components/ui/textarea';
import type { PoiDraft, PoiDraftState } from './usePoiDraft';
import { useT } from '@/v2/i18n';

/**
 * Points of interest in preparation, in the composer: one row per point, numbered in placement order.
 * The point's remark is written there, its images are attached, and it is removed there, then **a single**
 * send carries everything.
 *
 * The rows live here and not in the viewer: it is in the composer that one reads what is about to leave,
 * and a text field per point does not fit in an options bar.
 *
 * The remark is WRITTEN as it will be read (see `PoiNoteBody`): it wraps, shows three lines at most, and
 * its thumbnails sit beside it. A single-line field scrolled sideways by construction: that is where the
 * defect was first seen, while typing.
 */

/**
 * Three lines: what a remark shows without having to scroll, when writing as well as when reading.
 * Beyond that, the field scrolls vertically rather than eating the composer.
 */
const NOTE_ROWS = 3;

/**
 * Width of the thumbnail strip: two in a row (`h-14` + the gap), the rest wraps. Without a cap, six
 * images would crush the text field: they are `shrink-0`.
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

/** A row: the number (which highlights the point in the scene), the remark, the images. */
function PoiDraftRow({ point, index, poi }: { point: PoiDraft; index: number; poi: PoiDraftState }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const previews = useObjectUrls(point.files);
  const drafts = toDrafts([], point.files, previews);
  const active = poi.activeKey === point.key;

  return (
    <div className="rounded-md border border-border bg-secondary/30 p-1.5">
      {/* `items-start`: the number and the actions stay at the top when the remark grows. */}
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
        {/* `min-w-0`: without it, a flex child refuses to shrink below the width of its
            content, and a scene path would push the thumbnails out of the row. */}
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
        {/* Thumbnails from batch 5, reused as they are: a single rendering of an attachment in
            preparation across the whole application. They sit BESIDE the remark: their composer
            bottom margin no longer makes sense in a row. */}
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
