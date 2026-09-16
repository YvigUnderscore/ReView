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
 * Rattacher des plans existants à la séquence ouverte.
 *
 * On choisit à la vignette, comme pour l'assignation d'un asset : « SH0120 » ne dit pas
 * quel plan c'est, l'image si. Les deux provenances restent séparées — les plans libres
 * d'un côté, ceux qui appartiennent à une autre séquence de l'autre — et le pied de page
 * annonce combien vont *quitter* leur séquence, parce que le geste défait un montage
 * ailleurs sans qu'on l'ait ouvert.
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
  // Toutes les pages : sinon le 101e plan du projet resterait irrattachable.
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
      // Le déplacement touche aussi la séquence de départ et les compteurs du projet :
      // invalider la seule séquence ouverte laisserait l'autre mentir.
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
        {/* `isComplete` plutôt que `isPending` : tant que les pages s'enchaînent, « aucun
            plan à rattacher » serait un mensonge sur une liste à moitié arrivée. */}
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

      {/* Dire ce qui va se passer, pas seulement combien : un plan pris ailleurs sort du
          montage de sa séquence, et rien à l'écran ne le montrerait autrement. */}
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

/** Un groupe de provenance : son titre, ses vignettes, son propre vide. */
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
