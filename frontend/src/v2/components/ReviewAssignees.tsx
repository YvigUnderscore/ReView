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
 * À qui la review de cette version est confiée (Phase 49), et **ce que chacun doit y
 * regarder**.
 *
 * La décision de review disait ce qu'on avait conclu d'une livraison ; rien ne disait à
 * qui on demandait de la regarder. Ça se disait de vive voix, et l'artiste comme le
 * superviseur perdaient la trace de la file en cours. C'est le même geste que
 * « responsables d'un plan » et il en reprend la forme — mêmes visages, même annuaire
 * cherchable — pour que l'assignation se lise partout de la même façon.
 *
 * Il y manquait la moitié utile : savoir qu'on est attendu sans savoir SUR QUOI ne fait
 * gagner du temps qu'à celui qui assigne. Chaque personne confiée porte donc une consigne,
 * modifiable ici à tout moment — c'est l'endroit où l'on rattrape celle qu'on a oubliée.
 *
 * Écriture immédiate : cliquer un nom l'ajoute, le recliquer le retire, une consigne se
 * range en quittant son champ. Un bouton « Enregistrer » aurait ajouté un pied de page à
 * une modale qui en a déjà un, et une liste à cocher dont on peut sortir sans valider ment
 * sur son état. Quand le projet EXIGE la consigne, la personne est mise en attente le temps
 * qu'on l'écrive : l'assigner d'abord pour se faire refuser ensuite serait une fausse
 * promesse.
 */
export default function ReviewAssignees({
  versionId,
  projectId,
  canAssign,
  enabled = true,
}: {
  versionId: number;
  /** Restreint l'annuaire aux membres du projet — le serveur refuse les autres de toute façon. */
  projectId?: number;
  /** Seul un gestionnaire du projet, ou l'auteur de la version, répartit les reviews. */
  canAssign: boolean;
  /** Laissé à `false` tant que la modale porteuse est fermée : rien n'est demandé. */
  enabled?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  // Personne choisie dont on attend la consigne, quand le projet l'exige.
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
    // L'encart « Assigned to me » de la page Reviews lit la même donnée : sans cette
    // invalidation, la personne qu'on vient d'assigner ne la verrait qu'au rechargement.
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

  /** L'état courant, tel qu'on le renvoie au serveur — consignes comprises. */
  const current = () => reviewers.map((p) => ({ userId: p.id, note: p.note ?? null }));

  const toggle = (person: { id: number; name: string }) => {
    const assigned = reviewers.some((p) => p.id === person.id);
    if (assigned) {
      setPendingId(person.id);
      save.mutate(current().filter((entry) => entry.userId !== person.id));
      return;
    }
    // Consigne obligatoire : on met la personne en attente au lieu de l'assigner pour se
    // faire refuser. Sinon, le geste reste d'un seul clic.
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
        // Confier quelqu'un, c'est pouvoir lui dire quoi regarder : l'un ne va pas sans
        // l'autre, donc la consigne s'édite là où la liste se compose.
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
