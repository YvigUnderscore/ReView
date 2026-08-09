// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { useUploadStore } from '../../../stores/useUploadStore';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import VersionTimelineItem from './VersionTimelineItem';
import NewVersionDropzone from './NewVersionDropzone';
import type { MediaSummary, VersionListItem } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Timeline de versions partagée par TaskPage et AssetPage (Phase 20) : liste dépliable
 * (dernière version ouverte par défaut), vraies miniatures, bascule cartes/compact,
 * upload de média, suppression version/média (corbeille). Handlers fournis par `useVersions`.
 */
export default function VersionTimeline({
  versions,
  isLoading,
  canCreate,
  canPublish,
  contextKey,
  projectId = null,
  emptyDescription,
  onCreateVersion,
  onDropNewVersion,
  publishVersion,
  publishMedia,
  removeVersion,
  removeMedia,
}: {
  versions: VersionListItem[];
  isLoading: boolean;
  canCreate: boolean;
  canPublish: boolean;
  contextKey: string;
  /** Projet porteur — active « Ajouter à la playlist » sur les cartes de version. */
  projectId?: number | null;
  emptyDescription: string;
  onCreateVersion: () => void;
  /** Dépôt sur la zone dédiée : crée la version suivante et y verse les fichiers. */
  onDropNewVersion: (files: File[]) => void;
  publishVersion: (versionId: number) => void;
  publishMedia: (versionId: number, mediaId: number) => void;
  removeVersion: (versionId: number) => void;
  removeMedia: (versionId: number, mediaId: number) => void;
}) {
  const t = useT();
  const enqueue = useUploadStore((s) => s.enqueue);
  const view = useViewMode(`versions:${contextKey}`);
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [delVersion, setDelVersion] = useState<VersionListItem | null>(null);
  const [delMedia, setDelMedia] = useState<{ versionId: number; media: MediaSummary } | null>(null);

  const onUploadClick = (versionId: number) => {
    setTarget(versionId);
    fileRef.current?.click();
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0 && target != null) files.forEach((f) => enqueue(f, target));
    if (fileRef.current) fileRef.current.value = '';
  };
  /** Dépôt sur une version existante : les fichiers la rejoignent (Phase 46). */
  const dropInto = (versionId: number, files: File[]) => files.forEach((f) => enqueue(f, versionId));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="space-y-3">
        {canCreate && <NewVersionDropzone onFiles={onDropNewVersion} />}
        <EmptyState
          icon={Layers}
          title={t('task.noVersion')}
          description={emptyDescription}
          action={canCreate ? t('version.create') : undefined}
          onAction={canCreate ? onCreateVersion : undefined}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <ViewToggle contextKey={`versions:${contextKey}`} />
      </div>
      {/* Déposer ici crée la version suivante ; déposer sur une carte alimente celle-ci. */}
      {canCreate && (
        <div className="mb-3">
          <NewVersionDropzone onFiles={onDropNewVersion} />
        </div>
      )}
      <input ref={fileRef} type="file" multiple className="hidden" onChange={onFile} />
      <ol className="ml-1">
        {versions.map((v, i) => (
          <VersionTimelineItem
            key={v.id}
            version={v}
            isLast={i === versions.length - 1}
            defaultOpen={i === 0}
            view={view}
            canCreate={canCreate}
            canPublish={canPublish}
            projectId={projectId}
            onUpload={onUploadClick}
            onDropFiles={dropInto}
            onPublishVersion={publishVersion}
            onDeleteVersion={setDelVersion}
            onPublishMedia={publishMedia}
            onDeleteMedia={(versionId, media) => setDelMedia({ versionId, media })}
          />
        ))}
      </ol>

      <ConfirmDialog
        open={!!delVersion}
        title={t('version.delete.title')}
        message={t('version.delete.message', { name: delVersion?.name ?? '' })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={() => {
          if (delVersion) removeVersion(delVersion.id);
          setDelVersion(null);
        }}
        onCancel={() => setDelVersion(null)}
      />
      <ConfirmDialog
        open={!!delMedia}
        title={t('media.delete.title')}
        message={t('media.delete.message', { name: delMedia?.media.originalName ?? '' })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={() => {
          if (delMedia) removeMedia(delMedia.versionId, delMedia.media.id);
          setDelMedia(null);
        }}
        onCancel={() => setDelMedia(null)}
      />
    </div>
  );
}
