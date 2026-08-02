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
import { initialSelection, variantValue } from './usdDisplay';
import { useT } from '../../i18n';

/**
 * Recomposition d'une scène USD (Phase 45, 45.F) : rejouer la conversion avec une autre
 * sélection de variantes ou un autre purpose. Le fichier d'origine n'est pas touché — le
 * serveur applique la sélection via une couche d'overlay USD, puis reconvertit.
 *
 * Ouverte depuis la fiche technique, au contact des variantes qu'elle modifie.
 */

const PURPOSES: { value: UsdPurpose; label: string; hint: string }[] = [
  { value: 'render', label: 'Rendu', hint: 'Géométrie de rendu (défaut)' },
  { value: 'proxy', label: 'Proxy', hint: 'Géométrie allégée d’affichage' },
  { value: 'guide', label: 'Guide', hint: 'Aides de mise en scène' },
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
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Recomposition impossible'))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('review.usd.recompose')}</DialogTitle>
          <DialogDescription>
            La scène est reconvertie avec cette sélection. Le fichier USD d’origine n’est pas modifié.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Purpose</span>
            <Select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as UsdPurpose)}
              title={PURPOSES.find((p) => p.value === purpose)?.hint}
            >
              {PURPOSES.map((p) => (
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
            Annuler
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Lancement…' : 'Recomposer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
