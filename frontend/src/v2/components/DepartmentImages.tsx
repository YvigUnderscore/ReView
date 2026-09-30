// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { useDepartments } from '../lib/departmentsApi';
import { useT } from '../i18n';

/**
 * Image de chaque département du pipe.
 *
 * Au-delà de six étapes, une pastille de couleur ne se distingue plus — et une grille
 * d'assets en montre vingt à la fois. Le logo du studio pour « Compositing » se reconnaît
 * d'un coup d'œil là où « #7C3AED » ne dit rien.
 *
 * Le dépôt suit le chemin des vignettes d'entité : URL présignée, dépôt direct dans MinIO,
 * puis enregistrement de la clé — que le serveur reconstruit lui-même, pour qu'un appelant
 * ne puisse pas faire pointer un département vers un objet quelconque du bucket.
 */

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/svg+xml';
/** Au-delà, c'est un rendu déposé par erreur, pas un logo. */
const MAX_BYTES = 4 * 1024 * 1024;

function useSetDepartmentImage(projectId: number) {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File | null }) => {
      if (file === null) {
        await api.put(`/api/departments/${id}/image`, { key: null });
        return;
      }
      const { url, key } = await api.post<{ url: string; key: string }>(
        `/api/departments/${id}/image/presign`,
        { contentType: file.type },
      );
      const res = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      // Le dépôt va directement vers MinIO : son échec ne passe pas par notre client HTTP
      // et resterait sans message si on ne le formulait pas ici.
      if (!res.ok) throw new Error(t('common.error.upload'));
      await api.put(`/api/departments/${id}/image`, { key });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['departments'] });
      // Les colonnes d'un asset portent ces images : elles doivent se relire aussi.
      void qc.invalidateQueries({ queryKey: [projectId, 'departments'] });
    },
  });
}

export default function DepartmentImages({ projectId }: { projectId: number }) {
  const t = useT();
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);
  const setImage = useSetDepartmentImage(projectId);
  const inputs = useRef<Record<number, HTMLInputElement | null>>({});
  /** Aperçu local : le dépôt et l'invalidation prennent une seconde, muette sans lui. */
  const [previews, setPreviews] = useState<Record<number, string>>({});

  if (departments.length === 0) return null;

  const pick = (id: number, file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(t('entity.settings.thumbnailTooLarge'));
      return;
    }
    setPreviews((p) => ({ ...p, [id]: URL.createObjectURL(file) }));
    setImage.mutate(
      { id, file },
      {
        onSuccess: () => toast.success(t('entity.settings.thumbnailSaved')),
        onError: (err: unknown) => {
          setPreviews((p) => {
            const next = { ...p };
            delete next[id];
            return next;
          });
          toast.error(err instanceof Error ? err.message : t('common.error.generic'));
        },
      },
    );
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{t('pipeline.dept.imageHint')}</p>
      {departments.map((department) => {
        const shown = previews[department.id] ?? department.imageUrl ?? null;
        return (
          <div key={department.id} className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
              {shown ? (
                <img src={shown} alt="" className="h-full w-full object-cover" />
              ) : (
                <ImagePlus size={13} className="text-muted-foreground" />
              )}
            </div>
            <span className="min-w-0 flex-1 truncate text-xs">{department.name}</span>
            <input
              ref={(el) => {
                inputs.current[department.id] = el;
              }}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => {
                pick(department.id, e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => inputs.current[department.id]?.click()}
              className="shrink-0 rounded border border-border px-2 py-1 text-2xs hover:bg-secondary/60"
            >
              {department.imageUrl
                ? t('entity.settings.thumbnailReplace')
                : t('entity.settings.thumbnailChoose')}
            </button>
            {department.imageUrl && (
              <button
                type="button"
                title={t('common.delete')}
                aria-label={t('common.delete')}
                onClick={() => setImage.mutate({ id: department.id, file: null })}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
