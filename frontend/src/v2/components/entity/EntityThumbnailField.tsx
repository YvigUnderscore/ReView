// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { useSetEntityThumbnail } from '../../lib/entityApi';
import type { EntityKind } from './entitySettings';
import { useT } from '../../i18n';

/**
 * Vignette d'une entité (C3) : la choisir, la remplacer, la retirer.
 *
 * `thumbnailKey` existait en base et le PATCH l'acceptait, mais rien dans l'application ne
 * savait produire la clé — aucune entité n'a donc jamais pu porter d'image. Sans vignette
 * choisie, l'entité retombe sur la miniature de son premier média publié, comme avant.
 */

const ACCEPTED = 'image/png,image/jpeg,image/webp';
/** Au-delà, c'est un rendu qu'on dépose par erreur, pas une vignette. */
const MAX_BYTES = 8 * 1024 * 1024;

export default function EntityThumbnailField({
  kind,
  id,
  projectId,
  url,
}: {
  kind: EntityKind;
  id: number;
  projectId: number;
  url: string | null | undefined;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const setThumbnail = useSetEntityThumbnail(kind, id, projectId);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(t('entity.settings.thumbnailTooLarge'));
      return;
    }
    // Aperçu immédiat : le dépôt vers MinIO puis l'invalidation prennent une seconde ou
    // deux, pendant lesquelles l'ancienne image resterait affichée sans rien dire.
    setPreview(URL.createObjectURL(file));
    setThumbnail.mutate(file, {
      onSuccess: () => toast.success(t('entity.settings.thumbnailSaved')),
      onError: (err) => {
        setPreview(null);
        toast.error(err instanceof Error ? err.message : t('common.error.generic'));
      },
    });
  };

  const shown = preview ?? url ?? null;

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
        {shown ? (
          <img src={shown} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus size={18} className="text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={setThumbnail.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {url ? t('entity.settings.thumbnailReplace') : t('entity.settings.thumbnailChoose')}
        </Button>
        {url && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={setThumbnail.isPending}
            onClick={() => {
              setPreview(null);
              setThumbnail.mutate(null, {
                onSuccess: () => toast.success(t('entity.settings.thumbnailCleared')),
                onError: (err) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
              });
            }}
          >
            <Trash2 size={13} /> {t('common.delete')}
          </Button>
        )}
        <p className="w-full text-2xs text-muted-foreground">{t('entity.settings.thumbnailHint')}</p>
      </div>
    </div>
  );
}
