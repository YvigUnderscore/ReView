// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ComponentProps, type ReactNode } from 'react';
import type { ReviewComment } from '../../types/api';
import type { MediaResp } from './reviewTypes';
import type { useAnnotations } from './useAnnotations';
import type { CompareMode } from './useCompareState';
import ReviewContextMenu from './ReviewContextMenu';
import { CompareFitProvider } from './compare/CompareFitProvider';
import VideoComparePane from './VideoComparePane';
import VideoWipeOverlay from './VideoWipeOverlay';
import { VideoDiffOverlay } from './DiffOverlay';
import VideoPane from './VideoPane';

/**
 * **Video** branch of the review viewer (extracted from ReviewViewer, budget 300): master
 * player (right-click menu, trim) + comparison — wipe/diff as an overlay (simple A/B) or
 * synchronized slave panes, side by side (1) or in a 2×2 grid (2-3, 34.D).
 *
 * All panes fit their media into a **common area** (`CompareFitProvider`): the master carries
 * the timeline and transport under the image, the B panes a header, and two separate fits
 * would give two display sizes on screen.
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
  canManage,
  ann,
  onToggleAnnotate,
  onClearSelection,
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
  canManage: boolean;
  ann: ReturnType<typeof useAnnotations>;
  onToggleAnnotate: () => void;
  onClearSelection: () => void;
  compareIds: number[];
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  onRemoveCompare: (mediaId: number) => void;
  closeCompare: () => void;
  sharedWipe?: ComponentProps<typeof VideoWipeOverlay>['sharedWipe'];
}) {
  const compareId = compareIds[0] ?? null;
  // 2×2 grid (34.D): from 2 B panes on — wipe/diff only make sense in simple A/B.
  const gridActive = compareIds.length >= 2;
  return (
    <CompareFitProvider>
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
          annShapes={ann.viewed ?? ann.annot}
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
                // The active trimmed proxy restarts at 0: the shading only applies to the full video.
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
          </div>
        </ReviewContextMenu>
        {/* B panes synchronized to the master: side by side (1) or 2×2 grid (34.D). */}
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
    </CompareFitProvider>
  );
}
