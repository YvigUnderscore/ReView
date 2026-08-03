// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { SkeletonRows } from './ui/skeleton';
import ProjectBurninSection from './ProjectBurninSection';
import ProjectStorageSection from './ProjectStorageSection';
import ProjectNamingSection from './ProjectNamingSection';
import ProjectDefaultLightingSection from './ProjectDefaultLightingSection';
import ProjectColorSection from './ProjectColorSection';
import type { Department, Nomenclature, ProjectSettings } from '../types/api';
import { useT } from '../i18n';

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
  const t = useT();
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
      setMsg(t('project.startFrameSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error.generic'));
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
      setMsg(t('project.settingsSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setSavingSettings(false);
    }
  };

  const setRes = (k: 'width' | 'height', v: string) =>
    setDraft((d) => d && { ...d, resolution: { ...d.resolution, [k]: Number(v) || 1 } });
  const setFps = (v: string) => setDraft((d) => d && { ...d, framerate: Number(v) || 1 });

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
      {msg && <p className="text-sm text-success">{msg}</p>}

      {/* Frame de départ */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium">{t('pipeline.startFrame')}</div>
        <div className="mb-3 text-xs text-muted-foreground">{t('project.startFrameHint')}</div>
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
            {savingFrame ? '…' : t('common.save')}
          </button>
        </div>
      </section>

      {/* Format & cadence (résolution + fps) — défauts du projet, hérités par séquences/shots */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium">{t('pipeline.formatRate')}</div>
        <div className="mb-3 text-xs text-muted-foreground">{t('pipeline.formatHint')}</div>
        {draft ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('pipeline.width')}>
              <input
                type="number"
                min={1}
                className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={draft.resolution.width}
                onChange={(e) => setRes('width', e.target.value)}
              />
            </Field>
            <span className="pb-1.5 text-muted-foreground">×</span>
            <Field label={t('pipeline.height')}>
              <input
                type="number"
                min={1}
                className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={draft.resolution.height}
                onChange={(e) => setRes('height', e.target.value)}
              />
            </Field>
            <Field label={t('pipeline.fps')}>
              <input
                type="number"
                min={1}
                className="w-20 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={draft.framerate}
                onChange={(e) => setFps(e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <SkeletonRows count={1} />
        )}
      </section>

      {/* Nomenclature */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium">{t('pipeline.naming')}</div>
        <div className="mb-3 text-xs text-muted-foreground">{t('project.namingOverride')}</div>
        {draft ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('pipeline.prefix.sequence')}>
              <input
                className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={draft.nomenclature.sequencePrefix}
                onChange={(e) => setNom('sequencePrefix', e.target.value)}
              />
            </Field>
            <Field label={t('pipeline.prefix.shot')}>
              <input
                className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={draft.nomenclature.shotPrefix}
                onChange={(e) => setNom('shotPrefix', e.target.value)}
              />
            </Field>
            <Field label={t('pipeline.step')}>
              <input
                type="number"
                min={1}
                className="w-16 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={draft.nomenclature.step}
                onChange={(e) => setNom('step', e.target.value)}
              />
            </Field>
            <Field label={t('pipeline.digits')}>
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
        <div className="text-sm font-medium">{t('pipeline.departments')}</div>
        <div className="mb-3 text-xs text-muted-foreground">{t('project.departmentsHint')}</div>
        {draft && (
          <div className="space-y-1.5">
            {draft.departments.map((dep, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="w-32 rounded border border-input bg-background px-2 py-1.5 text-xs"
                  placeholder={t('pipeline.dept.key.placeholder')}
                  value={dep.key}
                  onChange={(e) => setDept(i, 'key', e.target.value)}
                />
                <input
                  className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs"
                  placeholder={t('pipeline.dept.name.placeholder')}
                  value={dep.name}
                  onChange={(e) => setDept(i, 'name', e.target.value)}
                />
                <button
                  onClick={() => removeDept(i)}
                  title={t('common.remove')}
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
              <Plus size={14} /> {t('common.department')}
            </button>
          </div>
        )}
      </section>

      {/* Convention de nommage (38.C) : éditée dans le draft, enregistrée avec les réglages. */}
      {draft && (
        <ProjectNamingSection
          value={draft.naming ?? { pattern: '', mode: 'off' }}
          onChange={(naming) => setDraft((d) => d && { ...d, naming })}
        />
      )}

      {/* Éclairage 3D par défaut (39.F) : HDRI hérité par les médias 3D, enregistré avec les réglages. */}
      {draft && (
        <ProjectDefaultLightingSection
          value={draft.defaultLighting}
          onChange={(defaultLighting) => setDraft((d) => d && { ...d, defaultLighting })}
        />
      )}

      {/* Gestion de couleur OCIO (39.B) : config + display/view, enregistré avec les réglages. */}
      {draft && (
        <ProjectColorSection
          value={draft.color}
          onChange={(color) => setDraft((d) => d && { ...d, color })}
        />
      )}

      {/* Stockage (38.D) : usage + quota du projet. */}
      <ProjectStorageSection projectId={projectId} />

      {/* Burn-ins (35.A) : override du template studio, enregistré avec les réglages. */}
      {draft && (
        <ProjectBurninSection
          value={draft.burnin}
          onChange={(burnin) => setDraft((d) => d && { ...d, burnin })}
        />
      )}

      <button
        onClick={saveSettings}
        disabled={savingSettings || !draft}
        className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        <Save size={15} /> {savingSettings ? 'Enregistrement…' : t('project.saveSettings')}
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
