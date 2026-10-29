// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useUploadNoteStore } from '../stores/useUploadNoteStore';
import { noteIssue, toNotePayload } from '../lib/reviewRequestRule';
import type { ReviewRequestRule } from '../types/api';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { useT } from '../i18n';

/**
 * The input itself. A separate component for a precise reason: it is **mounted for each**
 * retained drop, so its field starts empty without an effect having to reset it,
 * and the previous drop's instruction does not concern this one.
 */
function NoteForm({
  rule,
  onSubmit,
  onCancel,
}: {
  rule: ReviewRequestRule;
  onSubmit: (note: string | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState('');
  const issue = noteIssue(note, rule);

  return (
    <>
      <Textarea
        autoGrow
        autoFocus
        minRows={3}
        maxRows={8}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('reviewers.notePlaceholder')}
        aria-label={t('upload.note.title')}
        aria-invalid={issue !== null}
      />
      {/* Ce qui manque, dit avec le chiffre du projet — « trop courte » sans le plancher
          oblige à deviner combien il en faut. */}
      {issue && (
        <p className="text-xs text-destructive">
          {issue === 'missing'
            ? t('reviewers.noteRequired')
            : t('reviewers.noteTooShort', { min: rule.minNoteLength })}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" disabled={issue !== null} onClick={() => onSubmit(toNotePayload(note))}>
          {t('common.upload')}
        </Button>
      </div>
    </>
  );
}

/**
 * The instruction requested before sending, when the project requires it.
 *
 * Mounted once, with the upload widget: the drop leaves from five places, and five
 * copies of the same dialog would have ended up diverging. The queue holds the gesture, this one
 * asks the question, and the button stays closed until the instruction is acceptable. That is
 * where "without a message, nothing goes out" is read, and not in an error toast.
 */
export default function UploadNoteDialog() {
  const t = useT();
  const pending = useUploadNoteStore((s) => s.pending);
  const submit = useUploadNoteStore((s) => s.submit);
  const cancel = useUploadNoteStore((s) => s.cancel);

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('upload.note.title')}</DialogTitle>
          <DialogDescription>{t('upload.note.hint')}</DialogDescription>
        </DialogHeader>
        {pending && <NoteForm rule={pending.rule} onSubmit={submit} onCancel={cancel} />}
      </DialogContent>
    </Dialog>
  );
}
