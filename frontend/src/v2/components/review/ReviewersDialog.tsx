// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import Avatar from '../Avatar';
import PeopleList from '../people/PeopleList';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { initialsFrom } from '../../lib/initials';
import { assigneeName } from '../../lib/assigneeName';
import { useProjectMembers } from '../../lib/useProjectRole';
import { noteIssue, toNotePayload } from '../../lib/reviewRequestRule';
import type { ReviewRequestRule } from '../../types/api';
import type { ReviewAssignee } from '../../types/entities';
import { useT } from '../../i18n';

/** One row of the dialog: a person, and the brief written for them. */
interface Draft {
  userId: number;
  name: string;
  avatarUrl: string | null;
  note: string;
}

/**
 * Entrusting the review AT PUBLICATION TIME.
 *
 * The decision dialog (`ReviewAssignees`) is the supervisor's place, after the fact. This one is the uploader's place: they
 * have just delivered, they know what there is to look at, and that is where the brief is worth most. It is also the moment
 * the "mandatory brief on upload" setting targets.
 *
 * The list is composed entirely before being sent, unlike the immediate writing of the other screen: here nothing is
 * published yet, and the main button does both at once. A save per click would have placed assignments on a version one
 * may still decide not to publish.
 *
 * The brief is **per person**: "the lighting" for the lead lighting and "the match at 1042" for the editor are two different
 * requests. Adding a second name starts from the brief just written, so that "the same for all three" stays a single
 * keystroke.
 */
export default function ReviewersDialog({
  open,
  onOpenChange,
  projectId,
  reviewers,
  rule,
  submitLabel,
  title,
  description,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /** The starting state: what the version already carries. */
  reviewers: ReviewAssignee[];
  rule: ReviewRequestRule;
  /** Label of the main button: it is the one that publishes. */
  submitLabel: string;
  title: string;
  description: string;
  busy?: boolean;
  onSubmit: (reviewers: { userId: number; note: string | null }[]) => void | Promise<void>;
}) {
  const t = useT();
  const people = useProjectMembers(projectId);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    reviewers.map((person) => ({
      userId: person.id,
      name: assigneeName(person),
      avatarUrl: person.avatarUrl,
      note: person.note ?? '',
    })),
  );
  const [picking, setPicking] = useState(false);

  const add = (person: { id: number; name: string; avatarUrl?: string | null }) => {
    setDrafts((current) =>
      current.some((d) => d.userId === person.id)
        ? current
        : [
            ...current,
            {
              userId: person.id,
              name: person.name,
              avatarUrl: person.avatarUrl ?? null,
              // The brief of the previous row: the usual case is "the same three eyes on the same thing", and retyping
              // the sentence discourages writing anything at all.
              note: current[current.length - 1]?.note ?? '',
            },
          ],
    );
    setPicking(false);
  };

  const setNote = (userId: number, note: string) =>
    setDrafts((current) => current.map((d) => (d.userId === userId ? { ...d, note } : d)));

  const ready = drafts.every((d) => noteIssue(d.note, rule) === null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="custom-scrollbar max-h-[22rem] space-y-3 overflow-y-auto">
          {drafts.length === 0 && !picking && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              {t('reviewers.none')}
            </p>
          )}

          {drafts.map((draft) => {
            const issue = noteIssue(draft.note, rule);
            return (
              <div key={draft.userId} className="rounded-md border border-border p-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    seed={draft.userId}
                    initials={initialsFrom(draft.name)}
                    avatarUrl={draft.avatarUrl}
                    size={26}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{draft.name}</span>
                  <button
                    type="button"
                    onClick={() => setDrafts((c) => c.filter((d) => d.userId !== draft.userId))}
                    aria-label={t('reviewers.remove', { name: draft.name })}
                    title={t('reviewers.remove', { name: draft.name })}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <Textarea
                  autoGrow
                  minRows={2}
                  maxRows={6}
                  className="mt-2"
                  value={draft.note}
                  onChange={(e) => setNote(draft.userId, e.target.value)}
                  placeholder={t('reviewers.notePlaceholder')}
                  aria-label={t('reviewers.noteLabel', { name: draft.name })}
                  aria-invalid={issue !== null}
                />
                {/* What is missing, stated with the project's figure: "too short" without the floor forces one to guess how
                    many are needed. */}
                {issue && (
                  <p className="mt-1 text-xs text-destructive">
                    {issue === 'missing'
                      ? t('reviewers.noteRequired')
                      : t('reviewers.noteTooShort', { min: rule.minNoteLength })}
                  </p>
                )}
              </div>
            );
          })}

          {picking ? (
            <PeopleList people={people} excludeIds={drafts.map((d) => d.userId)} onPick={add} />
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => setPicking(true)}>
              <UserPlus size={14} />
              {t('reviewers.add')}
            </Button>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!ready || busy}
            onClick={() =>
              void onSubmit(drafts.map((d) => ({ userId: d.userId, note: toNotePayload(d.note) })))
            }
          >
            {submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
