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
    const file = e.target.files?.[0];
    if (file && target != null) enqueue(file, target);
    if (fileRef.current) fileRef.current.value = '';
  };

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
      <EmptyState
        icon={Layers}
        title={t('task.noVersion')}
        description={emptyDescription}
        action={canCreate ? t('version.create') : undefined}
        onAction={canCreate ? onCreateVersion : undefined}
      />
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <ViewToggle contextKey={`versions:${contextKey}`} />
      </div>
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
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
        message={
          <>La version « {delVersion?.name} » et ses médias seront déplacés dans la corbeille du projet.</>
        }
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
        message={<>« {delMedia?.media.originalName} » sera déplacé dans la corbeille du projet.</>}
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
