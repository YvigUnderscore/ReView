import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import type { ColorSettings } from '../types/api';

interface OcioConfig {
  id: string;
  name: string;
  acesVersion: string;
  isDefault: boolean;
}
interface OcioDisplay {
  name: string;
  views: string[];
}

/**
 * Section « Gestion de couleur (OCIO) » des réglages projet (39.B) : choix d'une config installée
 * (ou défaut studio), puis display + view. Les listes viennent de la config OCIO installée (Admin →
 * Couleur). Sans config installée, invite l'admin à en installer une. La transformation couleur
 * pixel-exacte au rendu est un lot ultérieur : ce choix fixe l'intention display/view du projet.
 */
export default function ProjectColorSection({
  value,
  onChange,
}: {
  value: ColorSettings | undefined;
  onChange: (v: ColorSettings | undefined) => void;
}) {
  const configsQ = useQuery({
    queryKey: qk.ocioConfigs,
    queryFn: () => api.get<{ configs: OcioConfig[] }>('/api/studio/ocio/configs').then((d) => d.configs),
  });
  const configs = configsQ.data ?? [];
  const defaultConfig = configs.find((c) => c.isDefault) ?? configs[0];
  const activeConfigId = value?.configId ?? defaultConfig?.id;

  const displaysQ = useQuery({
    queryKey: qk.ocioDisplays(activeConfigId ?? 'none'),
    queryFn: () =>
      api
        .get<{ displays: OcioDisplay[] }>(`/api/studio/ocio/configs/${activeConfigId}/displays`)
        .then((d) => d.displays),
    enabled: !!activeConfigId,
  });
  const displays = displaysQ.data ?? [];
  const currentDisplay = displays.find((d) => d.name === value?.display) ?? displays[0];

  const set = (patch: Partial<ColorSettings>) => {
    const next = { ...value, ...patch };
    onChange(next.configId || next.display || next.view ? next : undefined);
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 text-sm font-medium">Gestion de couleur (OCIO)</div>
      <div className="mb-3 text-xs text-muted-foreground">
        Config OCIO et display/view du projet. Les configs sont gérées dans Admin → Couleur (OCIO).
      </div>
      {configs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Aucune config OCIO installée. Un administrateur peut en installer une (Admin → Couleur).
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Config">
            <select
              className="w-56 rounded border border-input bg-background px-2 py-1.5 text-xs"
              value={value?.configId ?? ''}
              onChange={(e) => onChange({ configId: e.target.value || undefined })}
            >
              <option value="">Défaut studio ({defaultConfig?.name ?? '—'})</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Display">
            <select
              className="w-48 rounded border border-input bg-background px-2 py-1.5 text-xs disabled:opacity-50"
              value={value?.display ?? ''}
              disabled={displays.length === 0}
              onChange={(e) => set({ display: e.target.value || undefined, view: undefined })}
            >
              <option value="">— hérité —</option>
              {displays.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="View">
            <select
              className="w-48 rounded border border-input bg-background px-2 py-1.5 text-xs disabled:opacity-50"
              value={value?.view ?? ''}
              disabled={!currentDisplay}
              onChange={(e) => set({ view: e.target.value || undefined })}
            >
              <option value="">— hérité —</option>
              {(currentDisplay?.views ?? []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
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
