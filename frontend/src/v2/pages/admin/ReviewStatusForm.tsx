// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import type { ReviewStatus } from '../../types/api';
import { useT } from '../../i18n';

/** Formulaire de création/édition d'un statut de review (Phase 31.A). */
export default function ReviewStatusForm({
  status,
  onClose,
  onSaved,
}: {
  status: ReviewStatus | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(status?.name ?? '');
  const [color, setColor] = useState(status?.color ?? '#3498DB');
  const [isApproval, setIsApproval] = useState(status?.isApproval ?? false);
  const [isRetake, setIsRetake] = useState(status?.isRetake ?? false);
  const [isDefault, setIsDefault] = useState(status?.isDefault ?? false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const body = { name: name.trim(), color, isApproval, isRetake, isDefault };
      if (status) await api.patch(`/api/review-statuses/${status.id}`, body);
      else await api.post('/api/review-statuses', body);
      toast.success(status ? 'Statut mis à jour' : 'Statut créé');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{status ? 'Modifier le statut' : t('reviewStatus.new')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="rs-name">{t('common.name')}</Label>
            <Input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </div>
          <div>
            <Label htmlFor="rs-color">Couleur</Label>
            <div className="flex items-center gap-2">
              <input
                id="rs-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent"
              />
              <span className="text-xs text-muted-foreground">{color}</span>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isApproval} onCheckedChange={(v) => setIsApproval(v === true)} />
            {t('reviewStatus.approval')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isRetake} onCheckedChange={(v) => setIsRetake(v === true)} />
            {t('reviewStatus.retake')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} />
            {t('reviewStatus.defaultOffered')}
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t('common.undo')}
            </Button>
            <Button size="sm" onClick={submit} disabled={saving || !name.trim()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
