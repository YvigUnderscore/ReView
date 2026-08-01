import type { ComponentProps, RefObject } from 'react';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import ReviewCanvasRefs, { ReviewCanvasRefsControls } from './ReviewCanvasRefs';
import ReviewContextMenu from './ReviewContextMenu';
import ImageComparePane from './ImageComparePane';
import ImageWipeOverlay from './ImageWipeOverlay';
import { ImageDiffOverlay } from './DiffOverlay';
import MediaChrome from './MediaChrome';
import { VIEWER_ZONE, type MediaResp, type SplatEditsPatch } from './reviewTypes';
import type { useImageCompareSync } from './useImageCompareSync';
import type { Annotations } from './useAnnotations';
import type { CompareMode } from './useCompareState';
import type { Role } from '../../types/api';

/**
 * Branche **image** du viewer de review : visionneuse annotable dans le chrome unifié, ou
 * superposition de comparaison (wipe / différence) qui prend toute la zone. Extraite de
 * `ReviewViewer` avec la refonte du chrome — même découpage que la branche vidéo.
 */
export default function ImageReviewSection({
  data,
  fps,
  ann,
  role,
  canManage,
  selectedCommentId,
  videoRef,
  imageSync,
  imageViewApiRef,
  onImageUserView,
  onFullscreen,
  onToggleAnnotate,
  onClearSelection,
  onSaved,
  compareIds,
  compareMode,
  onCompareModeChange,
  closeCompare,
  sharedWipe,
}: {
  data: MediaResp;
  fps: number;
  ann: Annotations;
  role?: Role;
  canManage: boolean;
  selectedCommentId: number | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  imageSync: ReturnType<typeof useImageCompareSync>;
  imageViewApiRef?: ComponentProps<typeof ImageReviewViewer>['viewApiRef'];
  onImageUserView?: () => void;
  onFullscreen: () => void;
  onToggleAnnotate: () => void;
  onClearSelection: () => void;
  onSaved: (patch: SplatEditsPatch) => void;
  compareIds: number[];
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  closeCompare: () => void;
  sharedWipe?: ComponentProps<typeof ImageWipeOverlay>['sharedWipe'];
}) {
  const compareId = compareIds[0] ?? null;

  // Le wipe et la différence remplacent la visionneuse : le zoom y est suspendu.
  if (compareId != null && compareMode === 'wipe')
    return (
      <ImageWipeOverlay
        aUrl={data.url}
        aName={data.media.originalName}
        compareId={compareId}
        onClose={closeCompare}
        onSide={() => onCompareModeChange('side')}
        onDiff={() => onCompareModeChange('diff')}
        sharedWipe={sharedWipe}
      />
    );
  if (compareId != null && compareMode === 'diff')
    return (
      <ImageDiffOverlay
        aUrl={data.url}
        compareId={compareId}
        onClose={closeCompare}
        onSide={() => onCompareModeChange('side')}
        onWipe={() => onCompareModeChange('wipe')}
      />
    );

  return (
    <MediaChrome
      kind="IMAGE"
      data={data}
      fps={fps}
      ann={ann}
      role={role}
      canEdit={false}
      videoRef={videoRef}
      onSaved={onSaved}
      compare={{
        mode: compareMode,
        onMode: onCompareModeChange,
        ids: compareIds,
        onClear: closeCompare,
      }}
    >
      <div className="flex min-h-0 flex-1 gap-3">
        <ReviewContextMenu
          data={data}
          videoRef={videoRef}
          fps={fps}
          canManage={canManage}
          annotating={ann.annotating}
          onToggleAnnotate={onToggleAnnotate}
          hasViewed={!!ann.viewed}
          onClearSelection={onClearSelection}
          annShapes={ann.viewed ?? ann.annot}
        >
          <div className={VIEWER_ZONE}>
            <div className="absolute inset-0">
              <ImageReviewViewer
                src={data.url}
                alt={data.media.originalName}
                shapes={ann.viewed ?? ann.annot}
                onChange={ann.setShapes}
                editable={ann.annotating && !ann.viewed}
                tool={ann.tool}
                color={ann.color}
                width={ann.penWidth}
                alpha={ann.alpha}
                info={{ format: data.media.originalName.split('.').pop()?.toUpperCase() ?? null }}
                onFullscreen={onFullscreen}
                viewApiRef={imageViewApiRef}
                onUserView={onImageUserView}
                onViewChange={compareId != null ? imageSync.onMasterView : undefined}
                pinned={
                  <ReviewCanvasRefs
                    mediaId={data.media.id}
                    references={data.references ?? []}
                    selectedCommentId={selectedCommentId}
                    canManage={canManage}
                    ann={ann}
                  />
                }
              />
            </div>
            <ReviewCanvasRefsControls ann={ann} annotating={ann.annotating} />
          </div>
        </ReviewContextMenu>
        {/* Comparaison A/B image côte à côte — zoom/pan répliqué. */}
        {compareId != null && compareMode === 'side' && (
          <ImageComparePane
            compareId={compareId}
            onClose={closeCompare}
            onWipe={() => onCompareModeChange('wipe')}
            onDiff={() => onCompareModeChange('diff')}
            viewApiRef={imageSync.slaveApiRef}
            onViewChange={imageSync.onSlaveView}
          />
        )}
      </div>
    </MediaChrome>
  );
}
