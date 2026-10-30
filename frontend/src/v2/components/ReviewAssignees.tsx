// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { assigneeName } from '../lib/assigneeName';
import { useProjectMembers } from '../lib/useProjectRole';
import { toNotePayload, useReviewRequestRule } from '../lib/reviewRequestRule';
import PeopleList from './people/PeopleList';
import ReviewerNoteField from './review/ReviewerNoteField';
import AssigneeStack from './entity/AssigneeStack';
import type { ReviewAssignee } from '../types/entities';
import { useT } from '../i18n';

/**
 * Who the review of this version is entrusted to (Phase 49), and **what each one must look at**.
 * regarder**.
 *
 * The review decision said what had been concluded from a delivery; nothing said
 * who was asked to look at it. It was said by word of mouth, and the artist as well as
 * the supervisor lost track of the queue in progress. This is the same gesture as
 * "shot owners", and it takes its form: same faces, same searchable directory,
 * so that assignment reads the same way everywhere.
 *
 * It lacked the useful half: knowing that one is expected, without knowing ON WHAT, only saves
 * time for whoever assigns. Each entrusted person therefore carries an instruction,
 * editable here at any moment: this is where one catches up the one that was forgotten.
 *
 * Immediate write: clicking a name adds it, clicking it again removes it, and an instruction is
 * saved when leaving its field. A "Save" button would have added a footer to
 * a modal that already has one, and a checklist one can leave without confirming misleads
 * about its state. When the project REQUIRES the instruction, the person is put on hold while
 * it is written: assigning them first, only to be refused afterwards, would be a false promise.
 * promesse.
 */
export default function ReviewAssignees({
  versionId,
  projectId,
  canAssign,
  enabled = true,
}: {
  versionId: number;
  /** Restricts the directory to project members: the server refuses the others anyway. */
  projectId?: number;
  /** Only a project manager, or the author of the version, distributes reviews. */
  canAssign: boolean;
  /** Left at `false` while the hosting modal is closed: nothing is requested. */
  enabled?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  // Person chosen whose instruction we are waiting for, when the project requires it.
  const [staged, setStaged] = useState<{ id: number; name: string } | null>(null);
  const members = useProjectMembers(projectId ?? 0);
  const rule = useReviewRequestRule(projectId, enabled);

  const reviewersQ = useQuery({
    queryKey: qk.versionReviewers(versionId),
    queryFn: () =>
      api
        .get<{ reviewers: ReviewAssignee[] }>(`/api/versions/${versionId}/reviewers`)
        .then((d) => d.reviewers),
    enabled,
  });
  const reviewers = reviewersQ.data ?? [];

  const store = (people: ReviewAssignee[]) => {
    qc.setQueryData(qk.versionReviewers(versionId), people);
    // The "Assigned to me" block of the Reviews page reads the same data: without this
    // invalidation, the person we have just assigned would only see it on reload.
    void qc.invalidateQueries({ queryKey: ['reviews'] });
  };
  const failed = (err: unknown) =>
    toast.error(err instanceof Error ? err.message : t('common.error.generic'));

  const save = useMutation({
    mutationFn: (entries: { userId: number; note: string | null }[]) =>
      api
        .put<{ reviewers: ReviewAssignee[] }>(`/api/versions/${versionId}/reviewers`, { reviewers: entries })
        .then((d) => d.reviewers),
    onSuccess: (people) => {
      store(people);
      setStaged(null);
      toast.success(t('reviewers.saved', { count: people.length }));
    },
    onError: failed,
    onSettled: () => setPendingId(null),
  });

  const saveNote = useMutation({
    mutationFn: ({ userId, note }: { userId: number; note: string | null }) =>
      api
        .patch<{
          reviewers: ReviewAssignee[];
        }>(`/api/versions/${versionId}/reviewers/${userId}`, { note })
        .then((d) => d.reviewers),
    onSuccess: store,
    onError: failed,
  });

  /** The current state, as sent back to the server, instructions included. */
  const current = () => reviewers.map((p) => ({ userId: p.id, note: p.note ?? null }));

  const toggle = (person: { id: number; name: string }) => {
    const assigned = reviewers.some((p) => p.id === person.id);
    if (assigned) {
      setPendingId(person.id);
      save.mutate(current().filter((entry) => entry.userId !== person.id));
      return;
    }
    // Mandatory instruction: we put the person on hold instead of assigning them, so as not to
    // get refused. Otherwise the gesture remains a single click.
    if (rule.requireNote) {
      setStaged(person);
      setPicking(false);
      return;
    }
    setPendingId(person.id);
    save.mutate([...current(), { userId: person.id, note: null }]);
  };

  const confirmStaged = (note: string) => {
    if (!staged) return;
    setPendingId(staged.id);
    save.mutate([...current(), { userId: staged.id, note: toNotePayload(note) }]);
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold section-label text-muted-foreground">
          {t('reviewers.title')}
        </span>
        {canAssign && (
          <button
            type="button"
            onClick={() => {
              setStaged(null);
              setPicking((open) => !open);
            }}
            aria-expanded={picking}
            className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {picking ? <X size={13} /> : <UserPlus size={13} />}
            {picking ? t('common.close') : t('reviewers.assign')}
          </button>
        )}
      </div>

      {reviewers.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('reviewers.none')}</p>
      ) : canAssign ? (
        // Entrusting someone means being able to tell them what to look at: one does not go without
        // the other, so the instruction is edited where the list is composed.
        <div className="space-y-2">
          {reviewers.map((person) => (
            <ReviewerNoteField
              key={person.id}
              person={person}
              rule={rule}
              busy={pendingId === person.id}
              onSave={(note) => saveNote.mutate({ userId: person.id, note })}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <AssigneeStack people={reviewers} size={22} />
            {/* Sans consigne, une seule ligne de noms suffit ; dès qu'il y en a une, chaque
                personne prend sa ligne — sinon le nom s'écrirait deux fois, une fois dans
                la liste et une fois devant sa consigne. */}
            {reviewers.every((person) => !person.note) && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {reviewers.map(assigneeName).join(', ')}
              </span>
            )}
          </div>
          {reviewers.some((person) => person.note) &&
            reviewers.map((person) => (
              <p key={person.id} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{assigneeName(person)}</span>
                {person.note ? ` — ${person.note}` : ''}
              </p>
            ))}
        </div>
      )}

      {staged && canAssign && (
        <ReviewerNoteField
          person={{ ...staged, note: null }}
          rule={rule}
          busy={pendingId === staged.id}
          staged
          onCancel={() => setStaged(null)}
          onSave={(note) => confirmStaged(note ?? '')}
        />
      )}

      {picking && canAssign && (
        <PeopleList
          people={members}
          selectedIds={reviewers.map((p) => p.id)}
          pendingId={pendingId}
          onPick={(person) => toggle(person)}
        />
      )}
    </div>
  );
}
