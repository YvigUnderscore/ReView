// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { AlertTriangle, Loader2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../i18n';
import { Button } from '../ui/button';
import { useInviteSgCrew, useSgCrew } from '../../lib/shotgridCrewApi';
import { invitableOf, isInvitable, splitOutcome, summarize } from './crewSelection';
import type { SgCrewPerson } from '../../types/shotgrid';

/**
 * L'équipe du projet ShotGrid, et son accès à ReView.
 *
 * Relier un projet apportait ses plans et ses médias, mais pas les gens : il fallait
 * ressaisir chaque adresse dans l'écran d'administration, puis rattacher chacun au projet.
 * Ici, la liste vient du site et un clic donne l'accès — compte créé si besoin,
 * invitation envoyée, rattachement au projet fait.
 *
 * Le chargement est explicite : la requête interroge le site distant, elle n'a pas à
 * partir dès qu'on ouvre l'onglet Membres.
 */
export default function SgCrewPanel({ projectId }: { projectId: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const { data, isLoading, error } = useSgCrew(projectId, open);
  const invite = useInviteSgCrew(projectId);

  const crew = data?.crew ?? [];
  const invitable = invitableOf(crew);
  const { willCreate, willAdd } = splitOutcome(crew, selected);
  // Un superviseur de projet peut rattacher un compte existant, pas en fabriquer un :
  // l'écran d'administration ne le lui permet pas davantage.
  const blocked = willCreate.length > 0 && data?.canCreateAccounts === false;

  const toggle = (sgId: number) =>
    setSelected((s) => (s.includes(sgId) ? s.filter((x) => x !== sgId) : [...s, sgId]));

  const submit = async () => {
    try {
      const results = await invite.mutateAsync(selected);
      const counts = summarize(results);
      toast.success(t('shotgrid.crew.done', { created: counts.created, added: counts.added }));
      if (counts.skipped > 0) toast.warning(t('shotgrid.crew.skipped', { count: counts.skipped }));
      setSelected([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('shotgrid.crew.failed'));
    }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Users size={14} /> {t('shotgrid.crew.load')}
      </Button>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-3">
      <header className="flex items-center gap-2">
        <h3 className="text-sm font-medium">{t('shotgrid.crew.title')}</h3>
        {isLoading && <Loader2 className="animate-spin text-muted-foreground" size={13} />}
      </header>
      <p className="text-xs text-muted-foreground">{t('shotgrid.crew.hint')}</p>

      {error && <p className="text-xs text-destructive">{error.message}</p>}

      {/* Sans relais courriel, l'invitation ne partirait pas : le dire avant, pas après. */}
      {data && !data.smtpReady && (
        <p className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          <AlertTriangle size={13} className="shrink-0" /> {t('shotgrid.crew.noSmtp')}
        </p>
      )}

      {crew.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {crew.map((person) => (
            <CrewRow
              key={person.sgId}
              person={person}
              checked={selected.includes(person.sgId)}
              onToggle={() => toggle(person.sgId)}
            />
          ))}
        </ul>
      )}

      {crew.length === 0 && !isLoading && !error && (
        <p className="text-xs text-muted-foreground">{t('shotgrid.crew.empty')}</p>
      )}

      {invitable.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {t('shotgrid.crew.plan', { create: willCreate.length, add: willAdd.length })}
          </span>
          <Button
            size="sm"
            disabled={selected.length === 0 || invite.isPending || blocked || data?.smtpReady === false}
            onClick={() => void submit()}
          >
            {invite.isPending ? <Loader2 className="animate-spin" size={14} /> : <UserPlus size={14} />}
            {t('shotgrid.crew.invite')}
          </Button>
        </div>
      )}
      {blocked && <p className="text-xs text-destructive">{t('shotgrid.crew.cannotCreate')}</p>}
    </section>
  );
}

const STATE_KEY = {
  member: 'shotgrid.crew.state.member',
  account: 'shotgrid.crew.state.account',
  none: 'shotgrid.crew.state.none',
  ineligible: 'shotgrid.crew.state.ineligible',
} as const;

function CrewRow({
  person,
  checked,
  onToggle,
}: {
  person: SgCrewPerson;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const selectable = isInvitable(person);
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={!selectable}
        onChange={onToggle}
        aria-label={person.name}
        className="size-3.5 shrink-0 accent-primary disabled:opacity-30"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{person.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {person.email ?? t('shotgrid.crew.noEmail')}
          {person.login && (
            <>
              {' · '}
              <code className="text-2xs">{person.login}</code>
            </>
          )}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-2xs ${
          person.state === 'member'
            ? 'bg-success/15 text-success'
            : person.state === 'ineligible'
              ? 'bg-muted text-muted-foreground'
              : 'bg-secondary text-foreground'
        }`}
      >
        {t(STATE_KEY[person.state])}
      </span>
    </li>
  );
}
