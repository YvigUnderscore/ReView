// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select } from '../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { ASSET_TYPES } from './projectTypes';
import type { AssetType } from '../../types/api';
import { useT } from '../../i18n';
import { assetTypeLabel } from '../../lib/entityTypeLabels';

/**
 * Création d'un asset — extraite de l'onglet, qui dépassait son budget de lignes une fois
 * les cartes enrichies posées. Le formulaire n'avait aucune raison d'y vivre : il ne
 * partage rien avec la liste, sinon le rechargement qui suit.
 */
export default function AssetCreateDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (asset: { name: string; type: AssetType }) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>('CHARACTER');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({ name, type });
    // Le formulaire se vide seulement si l'écriture a abouti : sinon on ferait ressaisir
    // un nom que l'appelant vient de signaler comme déjà pris.
    setName('');
    setType('CHARACTER');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>{t('assets.new')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label>{t('assets.name')}</Label>
            <Input
              autoFocus
              placeholder={t('assets.type.placeholder')}
              aria-label={t('assets.type.placeholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>{t('assets.type')}</Label>
            <Select className="w-full" value={type} onChange={(e) => setType(e.target.value as AssetType)}>
              {ASSET_TYPES.map((value) => (
                <option key={value} value={value}>
                  {assetTypeLabel(t, value)}
                </option>
              ))}
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm">
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
