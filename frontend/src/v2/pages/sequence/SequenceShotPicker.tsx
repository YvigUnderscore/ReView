// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { qk } from '../../lib/query';
import { useShotsQuery } from '../../lib/queries';
import { bulkMoveShots } from '../../lib/bulkApi';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SkeletonRows } from '../../components/ui/skeleton';
import PickGrid from '../../components/entity/PickGrid';
import { attachableShots, attachRefusal, movedFromOtherSequence } from './shotAssign';
import { useT } from '../../i18n';

/**
 * Attaches existing shots to the open sequence.
 *
 * Selection is by thumbnail, as for assigning an asset: "SH0120" does not say which shot it is,
 * the image does. The two origins stay separate — free shots on one side, shots belonging to
 * another sequence on the other — and the footer announces how many will *leave* their sequence,
 * because the gesture undoes a sequence assignment elsewhere without the user having opened it.
 */
export default function SequenceShotPicker({
  projectId,
  sequenceId,
  canManage,
  onDone,
  onCancel,
}: {
  projectId: number;
  sequenceId: number;
  canManage: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // All pages: otherwise the 101st shot of the project would stay unattachable.
  const shotsQ = useShotsQuery(projectId, projectId > 0, { all: true });
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shots = useMemo(() => shotsQ.data ?? [], [shotsQ.data]);
  const groups = useMemo(() => attachableShots(shots, sequenceId, query), [shots, sequenceId, query]);
  const nothingToAttach = groups.free.length === 0 && groups.elsewhere.length === 0 && !query;
  const leaving = movedFromOtherSequence(shots, picked);

  const toggle = (id: number) => {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const attach = async () => {
    const refusal = attachRefusal(canManage, picked.size);
    if (refusal) {
      setError(refusal === 'forbidden' ? t('sequenceShots.forbidden') : t('sequenceShots.pickNone'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { count } = await bulkMoveShots([...picked], sequenceId);
      toast.success(t('sequenceShots.attached', { count }));
      // The move also touches the origin sequence and the project counters: invalidating only
      // the open sequence would leave the other one lying.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['sequence'] }),
        qc.invalidateQueries({ queryKey: qk.shots(projectId) }),
        qc.invalidateQueries({ queryKey: qk.sequences(projectId) }),
      ]);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="relative mb-3">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="h-8 pl-8 text-xs"
          placeholder={t('shots.searchPlaceholder')}
          aria-label={t('shots.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      {shotsQ.error && <p className="mb-2 text-xs text-destructive">{shotsQ.error.message}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {/* `isComplete` rather than `isPending`: while the pages are still chaining, "no shot to
            attach" would be a lie about a half-loaded list. */}
        {!shotsQ.isComplete ? (
          <SkeletonRows count={3} />
        ) : nothingToAttach ? (
          <p className="text-xs text-muted-foreground">{t('sequenceShots.noneToAttach')}</p>
        ) : (
          <div className="space-y-4">
            <PickerGroup
              title={t('sequenceShots.free')}
              items={groups.free}
              picked={picked}
              onToggle={toggle}
              emptyLabel={t('sequenceShots.noFree')}
            />
            <PickerGroup
              title={t('sequenceShots.elsewhere')}
              items={groups.elsewhere}
              picked={picked}
              onToggle={toggle}
              emptyLabel={t('sequenceShots.noElsewhere')}
            />
          </div>
        )}
      </div>

      {/* Say what is going to happen, not just how many: a shot taken from elsewhere leaves its
          sequence, and nothing on screen would show it otherwise. */}
      {leaving > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t('sequenceShots.moveWarning', { count: leaving })}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button variant="outline" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" onClick={() => void attach()} disabled={busy || picked.size === 0 || !canManage}>
          {busy ? t('common.saving') : t('sequenceShots.attachCount', { count: picked.size })}
        </Button>
      </div>
    </div>
  );
}

/** One origin group: its title, its thumbnails, its own empty state. */
function PickerGroup({
  title,
  items,
  picked,
  onToggle,
  emptyLabel,
}: {
  title: string;
  items: { id: number; code: string; name: string; thumbnailUrl?: string | null }[];
  picked: Set<number>;
  onToggle: (id: number) => void;
  emptyLabel: string;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <PickGrid
        items={items.map((s) => ({
          id: s.id,
          label: s.code,
          hint: s.name !== s.code ? s.name : null,
          thumbnailUrl: s.thumbnailUrl,
        }))}
        selected={picked}
        onToggle={onToggle}
        emptyLabel={emptyLabel}
      />
    </div>
  );
}
