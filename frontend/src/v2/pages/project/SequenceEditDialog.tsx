// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import PipelineFields from './PipelineFields';
import { formFromOverride, overrideFromForm } from './pipelineForm';
import type { PipelineSettings } from '../../types/api';
import type { Sequence } from './projectTypes';
import { useT } from '../../i18n';

/** Modal d'édition d'une séquence : code, nom, override pipeline (résolution/cadence). */
export default function SequenceEditDialog({
  sequence,
  pipeline,
  onClose,
  onSaved,
}: {
  sequence: Sequence;
  pipeline: PipelineSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [vals, setVals] = useState({ code: sequence.code, name: sequence.name });
  const [pipe, setPipe] = useState(() => formFromOverride(sequence.settings, pipeline));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/sequences/${sequence.id}`, {
        code: vals.code,
        name: vals.name,
        settings: overrideFromForm(pipe, pipeline),
      });
      toast.success(t('sequences.updated'));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sequences.edit')}</DialogTitle>
        </DialogHeader>
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="Code"
              className="w-32"
              value={vals.code}
              onChange={(e) => setVals((v) => ({ ...v, code: e.target.value }))}
            />
            <Input
              placeholder={t('common.name')}
              className="flex-1"
              value={vals.name}
              onChange={(e) => setVals((v) => ({ ...v, name: e.target.value }))}
            />
          </div>
          <PipelineFields
            inherited={pipeline}
            form={pipe}
            onChange={setPipe}
            idPrefix={`seq-${sequence.id}`}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
