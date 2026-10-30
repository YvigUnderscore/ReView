// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import Avatar from '../Avatar';
import { Textarea } from '../ui/textarea';
import { initialsFrom } from '../../lib/initials';
import { assigneeName } from '../../lib/assigneeName';
import type { AssigneeRef } from '../../types/entities';
import { noteIssue, toNotePayload } from '../../lib/reviewRequestRule';
import type { ReviewRequestRule } from '../../types/api';
import { useT } from '../../i18n';

/**
 * A person entrusted, and the brief written FOR THEM.
 *
 * The brief is per person, not per version: "the lighting" for the lead lighting and "the match at 1042" for the editor are
 * two different requests, and piling them into a shared field makes neither legible.
 *
 * Saved on leaving the field, never on each keystroke: a brief is thought over, and notifying the person at every letter
 * typed would be unbearable for them. Escape restores what was there, which is what makes the field safe to try.
 *
 * The same component serves the person ALREADY entrusted and the one placed on hold while their mandatory brief is being
 * written (`staged`): the second case has nothing to save as long as the brief is not right, hence the explicit tick.
 */
export default function ReviewerNoteField({
  person,
  rule,
  busy,
  staged,
  onSave,
  onCancel,
}: {
  /** The person, and their brief. `Partial`: a person placed on hold only has their identifier and name so far,
   *  not the full record the server returns. */
  person: Partial<AssigneeRef> & { id: number; note: string | null };
  rule: ReviewRequestRule;
  busy?: boolean;
  /** Person not yet entrusted: nothing is written as long as the brief is not right. */
  staged?: boolean;
  onSave: (note: string | null) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(person.note ?? '');
  // `assigneeName` expects the full record; absent fields are `null` for it.
  const name = assigneeName({
    id: person.id,
    name: person.name ?? null,
    firstName: person.firstName ?? null,
    lastName: person.lastName ?? null,
    username: person.username ?? null,
    avatarUrl: person.avatarUrl ?? null,
  });
  const issue = noteIssue(draft, rule);
  const dirty = (person.note ?? '') !== draft;

  const commit = () => {
    if (issue || busy) return;
    if (staged || dirty) onSave(toNotePayload(draft));
  };

  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <Avatar
          seed={person.id}
          initials={initialsFrom(name)}
          avatarUrl={person.avatarUrl ?? null}
          size={22}
        />
        <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
        {staged && (
          <>
            <button
              type="button"
              disabled={!!issue || busy}
              onClick={commit}
              aria-label={t('reviewers.confirm')}
              title={t('reviewers.confirm')}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              onClick={onCancel}
              aria-label={t('common.cancel')}
              title={t('common.cancel')}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X size={13} />
            </button>
          </>
        )}
      </div>
      <Textarea
        autoGrow
        minRows={1}
        maxRows={5}
        autoFocus={staged}
        className="mt-1.5 text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => !staged && commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDraft(person.note ?? '');
        }}
        placeholder={t('reviewers.notePlaceholder')}
        aria-label={t('reviewers.noteLabel', { name })}
        aria-invalid={issue !== null}
      />
      {/* What is missing, stated with the project's figure: "too short" without the floor forces one to guess how many
          are needed. */}
      {issue && (
        <p className="mt-1 text-2xs text-destructive">
          {issue === 'missing'
            ? t('reviewers.noteRequired')
            : t('reviewers.noteTooShort', { min: rule.minNoteLength })}
        </p>
      )}
    </div>
  );
}
