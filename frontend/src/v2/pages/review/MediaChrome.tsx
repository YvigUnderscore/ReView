// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode, RefObject } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { MediaKind, Role } from '../../types/api';
import ReviewChrome from './chrome/ReviewChrome';
import { useChromeState } from './chrome/useChromeState';
import { toolsFor } from './chrome/tools';
import MediaOptions from './options/MediaOptions';
import MediaPanels from './panels/MediaPanels';
import VersionAssets from './VersionAssets';
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
  };
  onExportFrame?: () => void;
  onContactSheet?: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const { state, update } = useChromeState(kind);
  useMediaChrome({ state, update, ann });
  const trim = useVideoTrim({ data, fps, videoRef, onSaved });

  const tools = toolsFor(state.mode, kind);
  const activeTool = tools.find((t) => t.id === state.tool) ?? tools[0];
  const canTrim = kind === 'VIDEO' && canEdit;

  return (
    <ReviewChrome
      kind={kind}
      state={state}
      onState={update}
      role={role ?? 'ARTIST'}
      hiddenTools={kind === 'VIDEO' ? VIDEO_HIDDEN_TOOLS : IMAGE_HIDDEN_TOOLS}
      dirty={canTrim && state.mode === 'edit' ? trim.dirty : undefined}
      options={
        <MediaOptions
          tool={activeTool}
          mode={state.mode}
          ann={ann}
          compare={{ mode: compare.mode, onMode: compare.onMode, hasB: compare.ids.length > 0 }}
          trim={canTrim ? trim : undefined}
        />
      }
      panel={
        <MediaPanels
          panel={state.panel}
          kind={kind}
          data={data}
          fps={fps}
          compare={compare}
          onExportFrame={onExportFrame}
          onContactSheet={onContactSheet}
        />
      }
      drawer={
        state.drawer === 'strip' ? (
          <div className="flex-shrink-0 border-t border-border bg-card px-2.5 py-2">
            <VersionAssets versionId={data.media.versionId} mediaId={data.media.id} />
          </div>
        ) : undefined
      }
      transport={
        // Le lecteur porte déjà sa ligne de temps : cette barre n'ouvre que la pellicule.
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
      }
    >
      {children}
    </ReviewChrome>
  );
}
