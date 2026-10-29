// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
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
import type { MediaResp } from './reviewTypes';
import type { Annotations } from './useAnnotations';
import type { CompareMode } from './useCompareState';
import { useMediaChrome } from './useMediaChrome';
import { useT } from '../../i18n';

/**
 * Chrome for flat viewers (video, image): mode toggle, tool rail, options bar, inspector
 * dock and the version's asset drawer. The player keeps its transport row anchored under
 * the image — that is already where time lives, it never floated.
 */
export default function MediaChrome({
  kind,
  data,
  fps,
  ann,
  role,
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
  compare: {
    mode: CompareMode;
    onMode: (mode: CompareMode) => void;
    ids: number[];
    onClear: () => void;
    /** Exclusive choice of the B media — B setting in the options bar and mode arming. */
    onSet: (mediaId: number) => void;
  };
  onExportFrame?: () => void;
  onContactSheet?: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const { id: mediaId, versionId } = data.media;
  // Neighbouring versions: the only authority on whether the "Compare" mode exists.
  const neighbours = useCompareTargets(versionId);
  const { state, update } = useChromeState(kind, { canCompare: neighbours.hasTargets });
  useMediaChrome({ state, update, ann });

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
  // The asset drawer only makes sense with two media: otherwise the toggle would open
  // an empty strip and take up a row for nothing.
  const hasAssets = useVersionMedia(versionId).length > 1;

  return (
    <ReviewChrome
      kind={kind}
      state={state}
      onState={update}
      role={role ?? 'ARTIST'}
      modes={switcherModesFor(kind, neighbours.hasTargets)}
      options={
        <MediaOptions
          tool={activeTool}
          mode={state.mode}
          ann={ann}
          compare={{
            mode: compare.mode,
            onMode: compare.onMode,
            hasB,
            // Video keeps its header selector: it alone expresses the 2×2 grid.
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
        // The player already carries its timeline row: this bar only opens the filmstrip.
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
