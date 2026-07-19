import { type ComponentProps, type ReactNode } from 'react';
import type { ReviewComment } from '../../types/api';
import type { MediaResp, SplatEditsPatch } from './reviewTypes';
import type { useAnnotations } from './useAnnotations';
import type { CompareMode } from './useCompareState';
import ReviewContextMenu from './ReviewContextMenu';
import VideoComparePane from './VideoComparePane';
import VideoWipeOverlay from './VideoWipeOverlay';
import { VideoDiffOverlay } from './DiffOverlay';
import VideoPane from './VideoPane';
import VideoTrimBar from './VideoTrimBar';

/**
 * Branche **vidéo** du viewer de review (extrait de ReviewViewer, budget 300) : lecteur
 * maître (menu clic droit, trim) + comparaison — wipe/diff en overlay (A/B simple) ou
 * panes esclaves synchronisés, en côte-à-côte (1) ou grille 2×2 (2-3, 34.D).
 */
export default function VideoReviewSection({
  data,
  src,
  hlsUrl,
  videoRef,
  programmaticSeekRef,
  overlay,
  comments,
  selectedId,
  onSelectComment,
  onManualSeek,
  onMarker,
  fps,
  setFpsOverride,
  startFrame,
  onFullscreen,
  onLoopChange,
  canEdit,
  canManage,
  ann,
  onToggleAnnotate,
  onClearSelection,
  onSplatEditsSaved,
  compareIds,
  compareMode,
  onCompareModeChange,
  onRemoveCompare,
  closeCompare,
  sharedWipe,
}: {
  data: MediaResp;
  src: string;
  hlsUrl: string | null;
  videoRef: ComponentProps<typeof VideoPane>['videoRef'];
  programmaticSeekRef: ComponentProps<typeof VideoPane>['programmaticSeekRef'];
  overlay: ReactNode;
  comments: ReviewComment[];
  selectedId: number | null;
  onSelectComment: (c: ReviewComment) => void;
  onManualSeek: () => void;
  onMarker: () => void;
  fps: number;
  setFpsOverride: (fps: number) => void;
  startFrame: number;
  onFullscreen: () => void;
  onLoopChange?: ComponentProps<typeof VideoPane>['onLoopChange'];
  canEdit: boolean;
  canManage: boolean;
  ann: ReturnType<typeof useAnnotations>;
  onToggleAnnotate: () => void;
  onClearSelection: () => void;
  onSplatEditsSaved: (patch: SplatEditsPatch) => void;
  compareIds: number[];
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  onRemoveCompare: (mediaId: number) => void;
  closeCompare: () => void;
  sharedWipe?: ComponentProps<typeof VideoWipeOverlay>['sharedWipe'];
}) {
  const compareId = compareIds[0] ?? null;
  // Grille 2×2 (34.D) : dès 2 panes B — wipe/diff n'ont de sens qu'en A/B simple.
  const gridActive = compareIds.length >= 2;
  return (
    <div
      className={
        gridActive ? 'grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3' : 'flex min-h-0 flex-1 gap-3'
      }
    >
      <ReviewContextMenu
        data={data}
        videoRef={videoRef}
        fps={fps}
        canManage={canManage}
        annotating={ann.annotating}
        onToggleAnnotate={onToggleAnnotate}
        hasViewed={!!ann.viewed}
        onClearSelection={onClearSelection}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <VideoPane
            src={src}
            mediaId={data.media.id}
            hlsUrl={hlsUrl}
            videoRef={videoRef}
            programmaticSeekRef={programmaticSeekRef}
            overlay={overlay}
            compareOverlay={
              compareId != null && compareMode === 'wipe' && !gridActive ? (
                <VideoWipeOverlay
                  compareId={compareId}
                  masterRef={videoRef}
                  onClose={closeCompare}
                  onSide={() => onCompareModeChange('side')}
                  onDiff={() => onCompareModeChange('diff')}
                  sharedWipe={sharedWipe}
                />
              ) : compareId != null && compareMode === 'diff' && !gridActive ? (
                <VideoDiffOverlay
                  compareId={compareId}
                  masterRef={videoRef}
                  onClose={closeCompare}
                  onSide={() => onCompareModeChange('side')}
                  onWipe={() => onCompareModeChange('wipe')}
                />
              ) : null
            }
            comments={comments}
            selectedId={selectedId}
            onSelectComment={onSelectComment}
            onManualSeek={onManualSeek}
            onMarker={onMarker}
            fps={fps}
            fpsDetected={data.fps != null}
            setFpsOverride={setFpsOverride}
            startFrame={startFrame}
            onFullscreen={onFullscreen}
            trimRange={
              // Le proxy trimé actif redémarre à 0 : l'ombrage ne vaut que sur la vidéo complète.
              data.trim && !data.trimProxyReady
                ? { start: data.trim.inFrame / fps, end: data.trim.outFrame / fps }
                : null
            }
            timelineSprite={
              data.timelineSprite && data.timelineSpriteUrl
                ? { url: data.timelineSpriteUrl, meta: data.timelineSprite }
                : null
            }
            onLoopChange={onLoopChange}
          />
          {canEdit && <VideoTrimBar data={data} fps={fps} videoRef={videoRef} onSaved={onSplatEditsSaved} />}
        </div>
      </ReviewContextMenu>
      {/* Panes B synchronisés sur le maître : côte-à-côte (1) ou grille 2×2 (34.D). */}
      {(compareMode === 'side' || gridActive) &&
        compareIds.map((id) => (
          <VideoComparePane
            key={id}
            compareId={id}
            masterRef={videoRef}
            onClose={gridActive ? () => onRemoveCompare(id) : closeCompare}
            onWipe={gridActive ? undefined : () => onCompareModeChange('wipe')}
            onDiff={gridActive ? undefined : () => onCompareModeChange('diff')}
          />
        ))}
    </div>
  );
}
