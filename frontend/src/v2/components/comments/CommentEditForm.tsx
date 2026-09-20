// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { Check, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  ATTACHMENT_ACCEPT,
  MAX_COMMENT_ATTACHMENTS,
  uploadCommentAttachments,
  type CommentAttachment,
} from '../../../lib/commentAttachments';
import { useImagePaste } from '../../lib/useImagePaste';
import { useEditComment } from '../../lib/commentsApi';
import type { ReviewComment } from '../../types/api';
import AttachmentDraftList from './AttachmentDraftList';
import MentionMenu from './MentionMenu';
import { removeDraft, toDrafts } from './attachmentDrafts';
import { useMentions } from './useMentions';
import { useObjectUrls } from './useObjectUrls';
import { useT } from '../../i18n';

/** Texte brut du contenu stocké : le champ d'édition n'affiche pas de balisage. */
function plainOf(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent ?? '';
}

/**
 * Édition d'un commentaire (D5).
 *
 * Trois manques réparés d'un coup : les pièces jointes s'ajoutent et se retirent à volonté
 * (le `PATCH` les ignorait), la liste envoyée est complète — ce qui n'y figure plus quitte
 * le stockage — et l'autocomplétion `@mention`, offerte à la saisie et à la réponse,
 * l'est enfin ici aussi.
 */
export default function CommentEditForm({
  comment,
  mediaObjectId,
  onDone,
  onCancel,
}: {
  comment: ReviewComment;
  mediaObjectId: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(() => plainOf(comment.content));
  const [kept, setKept] = useState<CommentAttachment[]>(() => comment.attachments ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mentions = useMentions(text, setText, textRef);
  const previews = useObjectUrls(files);
  const drafts = toDrafts(kept, files, previews);
  const edit = useEditComment(mediaObjectId);

  const addFiles = (add: File[]) => {
    if (drafts.length + add.length > MAX_COMMENT_ATTACHMENTS)
      toast.warning(t('comment.maxAttachments', { count: MAX_COMMENT_ATTACHMENTS }));
    const room = Math.max(0, MAX_COMMENT_ATTACHMENTS - kept.length);
    setFiles((fs) => [...fs, ...add].slice(0, room));
  };
  const onPasteImage = useImagePaste(addFiles);

  const drop = (id: string) => {
    const next = removeDraft(id, files, kept);
    setFiles(next.files);
    setKept(next.existing);
  };

  const save = async () => {
    setBusy(true);
    try {
      const added = files.length > 0 ? await uploadCommentAttachments(files) : [];
      edit.mutate(
        {
          id: comment.id,
          // Le serveur exige un contenu : une note réduite à ses images garde le même
          // marqueur minimal qu'à la création, plutôt que de repartir en 400.
          content: text.trim() || '(image)',
          // La clé, le nom et le type — jamais l'URL présignée, qui n'appartient pas au fil.
          attachments: [...kept.map(({ key, name, contentType }) => ({ key, name, contentType })), ...added],
        },
        { onSuccess: onDone },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('comment.updateFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1">
      <div className="relative">
        <MentionMenu mentions={mentions} />
        <textarea
          aria-label={t('comments.editField')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            mentions.refresh();
          }}
          onClick={mentions.refresh}
          onKeyDown={(e) => mentions.onKeyDown(e)}
          onPaste={onPasteImage}
          ref={textRef}
          rows={2}
          autoFocus
          className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {drafts.length > 0 && <AttachmentDraftList drafts={drafts} onRemove={drop} />}
      <div className="mt-1 flex items-center justify-between">
        <input
          ref={fileRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            if (fileRef.current) fileRef.current.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title={t('comments.attachImage')}
          aria-label={t('comments.attachImage')}
          className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ImagePlus size={15} />
        </button>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || edit.isPending || (!text.trim() && drafts.length === 0)}
            className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            <Check size={12} /> {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
