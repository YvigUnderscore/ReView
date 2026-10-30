// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link2, Link2Off, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '../ui/select';
import { useLinkSgAccount, useSgCrew } from '../../lib/shotgridCrewApi';
import { useT } from '../../i18n';

/**
 * A member's ShotGrid account.
 *
 * Automatic matching is done by email address and covers the common case. But a studio
 * always has a few people whose address differs between tools (for example
 * `firstname.lastname@studio.com` on one side and a personal address on the other).
 * Those accounts stayed unlinked forever: their writes went to the site as an anonymous
 * "ReView" user, and the team import kept suggesting them again.
 *
 * The remote list is only requested once the selector is first opened: querying the site
 * for each member when the tab opens would cost one round trip per person.
 */
export default function SgAccountLink({ projectId, userId }: { projectId: number; userId: number }) {
  const t = useT();
  const [asked, setAsked] = useState(false);
  const { data, isLoading } = useSgCrew(projectId, asked);
  const link = useLinkSgAccount(projectId);

  const crew = data?.crew ?? [];
  const current = crew.find((p) => p.userId === userId);

  if (!asked) {
    return (
      <button
        type="button"
        onClick={() => setAsked(true)}
        title={t('shotgrid.link.open')}
        aria-label={t('shotgrid.link.open')}
        className="flex h-7 items-center gap-1 rounded border border-border px-1.5 text-2xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        <Link2 size={13} /> {t('shotgrid.link.open')}
      </button>
    );
  }

  if (isLoading) {
    return (
      <span className="flex h-7 items-center gap-1 px-1.5 text-2xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" /> {t('common.loading')}
      </span>
    );
  }

  const change = (value: string) => {
    const sgId = value ? Number(value) : null;
    // Unlinking: the currently linked account is the one to name, not the new one.
    const target = sgId ?? current?.sgId ?? null;
    if (target === null) return;
    link.mutate(
      { sgId: target, userId: sgId === null ? null : userId },
      {
        onSuccess: () => toast.success(sgId === null ? t('shotgrid.link.cleared') : t('shotgrid.link.done')),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : t('common.error.generic')),
      },
    );
  };

  return (
    <span className="flex items-center gap-1">
      <Select
        className="max-w-44 py-1 text-2xs"
        value={current ? String(current.sgId) : ''}
        disabled={link.isPending}
        onChange={(e) => change(e.target.value)}
        title={t('shotgrid.link.open')}
      >
        <option value="">{t('shotgrid.link.none')}</option>
        {crew.map((person) => (
          <option key={person.sgId} value={person.sgId}>
            {person.name}
            {person.email ? ` · ${person.email}` : ''}
          </option>
        ))}
      </Select>
      {current?.linkedByHand && (
        <span title={t('shotgrid.link.byHand')} className="text-muted-foreground">
          <Link2Off size={12} />
        </span>
      )}
    </span>
  );
}
