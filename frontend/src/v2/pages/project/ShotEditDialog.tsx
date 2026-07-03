import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import type { Sequence, Shot } from './projectTypes';

/** Modal d'édition d'un shot : code, nom, séquence (réassignation). */
export default function ShotEditDialog({ shot, sequences, onClose, onSaved }: {
  shot: Shot; sequences: Sequence[]; onClose: () => void; onSaved: () => void;
}) {
  const [vals, setVals] = useState({ code: shot.code, name: shot.name, sequenceId: shot.sequenceId ? String(shot.sequenceId) : '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.patch(`/api/shots/${shot.id}`, {
        code: vals.code,
        name: vals.name,
        sequenceId: vals.sequenceId ? Number(vals.sequenceId) : null,
      });
      toast.success('Shot modifié');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier le shot</DialogTitle>
        </DialogHeader>
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
        <div className="space-y-2">
          <Input placeholder="Code" value={vals.code} onChange={(e) => setVals((v) => ({ ...v, code: e.target.value }))} />
          <Input placeholder="Nom" value={vals.name} onChange={(e) => setVals((v) => ({ ...v, name: e.target.value }))} />
          <Select className="w-full" value={vals.sequenceId} onChange={(e) => setVals((v) => ({ ...v, sequenceId: e.target.value }))}>
            <option value="">Sans séquence</option>
            {sequences.map((sq) => <option key={sq.id} value={sq.id}>{sq.code} · {sq.name}</option>)}
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
