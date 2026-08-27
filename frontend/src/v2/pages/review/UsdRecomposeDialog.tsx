// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { UsdModelInfo, UsdPurpose, UsdVariantSelection } from '../../types/api';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { initialSelection, purposeLabel, variantValue } from './usdDisplay';
import { useT, type MessageKey } from '../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

/**
 * Recomposition d'une scène USD (Phase 45, 45.F) : rejouer la conversion avec une autre
 * sélection de variantes ou un autre purpose. Le fichier d'origine n'est pas touché — le
 * serveur applique la sélection via une couche d'overlay USD, puis reconvertit.
 *
 * Ouverte depuis la fiche technique, au contact des variantes qu'elle modifie.
 */

const purposes = (t: Tr): { value: UsdPurpose; label: string; hint: string }[] => [
  { value: 'render', label: purposeLabel('render'), hint: t('usd.renderGeom') },
  { value: 'proxy', label: purposeLabel('proxy'), hint: t('usd.proxyGeom') },
  { value: 'guide', label: purposeLabel('guide'), hint: t('usd.guideGeom') },
];

export default function UsdRecomposeDialog({
  open,
  onOpenChange,
  mediaId,
  usd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mediaId: number;
  usd: UsdModelInfo;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [purpose, setPurpose] = useState<UsdPurpose>(usd.selection.purpose);
  const [variants, setVariants] = useState<UsdVariantSelection>(() => initialSelection(usd));

  const choose = (prim: string, name: string, value: string) =>
    setVariants((v) => ({ ...v, [prim]: { ...(v[prim] ?? {}), [name]: value } }));

  const submit = () => {
    setBusy(true);
    api
      .post(`/api/media/${mediaId}/usd/recompose`, { variants, purpose })
      .then(() => {
        toast.success(t('review.usd.recomposeStarted'));
        void qc.invalidateQueries({ queryKey: qk.media(mediaId) });
        onOpenChange(false);
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : t('common.error.recompose')))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('review.usd.recompose')}</DialogTitle>
          <DialogDescription>{t('usd.recomposeHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t('usd.purpose')}</span>
            <Select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as UsdPurpose)}
              title={purposes(t).find((p) => p.value === purpose)?.hint}
            >
              {purposes(t).map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>

          {usd.variantSets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('review.usd.noVariants')}</p>
          ) : (
            usd.variantSets.map((set) => (
              <label
                key={`${set.prim}-${set.name}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0 truncate text-muted-foreground" title={set.prim}>
                  {set.name}
                </span>
                <Select
                  value={variantValue(variants, set.prim, set.name, set.selected)}
                  onChange={(e) => choose(set.prim, set.name, e.target.value)}
                >
                  {set.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              </label>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? t('common.starting') : t('usd.recomposeFrom')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
