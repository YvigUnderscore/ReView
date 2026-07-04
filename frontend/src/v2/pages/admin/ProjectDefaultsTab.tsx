import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Panel } from './AdminPrimitives';
import type { Department, Nomenclature, ProjectSettings } from '../../types/api';

function DefField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** Défauts de création de projet : nomenclature + départements (overridables par projet). */
export default function ProjectDefaultsTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.admin('project-defaults'),
    queryFn: () =>
      api.get<{ settings: ProjectSettings }>('/api/admin/project-defaults').then((d) => d.settings),
  });
  const [draft, setDraft] = useState<ProjectSettings | null>(null);
  const [busy, setBusy] = useState(false);
  // Amorce l'édition depuis les valeurs serveur (ajustement d'état pendant le render).
  if (data && !draft) setDraft(data);
  if (!draft) return <SkeletonRows count={3} />;

  const setNom = (k: keyof Nomenclature, v: string) =>
    setDraft(
      (d) =>
        d && {
          ...d,
          nomenclature: { ...d.nomenclature, [k]: k === 'padding' || k === 'step' ? Number(v) || 1 : v },
        },
    );
  const setDept = (i: number, k: keyof Department, v: string) =>
    setDraft(
      (d) =>
        d && { ...d, departments: d.departments.map((dep, idx) => (idx === i ? { ...dep, [k]: v } : dep)) },
    );
  const save = async () => {
    setBusy(true);
    try {
      const { settings } = await api.put<{ settings: ProjectSettings }>('/api/admin/project-defaults', draft);
      setDraft(settings);
      qc.invalidateQueries({ queryKey: qk.admin('project-defaults') });
      toast.success('Défauts enregistrés');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Valeurs appliquées à la création d'un projet et utilisées comme repli. Chaque projet peut les
        surcharger dans son onglet « Réglages ».
      </p>

      <Panel title="Nomenclature par défaut">
        <div className="flex flex-wrap items-end gap-3">
          <DefField label="Préfixe séquence">
            <Input
              className="w-24 py-1.5 text-xs"
              value={draft.nomenclature.sequencePrefix}
              onChange={(e) => setNom('sequencePrefix', e.target.value)}
            />
          </DefField>
          <DefField label="Préfixe shot">
            <Input
              className="w-24 py-1.5 text-xs"
              value={draft.nomenclature.shotPrefix}
              onChange={(e) => setNom('shotPrefix', e.target.value)}
            />
          </DefField>
          <DefField label="Pas">
            <Input
              type="number"
              min={1}
              className="w-16 py-1.5 text-xs"
              value={String(draft.nomenclature.step)}
              onChange={(e) => setNom('step', e.target.value)}
            />
          </DefField>
          <DefField label="Chiffres">
            <Input
              type="number"
              min={1}
              max={8}
              className="w-16 py-1.5 text-xs"
              value={String(draft.nomenclature.padding)}
              onChange={(e) => setNom('padding', e.target.value)}
            />
          </DefField>
        </div>
      </Panel>

      <Panel title="Départements par défaut">
        <div className="space-y-1.5">
          {draft.departments.map((dep, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                className="w-32 py-1.5 text-xs"
                placeholder="Clé"
                value={dep.key}
                onChange={(e) => setDept(i, 'key', e.target.value)}
              />
              <Input
                className="flex-1 py-1.5 text-xs"
                placeholder="Nom"
                value={dep.name}
                onChange={(e) => setDept(i, 'name', e.target.value)}
              />
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={() =>
                  setDraft((d) => d && { ...d, departments: d.departments.filter((_, idx) => idx !== i) })
                }
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="mt-1"
            onClick={() =>
              setDraft((d) => d && { ...d, departments: [...d.departments, { key: '', name: '' }] })
            }
          >
            <Plus size={14} /> Département
          </Button>
        </div>
      </Panel>

      <Button onClick={save} disabled={busy}>
        <Save size={15} /> {busy ? 'Enregistrement…' : 'Enregistrer les défauts'}
      </Button>
    </div>
  );
}
