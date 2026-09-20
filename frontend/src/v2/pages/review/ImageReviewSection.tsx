// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComponentProps, RefObject } from 'react';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import ReviewCanvasRefs, { ReviewCanvasRefsControls } from './ReviewCanvasRefs';
import ReviewContextMenu from './ReviewContextMenu';
import CompositionGuides from './CompositionGuides';
import ImageComparePane from './ImageComparePane';
import ImageWipeOverlay from './ImageWipeOverlay';
import { ImageDiffOverlay } from './DiffOverlay';
import MediaChrome from './MediaChrome';
import DisplayTransformOverlay from './color/DisplayTransformOverlay';
import { useDisplayTransform } from './color/useDisplayTransform';
import { imageCompareOverlay } from './header/headerComposition';
import { VIEWER_ZONE, type MediaResp } from './reviewTypes';
import type { useImageCompareSync } from './useImageCompareSync';
import type { Annotations } from './useAnnotations';
import type { CompareMode } from './useCompareState';
import type { Role } from '../../types/api';

/**
 * Branche **image** du viewer de review : visionneuse annotable, ou surcouche de comparaison
 * (wipe / différence) à la place du viewport. Les deux vivent **dans** le chrome : la
 * comparaison le démontait, et la bascule de mode comme les réglages A/B disparaissaient à
 * l'instant où l'on en avait besoin.
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
  compareIds,
  compareMode,
  onCompareModeChange,
  onSetCompare,
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
  compareIds: number[];
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  /** Choix exclusif du média B (réglage B, armement du mode « Compare »). */
  onSetCompare: (mediaId: number) => void;
  closeCompare: () => void;
  sharedWipe?: ComponentProps<typeof ImageWipeOverlay>['sharedWipe'];
}) {
  const compareId = compareIds[0] ?? null;
  // Transformée d'affichage (OCIO) de l'image A. Les surcouches de comparaison gardent
  // l'image brute : comparer deux versions suppose de les regarder dans le même état.
  const display = useDisplayTransform(data.url, data.projectColor);

  // Le wipe et la différence remplacent le viewport, le zoom y étant suspendu — mais pas le
  // chrome : `imageCompareOverlay` ne décide que du contenu de la zone média.
  const overlay = imageCompareOverlay(compareId, compareMode);

  return (
    <MediaChrome
      kind="IMAGE"
      data={data}
      fps={fps}
      ann={ann}
      role={role}
      compare={{
        mode: compareMode,
        onMode: onCompareModeChange,
        ids: compareIds,
        onClear: closeCompare,
        onSet: onSetCompare,
      }}
    >
      {compareId != null && overlay === 'wipe' && (
        <div className="flex min-h-0 flex-1">
          <ImageWipeOverlay
            aUrl={data.url}
            aName={data.media.originalName}
            compareId={compareId}
            onClose={closeCompare}
            sharedWipe={sharedWipe}
          />
        </div>
      )}
      {compareId != null && overlay === 'diff' && (
        <div className="flex min-h-0 flex-1">
          <ImageDiffOverlay
            aUrl={data.url}
            compareId={compareId}
            onClose={closeCompare}
            onSide={() => onCompareModeChange('side')}
            onWipe={() => onCompareModeChange('wipe')}
          />
        </div>
      )}
      {!overlay && (
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
                  // Le viewer jugé porte `F` / `H` ; les panes de comparaison, non.
                  viewShortcuts
                  viewApiRef={imageViewApiRef}
                  onUserView={onImageUserView}
                  onViewChange={compareId != null ? imageSync.onMasterView : undefined}
                  pinned={
                    <>
                      {/* Gestion de couleur : l'image transformée se pose **au-dessus** de
                        l'originale dans le plan zoomé. Passer par `src` referait le cadrage
                        à chaque cran d'exposition. */}
                      <DisplayTransformOverlay url={display.url} />
                      {/* Repères de composition : l'overlay n'était monté que dans le lecteur
                        vidéo, et l'onglet « Repères » du dock image ne faisait donc rien. */}
                      <CompositionGuides />
                      <ReviewCanvasRefs
                        mediaId={data.media.id}
                        references={data.references ?? []}
                        selectedCommentId={selectedCommentId}
                        canManage={canManage}
                        ann={ann}
                      />
                    </>
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
      )}
    </MediaChrome>
  );
}
