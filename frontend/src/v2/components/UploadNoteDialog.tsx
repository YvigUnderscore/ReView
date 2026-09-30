// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useUploadNoteStore } from '../../stores/useUploadNoteStore';
import { noteIssue, toNotePayload } from '../lib/reviewRequestRule';
import type { ReviewRequestRule } from '../types/api';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { useT } from '../i18n';

/**
 * La saisie elle-même. Composant à part pour une raison précise : il est **monté à chaque
 * dépôt retenu**, et son champ repart donc vide sans qu'un effet ait à le remettre à zéro —
 * la consigne du dépôt précédent ne concerne pas celui-ci.
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
 * La consigne demandée avant l'envoi, quand le projet l'exige.
 *
 * Monté une seule fois, avec le widget d'upload : le dépôt part de cinq endroits, et cinq
 * copies du même dialogue auraient fini par diverger. La file retient le geste, celui-ci
 * pose la question, et le bouton reste fermé tant que la consigne ne convient pas — c'est
 * là, et pas dans un toast d'erreur, que « sans message, rien ne part » se lit.
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
