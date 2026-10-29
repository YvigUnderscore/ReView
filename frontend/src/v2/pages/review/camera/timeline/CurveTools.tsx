// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Link2,
  MoveHorizontal,
  Unlink,
  Weight,
  type LucideIcon,
} from 'lucide-react';
import type { CurveKey, TangentType } from '../channels/model';
import {
  isBroken,
  isWeighted,
  TANGENT_TYPES,
  typeIn,
  typeOut,
  type TangentTarget,
} from '../channels/tangents';
import { useT, type MessageKey } from '@/v2/i18n';

const TYPE_LABEL: Record<TangentType, MessageKey> = {
  auto: 'camera.tangent.auto',
  linear: 'camera.tangent.linear',
  flat: 'camera.tangent.flat',
  step: 'camera.tangent.step',
  free: 'camera.tangent.free',
};

/** Sides offered, with their icon: incoming, both, outgoing. */
const TARGETS: ReadonlyArray<{ id: TangentTarget; icon: LucideIcon; label: MessageKey }> = [
  { id: 'in', icon: ArrowLeftToLine, label: 'camera.tangent.sideIn' },
  { id: 'both', icon: MoveHorizontal, label: 'camera.tangent.sideBoth' },
  { id: 'out', icon: ArrowRightToLine, label: 'camera.tangent.sideOut' },
];

const BTN = 'px-1.5 py-0.5 transition-colors';
const ON = 'bg-primary/15 text-primary';
const OFF = 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground';

/** Type shown as active for the targeted side — nothing if both sides diverge. */
function activeType(k: CurveKey, target: TangentTarget): TangentType | undefined {
  if (target === 'in') return typeIn(k);
  if (target === 'out') return typeOut(k);
  return typeIn(k) === typeOut(k) ? typeIn(k) : undefined;
}

/**
 * Graph editor tangent tools (Phase 50, batch 7): **targeted side** (incoming, outgoing or both),
 * profile (smooth, linear, flat, step, free), broken/unified and weighted handles.
 *
 * Everything applies to the **whole selection**, which may span several curves: that is the
 * "change the profile of a set of curves" gesture. Right-clicking a channel row does the same
 * job on a whole curve without going through the selection.
 */
export default function CurveTools({
  primary,
  onType,
  onBroken,
  onWeighted,
}: {
  /** Primary key of the selection — only used to show the current state. */
  primary: CurveKey | undefined;
  onType: (type: TangentType, target: TangentTarget) => void;
  onBroken: (broken: boolean) => void;
  onWeighted: (weighted: boolean) => void;
}) {
  const t = useT();
  const [target, setTarget] = useState<TangentTarget>('both');
  const active = primary ? activeType(primary, target) : undefined;
  const broken = primary ? isBroken(primary) : false;
  const weighted = primary ? isWeighted(primary) : false;
  return (
    <div className="absolute top-1 right-2 z-10 flex overflow-hidden rounded border border-border bg-card/90 text-2xs">
      {TARGETS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          title={t(label)}
          aria-label={t(label)}
          onClick={() => setTarget(id)}
          className={`${BTN} ${target === id ? ON : OFF}`}
        >
          <Icon size={11} />
        </button>
      ))}
      <span className="w-px shrink-0 bg-border" />
      {TANGENT_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onType(type, target)}
          className={`${BTN} ${active === type ? ON : OFF}`}
        >
          {t(TYPE_LABEL[type])}
        </button>
      ))}
      <span className="w-px shrink-0 bg-border" />
      <button
        type="button"
        title={t(broken ? 'camera.tangent.unify' : 'camera.tangent.break')}
        aria-label={t(broken ? 'camera.tangent.unify' : 'camera.tangent.break')}
        onClick={() => onBroken(!broken)}
        className={`${BTN} ${broken ? ON : OFF}`}
      >
        {broken ? <Unlink size={11} /> : <Link2 size={11} />}
      </button>
      <button
        type="button"
        title={t('camera.tangent.weighted')}
        aria-label={t('camera.tangent.weighted')}
        onClick={() => onWeighted(!weighted)}
        className={`${BTN} ${weighted ? ON : OFF}`}
      >
        <Weight size={11} />
      </button>
    </div>
  );
}
