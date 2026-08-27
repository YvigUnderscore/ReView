// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import {
  ATTACHMENT_ACCEPT,
  MAX_COMMENT_ATTACHMENTS,
  uploadCommentAttachments,
} from '../../../lib/commentAttachments';
import { useImagePaste } from '../../lib/useImagePaste';
import { useMentions } from './useMentions';
import MentionMenu from './MentionMenu';
import { useT } from '../../i18n';

/** Zone de réponse à un commentaire (texte + images jointes, paste CTRL+V, 8 max). */
export default function ReplyComposer({
  mediaObjectId,
  parentId,
  onSent,
  onCancel,
}: {
  mediaObjectId: number;
  parentId: number;
  onSent: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Autocomplete des mentions @membre (32.B).
  const mentions = useMentions(text, setText, textRef);

  const addFiles = (add: File[]) => {
    if (files.length + add.length > MAX_COMMENT_ATTACHMENTS)
      toast.warning(t('comment.maxAttachments', { count: MAX_COMMENT_ATTACHMENTS }));
    setFiles((fs) => [...fs, ...add].slice(0, MAX_COMMENT_ATTACHMENTS));
  };
  const onPasteImage = useImagePaste(addFiles);

  const send = async () => {
    if (!text.trim() && files.length === 0) return;
    setBusy(true);
    try {
      const attachments = files.length > 0 ? await uploadCommentAttachments(files) : undefined;
      await api.post('/api/comments', { mediaObjectId, parentId, content: text || '(image)', attachments });
      setText('');
      setFiles([]);
      onSent();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-background p-2">
      <div className="relative">
        <MentionMenu mentions={mentions} />
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            mentions.refresh();
          }}
          onClick={mentions.refresh}
          onKeyDown={(e) => mentions.onKeyDown(e)}
          onPaste={onPasteImage}
          rows={2}
          placeholder={t('comments.reply.placeholder')}
          aria-label={t('comments.reply.placeholder')}
          className="w-full resize-none bg-transparent text-sm"
        />
      </div>
      {files.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {files.map((f, i) => (
            <span key={i} className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-2xs">
              {f.name}
              <button onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
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
            onClick={() => fileRef.current?.click()}
            title={t('comments.attachImage')}
            className="rounded p-1.5 text-muted-foreground hover:bg-secondary"
          >
            <ImagePlus size={15} />
          </button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onCancel}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={send}
            disabled={busy}
            className="rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            {t('comments.reply2')}
          </button>
        </div>
      </div>
    </div>
  );
}
