import { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { SkeletonRows } from './ui/skeleton';
import type { Department, Nomenclature, ProjectSettings } from '../types/api';

/**
 * Onglet « Réglages » d'un projet (admin/superviseur) :
 *  - frame de départ (déplacée ici depuis la vue d'ensemble)
 *  - nomenclature (préfixes, pas, chiffres) — override des défauts studio
 *  - départements (nom/clé)
 */
export default function ProjectSettingsTab({
  projectId,
  startFrame,
  onStartFrameChange,
  settings,
  onSettingsChange,
}: {
  projectId: number;
  startFrame: number;
  onStartFrameChange: (n: number) => void;
  settings: ProjectSettings | null;
  onSettingsChange: (s: ProjectSettings) => void;
}) {
  const [frameVal, setFrameVal] = useState(String(startFrame));
  const [savingFrame, setSavingFrame] = useState(false);
  const [draft, setDraft] = useState<ProjectSettings | null>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Synchronise le brouillon local quand les settings arrivent (asynchrones)
  if (settings && !draft) setDraft(settings);

  const saveFrame = async () => {
    const n = Number(frameVal);
    if (!Number.isFinite(n)) return;
    setSavingFrame(true);
    try {
      await api.patch(`/api/projects/${projectId}`, { startFrame: n });
      onStartFrameChange(n);
      setMsg('Frame de départ enregistrée.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSavingFrame(false);
    }
  };

  const saveSettings = async () => {
    if (!draft) return;
    setSavingSettings(true);
    setError(null);
    setMsg(null);
    try {
      const { settings: saved } = await api.put<{ settings: ProjectSettings }>(
        `/api/projects/${projectId}/settings`,
        draft,
      );
      onSettingsChange(saved);
      setDraft(saved);
      setMsg('Réglages enregistrés.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSavingSettings(false);
    }
  };

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
  const addDept = () =>
    setDraft((d) => d && { ...d, departments: [...d.departments, { key: '', name: '' }] });
  const removeDept = (i: number) =>
    setDraft((d) => d && { ...d, departments: d.departments.filter((_, idx) => idx !== i) });

  return (
    <div className="max-w-2xl space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {msg && <p className="text-sm text-green-400">{msg}</p>}

      {/* Frame de départ */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium">Frame de départ</div>
        <div className="mb-3 text-xs text-muted-foreground">
          Numéro de la première frame des médias vidéo de ce projet.
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="w-28 rounded border border-input bg-background px-2 py-1.5 text-sm"
            value={frameVal}
            onChange={(e) => setFrameVal(e.target.value)}
          />
          <button
            onClick={saveFrame}
            disabled={savingFrame}
            className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
          >
            {savingFrame ? '…' : 'Enregistrer'}
          </button>
        </div>
      </section>

      {/* Nomenclature */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium">Nomenclature</div>
        <div className="mb-3 text-xs text-muted-foreground">
          Override des défauts studio pour ce projet (préfixes, pas, nombre de chiffres).
        </div>
        {draft ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Préfixe séquence">
              <input
                className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={draft.nomenclature.sequencePrefix}
                onChange={(e) => setNom('sequencePrefix', e.target.value)}
              />
            </Field>
            <Field label="Préfixe shot">
              <input
                className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={draft.nomenclature.shotPrefix}
                onChange={(e) => setNom('shotPrefix', e.target.value)}
              />
            </Field>
            <Field label="Pas">
              <input
                type="number"
                min={1}
                className="w-16 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={draft.nomenclature.step}
                onChange={(e) => setNom('step', e.target.value)}
              />
            </Field>
            <Field label="Chiffres">
              <input
                type="number"
                min={1}
                max={8}
                className="w-16 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={draft.nomenclature.padding}
                onChange={(e) => setNom('padding', e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <SkeletonRows count={3} />
        )}
      </section>

      {/* Départements */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium">Départements</div>
        <div className="mb-3 text-xs text-muted-foreground">
          Liste des départements du projet (clé courte + nom affiché).
        </div>
        {draft && (
          <div className="space-y-1.5">
            {draft.departments.map((dep, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="w-32 rounded border border-input bg-background px-2 py-1.5 text-xs"
                  placeholder="Clé (ANIM)"
                  value={dep.key}
                  onChange={(e) => setDept(i, 'key', e.target.value)}
                />
                <input
                  className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs"
                  placeholder="Nom (Animation)"
                  value={dep.name}
                  onChange={(e) => setDept(i, 'name', e.target.value)}
                />
                <button
                  onClick={() => removeDept(i)}
                  title="Retirer"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              onClick={addDept}
              className="mt-1 flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs hover:bg-secondary/60"
            >
              <Plus size={14} /> Département
            </button>
          </div>
        )}
      </section>

      <button
        onClick={saveSettings}
        disabled={savingSettings || !draft}
        className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        <Save size={15} /> {savingSettings ? 'Enregistrement…' : 'Enregistrer les réglages'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
