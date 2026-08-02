// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import type { LightingDefault } from '../types/api';

/** Entrée de la bibliothèque HDRI instance (miroir de `HdriService.listWithUrls`). */
interface HdriItem {
  id: string;
  name: string;
}

const NEUTRAL: LightingDefault = {
  exposure: 1,
  rotationDeg: 0,
  showBackground: false,
  groundShadow: false,
};

/**
 * Section « Éclairage 3D par défaut » des réglages projet (39.F) : HDRI de la bibliothèque instance,
 * exposition, rotation Y, fond, sol d'ombres. Rejoué à l'ouverture d'un média 3D sans éclairage
 * propre. Sans défaut, le projet reste en éclairage studio neutre.
 */
export default function ProjectDefaultLightingSection({
  value,
  onChange,
}: {
  value: LightingDefault | undefined;
  onChange: (v: LightingDefault | undefined) => void;
}) {
  const { data: hdris } = useQuery({
    queryKey: qk.hdris,
    queryFn: () => api.get<{ hdris: HdriItem[] }>('/api/studio/hdris').then((d) => d.hdris),
  });
  const set = (patch: Partial<LightingDefault>) => value && onChange({ ...value, ...patch });

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 text-sm font-medium">Éclairage 3D par défaut</div>
      <div className="mb-3 text-xs text-muted-foreground">
        Environnement HDRI rejoué à l'ouverture des médias 3D de ce projet qui n'ont pas leur propre
        éclairage. Les spectateurs peuvent l'ajuster en session sans le modifier.
      </div>
      {!value ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Aucun défaut : éclairage studio neutre.</p>
          <button
            onClick={() => onChange(NEUTRAL)}
            className="shrink-0 rounded border border-border px-2 py-1.5 text-xs hover:bg-secondary/60"
          >
            Définir un défaut
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="HDRI">
              <select
                className="w-40 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={value.hdriId ?? ''}
                onChange={(e) => set({ hdriId: e.target.value || undefined })}
              >
                <option value="">Aucun (lumières studio)</option>
                {(hdris ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Exposition">
              <input
                type="number"
                min={0}
                max={10}
                step={0.05}
                className="w-20 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={value.exposure}
                onChange={(e) => set({ exposure: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Rotation°">
              <input
                type="number"
                min={-180}
                max={180}
                step={1}
                className="w-20 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={value.rotationDeg}
                onChange={(e) => set({ rotationDeg: Number(e.target.value) || 0 })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="accent-primary"
                checked={value.showBackground}
                onChange={(e) => set({ showBackground: e.target.checked })}
              />
              Afficher l'HDRI en fond
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="accent-primary"
                checked={value.groundShadow}
                onChange={(e) => set({ groundShadow: e.target.checked })}
              />
              Sol récepteur d'ombres
            </label>
            <button
              onClick={() => onChange(undefined)}
              className="ml-auto rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-destructive"
            >
              Retirer le défaut
            </button>
          </div>
        </div>
      )}
    </section>
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
