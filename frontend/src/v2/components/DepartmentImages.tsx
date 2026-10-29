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
 * Image of each department in the pipe.
 *
 * Beyond six steps, a color dot is no longer distinguishable, and an asset grid
 * shows twenty at a time. The studio logo for "Compositing" is recognized
 * at a glance, where "#7C3AED" says nothing.
 *
 * The upload follows the path of entity thumbnails: presigned URL, direct upload to MinIO,
 * then recording of the key, which the server rebuilds itself so that a caller
 * cannot point a department at an arbitrary object in the bucket.
 */

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/svg+xml';
/** Beyond that, it is a render dropped by mistake, not a logo. */
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
      // The upload goes directly to MinIO: its failure does not go through our HTTP client
      // and would remain without a message if we did not phrase it here.
      if (!res.ok) throw new Error(t('common.error.upload'));
      await api.put(`/api/departments/${id}/image`, { key });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['departments'] });
      // An asset's columns carry these images: they must be re-read too.
      void qc.invalidateQueries({ queryKey: [projectId, 'departments'] });
    },
  });
}

export default function DepartmentImages({ projectId }: { projectId: number }) {
  const t = useT();
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);
  const setImage = useSetDepartmentImage(projectId);
  const inputs = useRef<Record<number, HTMLInputElement | null>>({});
  /** Local preview: the upload and the invalidation take a second, silent without it. */
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
