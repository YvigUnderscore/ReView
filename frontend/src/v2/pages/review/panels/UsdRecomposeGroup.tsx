// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Layers } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';
import type { UsdModelInfo, UsdPurpose, UsdVariantSelection } from '@/v2/types/api';
import { Button } from '@/v2/components/ui/button';
import { Select } from '@/v2/components/ui/select';
import { DOCK_SELECT, Group, Row } from '../chrome/DockGroup';
import { initialSelection, purposeLabel, variantValue } from '../usdDisplay';
import { useT, type MessageKey } from '@/v2/i18n';

/** Translator passed to the label tables, recomputed on each render. */
type Tr = (key: MessageKey) => string;

/**
 * Recomposition of a USD scene (Phase 45, 45.F): replays the conversion with another selection of
 * variants or another purpose. The original file is not touched: the server applies the selection
 * through a USD overlay layer, then converts again.
 *
 * **It is no longer a modal** (batch 13). It was a centred `Dialog`, with no maximum height and no
 * scrolling: a production scene exposes dozens of variant sets, so the sheet overflowed at the top and
 * bottom of the window. Half the lists and the submit button were out of reach, by wheel and by
 * keyboard alike. And the modal's overlay cut off the viewer: it was impossible to orbit the scene to
 * see what was being recomposed.
 *
 * Chosen form: a **group of the inspector dock**, in the Scene tab, just below the scenegraph. It is
 * the side surface the repository already reserves for "what we work with while watching the viewer"
 * (the viewer keeps its whole canvas, no focus trap); it scrolls end to end (`.rv-dock__scroll`); and
 * it puts the recomposition next to the tree whose variants it changes: one subject, one place. The
 * viewer's popover, the repository's other surface, did not suit: it closes on the first click in the
 * scene, that is, on the first navigation gesture.
 *
 * The list of variants also has its own scrolling: beyond a dozen sets, the "Recompose" button stayed
 * at the bottom of an endless panel.
 *
 * This scrolling did not scroll, however (batch 15): the column is bounded in height, and `.rv-row`
 * declared an explicit minimum height without refusing compression. The rows therefore fell back to a
 * step of 1.75 rem, half of what a label stacked above its select measures, and their content was painted
 * over the neighbouring row, "modelingVariant" on top of the drop-down list. The fix lives in `chrome.css`:
 * it applies to any dock row placed in a bounded column, not only to this panel.
 */

const purposes = (t: Tr): { value: UsdPurpose; label: string; hint: string }[] => [
  { value: 'render', label: purposeLabel('render'), hint: t('usd.renderGeom') },
  { value: 'proxy', label: purposeLabel('proxy'), hint: t('usd.proxyGeom') },
  { value: 'guide', label: purposeLabel('guide'), hint: t('usd.guideGeom') },
];

export default function UsdRecomposeGroup({ mediaId, usd }: { mediaId: number; usd: UsdModelInfo }) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [purpose, setPurpose] = useState<UsdPurpose>(usd.selection.purpose);
  const [variants, setVariants] = useState<UsdVariantSelection>(() => initialSelection(usd));

  const choose = (prim: string, name: string, value: string) =>
    setVariants((v) => ({ ...v, [prim]: { ...(v[prim] ?? {}), [name]: value } }));

  const submit = () => {
    setBusy(true);
    api
      .post(`/api/media/${mediaId}/usd/recompose`, { variants, purpose })
      .then(() => {
        toast.success(t('review.usd.recomposeStarted'));
        void qc.invalidateQueries({ queryKey: qk.media(mediaId) });
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : t('common.error.recompose')))
      .finally(() => setBusy(false));
  };

  return (
    <Group title={t('review.usd.recompose')} collapsible count={usd.variantSets.length}>
      <p className="text-2xs text-muted-foreground">{t('usd.recomposeHint')}</p>

      <Row label={t('usd.purpose')} stack hint={purposes(t).find((p) => p.value === purpose)?.hint}>
        <Select
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as UsdPurpose)}
          className={DOCK_SELECT}
        >
          {purposes(t).map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Row>

      {usd.variantSets.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('review.usd.noVariants')}</p>
      ) : (
        <div
          // The submit button must remain reachable whatever the richness of the scene: it is the list
          // that scrolls, not the whole window. The scrolling depends on the refusal to compress the rows
          // (`.rv-row { flex-shrink: 0 }`): without it, the bounded column would crush its rows instead of
          // giving them a scrollbar.
          data-testid="usd-variant-scroll"
          className="custom-scrollbar flex max-h-56 flex-col gap-1 overflow-y-auto pr-1"
        >
          {usd.variantSets.map((set) => (
            <Row
              key={`${set.prim}-${set.name}`}
              // A variant set name is a USD identifier, sometimes longer than the dock's 280 px: it is cut,
              // and the prim path remains in the tooltip.
              label={<span className="truncate">{set.name}</span>}
              hint={set.prim}
              stack
            >
              <Select
                value={variantValue(variants, set.prim, set.name, set.selected)}
                onChange={(e) => choose(set.prim, set.name, e.target.value)}
                className={DOCK_SELECT}
              >
                {set.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Row>
          ))}
        </div>
      )}

      <Button size="sm" variant="outline" className="w-full" onClick={submit} disabled={busy}>
        <Layers size={13} />
        {busy ? t('common.starting') : t('usd.recomposeFrom')}
      </Button>
    </Group>
  );
}
