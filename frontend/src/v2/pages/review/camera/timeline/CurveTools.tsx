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
import { useT, type MessageKey } from '../../../../i18n';

const TYPE_LABEL: Record<TangentType, MessageKey> = {
  auto: 'camera.tangent.auto',
  linear: 'camera.tangent.linear',
  flat: 'camera.tangent.flat',
  step: 'camera.tangent.step',
  free: 'camera.tangent.free',
};

/** Côtés proposés, avec leur icône : entrant, les deux, sortant. */
const TARGETS: ReadonlyArray<{ id: TangentTarget; icon: LucideIcon; label: MessageKey }> = [
  { id: 'in', icon: ArrowLeftToLine, label: 'camera.tangent.sideIn' },
  { id: 'both', icon: MoveHorizontal, label: 'camera.tangent.sideBoth' },
  { id: 'out', icon: ArrowRightToLine, label: 'camera.tangent.sideOut' },
];

const BTN = 'px-1.5 py-0.5 transition-colors';
const ON = 'bg-primary/15 text-primary';
const OFF = 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground';

/** Type affiché comme actif pour le côté visé — rien si les deux côtés divergent. */
function activeType(k: CurveKey, target: TangentTarget): TangentType | undefined {
  if (target === 'in') return typeIn(k);
  if (target === 'out') return typeOut(k);
  return typeIn(k) === typeOut(k) ? typeIn(k) : undefined;
}

/**
 * Outils de tangente du graph editor (Phase 50, lot 7) : **côté visé** (entrant, sortant ou les
 * deux), profil (lissée, linéaire, plate, palier, libre), poignées brisées/unifiées et pondérées.
 *
 * Tout s'applique à la **sélection entière**, qui peut couvrir plusieurs courbes : c'est le geste
 * « changer le profil d'un ensemble de courbes ». Le clic droit sur une ligne de canal fait le même
 * travail sur une courbe entière sans passer par la sélection.
 */
export default function CurveTools({
  primary,
  onType,
  onBroken,
  onWeighted,
}: {
  /** Clé primaire de la sélection — ne sert qu'à montrer l'état courant. */
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
