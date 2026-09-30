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
 * Une personne confiée, et la consigne écrite POUR ELLE.
 *
 * La consigne est par personne, pas par version : « la lumière » au lead lighting et « le
 * raccord au 1042 » au monteur sont deux demandes différentes, et les entasser dans un
 * champ commun n'en rend aucune lisible.
 *
 * Enregistrement en quittant le champ, jamais à chaque frappe : une consigne se réfléchit,
 * et prévenir la personne à chaque lettre tapée serait insupportable pour elle. Échap
 * remet ce qui était là — c'est ce qui rend le champ essayable.
 *
 * Le même composant sert la personne DÉJÀ confiée et celle qu'on met en attente le temps
 * d'écrire sa consigne obligatoire (`staged`) : le second cas n'a rien à enregistrer tant
 * que la consigne ne convient pas, d'où la coche explicite.
 */
export default function ReviewerNoteField({
  person,
  rule,
  busy,
  staged,
  onSave,
  onCancel,
}: {
  /** La personne, et sa consigne. `Partial` : une personne mise en attente n'a encore
   *  que son identifiant et son nom, pas la fiche complète que rend le serveur. */
  person: Partial<AssigneeRef> & { id: number; note: string | null };
  rule: ReviewRequestRule;
  busy?: boolean;
  /** Personne pas encore confiée : rien n'est écrit tant que la consigne ne convient pas. */
  staged?: boolean;
  onSave: (note: string | null) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(person.note ?? '');
  // `assigneeName` attend la fiche complète ; les champs absents valent `null` pour lui.
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
      {/* Ce qui manque, dit avec le chiffre du projet — « trop courte » sans le plancher
          oblige à deviner combien il en faut. */}
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
