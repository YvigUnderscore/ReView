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
 * Asset creation: extracted from the tab, which exceeded its line budget once the enriched cards
 * were in place. The form had no reason to live there: it shares nothing with the list, except the
 * reload that follows.
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
    // The form is cleared only if the write succeeded: otherwise the user would have to retype a
    // name the caller has just flagged as already taken.
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
