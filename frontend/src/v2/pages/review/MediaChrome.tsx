// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode, RefObject } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { MediaKind, Role } from '../../types/api';
import ReviewChrome from './chrome/ReviewChrome';
import { useChromeState } from './chrome/useChromeState';
import { switcherModesFor } from './chrome/modes';
import { toolsFor } from './chrome/tools';
import CompareAB from './compare/CompareAB';
import { useCompareArm } from './compare/useCompareArm';
import { useCompareMedia, useCompareTargets } from './compare/useCompareTargets';
import MediaOptions from './options/MediaOptions';
import MediaPanels from './panels/MediaPanels';
import VersionAssets from './VersionAssets';
import { useVersionMedia } from './useVersionMedia';
import type { MediaResp, SplatEditsPatch } from './reviewTypes';
import type { Annotations } from './useAnnotations';
import type { CompareMode } from './useCompareState';
import { IMAGE_HIDDEN_TOOLS, VIDEO_HIDDEN_TOOLS, useMediaChrome } from './useMediaChrome';
import { useVideoTrim } from './useVideoTrim';
import { useT } from '../../i18n';

/**
 * Chrome des viewers plats (vidéo, image) : bascule de mode, rail d'outils, barre d'options,
 * dock inspecteur et tiroir des assets de la version. Le lecteur garde sa ligne de transport ancrée sous
 * l'image — c'est déjà l'emplacement du temps, elle n'a jamais flotté.
 */
export default function MediaChrome({
  kind,
  data,
  fps,
  ann,
  role,
  canEdit,
  videoRef,
  onSaved,
  compare,
  onExportFrame,
  onContactSheet,
  children,
}: {
  kind: MediaKind;
  data: MediaResp;
  fps: number;
  ann: Annotations;
  role?: Role;
  /** Découpe autorisée (gestionnaire, média non publié) — vidéo seulement. */
  canEdit: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onSaved: (patch: SplatEditsPatch) => void;
  compare: {
    mode: CompareMode;
    onMode: (mode: CompareMode) => void;
    ids: number[];
    onClear: () => void;
    /** Choix exclusif du média B — réglage B de la barre d'options et armement du mode. */
    onSet: (mediaId: number) => void;
  };
  onExportFrame?: () => void;
  onContactSheet?: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const { id: mediaId, versionId, published } = data.media;
  // Versions voisines : seule autorité sur l'existence du mode « Compare ».
  const neighbours = useCompareTargets(versionId);
  const { state, update } = useChromeState(kind, published, neighbours.hasTargets);
  useMediaChrome({ state, update, ann });
  const trim = useVideoTrim({ data, fps, videoRef, onSaved });

  const comparing = state.mode === 'compare';
  const { targets, firstMediaId } = useCompareMedia(neighbours.versions, mediaId, kind, comparing);
  const hasB = compare.ids.length > 0;
  useCompareArm({
    mode: state.mode,
    onMode: (mode) => update({ mode }),
    hasB,
    firstB: firstMediaId,
    onSetB: compare.onSet,
    onClear: compare.onClear,
    onCompareMode: compare.onMode,
  });

  const tools = toolsFor(state.mode, kind);
  const activeTool = tools.find((tool) => tool.id === state.tool) ?? tools[0];
  const canTrim = kind === 'VIDEO' && canEdit;
  // Le tiroir des assets n'a de sens qu'à partir de deux médias : la bascule ouvrait sinon
  // une bande vide, et occupait une ligne pour rien.
  const hasAssets = useVersionMedia(versionId).length > 1;

  return (
    <ReviewChrome
      // Verrou de publication : les modes qui altèrent le média sont grisés, pas offerts.
      published={published}
      kind={kind}
      state={state}
      onState={update}
      role={role ?? 'ARTIST'}
      modes={switcherModesFor(kind, neighbours.hasTargets)}
      hiddenTools={kind === 'VIDEO' ? VIDEO_HIDDEN_TOOLS : IMAGE_HIDDEN_TOOLS}
      dirty={canTrim && state.mode === 'edit' ? trim.dirty : undefined}
      options={
        <MediaOptions
          tool={activeTool}
          mode={state.mode}
          ann={ann}
          compare={{
            mode: compare.mode,
            onMode: compare.onMode,
            hasB,
            // La vidéo garde son sélecteur d'en-tête : lui seul exprime la grille 2×2.
            ab:
              kind === 'IMAGE' ? (
                <CompareAB
                  aName={data.media.originalName}
                  bId={compare.ids[0] ?? null}
                  targets={targets}
                  onSetB={compare.onSet}
                  onClear={compare.onClear}
                />
              ) : undefined,
          }}
          trim={canTrim ? trim : undefined}
        />
      }
      panel={
        <MediaPanels
          panel={state.panel}
          kind={kind}
          data={data}
          fps={fps}
          onExportFrame={onExportFrame}
          onContactSheet={onContactSheet}
        />
      }
      drawer={
        hasAssets && state.drawer === 'strip' ? (
          <div className="flex-shrink-0 border-t border-border bg-card px-2.5 py-2">
            <VersionAssets versionId={versionId} mediaId={mediaId} />
          </div>
        ) : undefined
      }
      transport={
        // Le lecteur porte déjà sa ligne de temps : cette barre n'ouvre que la pellicule.
        hasAssets ? (
          <div className="rv-transport justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => update({ drawer: state.drawer === 'strip' ? null : 'strip' })}
              title={t('review.versionAssetsHint')}
            >
              {state.drawer === 'strip' ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              {t('review.versionAssets')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {children}
    </ReviewChrome>
  );
}
