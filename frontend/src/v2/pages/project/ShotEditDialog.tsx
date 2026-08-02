// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import PipelineFields from './PipelineFields';
import { applyOverride, formFromOverride, overrideFromForm } from './pipelineForm';
import type { PipelineSettings } from '../../types/api';
import type { Sequence, Shot } from './projectTypes';
import { useT } from '../../i18n';

/** Modal d'édition d'un shot : code, nom, séquence, intervalle de frames, override pipeline. */
export default function ShotEditDialog({
  shot,
  sequences,
  pipeline,
  onClose,
  onSaved,
}: {
  shot: Shot;
  sequences: Sequence[];
  pipeline: PipelineSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [vals, setVals] = useState({
    code: shot.code,
    name: shot.name,
    sequenceId: shot.sequenceId ? String(shot.sequenceId) : '',
    startFrame: shot.startFrame != null ? String(shot.startFrame) : '',
    endFrame: shot.endFrame != null ? String(shot.endFrame) : '',
  });
  // Héritage : pipeline projet, surchargé par l'override de la séquence sélectionnée.
  const seqOverride = sequences.find((s) => String(s.id) === vals.sequenceId)?.settings;
  const inherited = applyOverride(pipeline, seqOverride);
  const [pipe, setPipe] = useState(() => formFromOverride(shot.settings, inherited));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/shots/${shot.id}`, {
        code: vals.code,
        name: vals.name,
        sequenceId: vals.sequenceId ? Number(vals.sequenceId) : null,
        startFrame: vals.startFrame ? Number(vals.startFrame) : null,
        endFrame: vals.endFrame ? Number(vals.endFrame) : null,
        settings: overrideFromForm(pipe, inherited),
      });
      toast.success('Shot modifié');
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
          <DialogTitle>Modifier le shot</DialogTitle>
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
              placeholder="Nom"
              className="flex-1"
              value={vals.name}
              onChange={(e) => setVals((v) => ({ ...v, name: e.target.value }))}
            />
          </div>
          <Select
            className="w-full"
            value={vals.sequenceId}
            onChange={(e) => setVals((v) => ({ ...v, sequenceId: e.target.value }))}
          >
            <option value="">Sans séquence</option>
            {sequences.map((sq) => (
              <option key={sq.id} value={sq.id}>
                {sq.code} · {sq.name}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Frame de début
              <Input
                type="number"
                placeholder={t('common.inherited')}
                value={vals.startFrame}
                onChange={(e) => setVals((v) => ({ ...v, startFrame: e.target.value }))}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Frame de fin
              <Input
                type="number"
                placeholder={t('common.inherited')}
                value={vals.endFrame}
                onChange={(e) => setVals((v) => ({ ...v, endFrame: e.target.value }))}
              />
            </label>
          </div>
          <PipelineFields inherited={inherited} form={pipe} onChange={setPipe} idPrefix={`shot-${shot.id}`} />
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
