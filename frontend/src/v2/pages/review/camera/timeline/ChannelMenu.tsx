// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../../../../components/ui/context-menu';
import type { ChannelId, Extrapolation, TangentType } from '../channels/model';
import { TANGENT_TYPES } from '../channels/tangents';
import { useT, type MessageKey } from '../../../../i18n';

const TYPE_LABEL: Record<TangentType, MessageKey> = {
  auto: 'camera.tangent.auto',
  linear: 'camera.tangent.linear',
  flat: 'camera.tangent.flat',
  step: 'camera.tangent.step',
  free: 'camera.tangent.free',
};

const INFINITY_LABEL: Record<Extrapolation, MessageKey> = {
  constant: 'camera.infinity.constant',
  cycle: 'camera.infinity.cycle',
  cycleOffset: 'camera.infinity.cycleOffset',
  linear: 'camera.infinity.linear',
  oscillate: 'camera.infinity.oscillate',
};

const INFINITIES = Object.keys(INFINITY_LABEL) as Extrapolation[];

/** Sous-menu d'extrapolation d'un côté (avant ou après les clés du canal). */
function InfinitySub({
  label,
  current,
  onPick,
}: {
  label: MessageKey;
  current: Extrapolation;
  onPick: (kind: Extrapolation) => void;
}) {
  const t = useT();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{t(label)}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup value={current} onValueChange={(v) => onPick(v as Extrapolation)}>
          {INFINITIES.map((kind) => (
            <ContextMenuRadioItem key={kind} value={kind}>
              {t(INFINITY_LABEL[kind])}
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/**
 * Actions d'**une courbe entière**, au clic droit sur sa ligne de canal (Phase 50, lot 7) : profil
 * de tangente appliqué à toutes ses clés, extrapolation avant/après ses clés, sélection de ses clés,
 * recadrage vertical, pose d'une clé. Le clic droit d'abord, conformément à la règle d'UI du
 * projet — aucun bouton nouveau dans une liste déjà dense.
 *
 * En lecture seule, seules les actions de vue restent (sélectionner, recadrer) : rien de ce menu ne
 * peut alors écrire.
 */
export default function ChannelMenu({
  id,
  editable,
  pre,
  post,
  onProfile,
  onInfinity,
  onSelectAll,
  onFit,
  onKey,
  children,
}: {
  id: ChannelId;
  editable: boolean;
  pre: Extrapolation;
  post: Extrapolation;
  onProfile: (id: ChannelId, type: TangentType) => void;
  onInfinity: (id: ChannelId, patch: { pre?: Extrapolation; post?: Extrapolation }) => void;
  onSelectAll: (id: ChannelId) => void;
  onFit: (id: ChannelId) => void;
  onKey: (id: ChannelId) => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onSelectAll(id)}>{t('camera.channel.selectAll')}</ContextMenuItem>
        <ContextMenuItem onClick={() => onFit(id)}>{t('camera.channel.fit')}</ContextMenuItem>
        {editable && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onKey(id)}>{t('camera.keyChannel')}</ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>{t('camera.tangent.profile')}</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {TANGENT_TYPES.map((type) => (
                  <ContextMenuItem key={type} onClick={() => onProfile(id, type)}>
                    {t(TYPE_LABEL[type])}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <InfinitySub
              label="camera.infinity.pre"
              current={pre}
              onPick={(kind) => onInfinity(id, { pre: kind })}
            />
            <InfinitySub
              label="camera.infinity.post"
              current={post}
              onPick={(kind) => onInfinity(id, { post: kind })}
            />
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
