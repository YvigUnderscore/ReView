// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Diamond,
  KeyRound,
  MessageSquarePlus,
  Pause,
  Play,
  Redo2,
  Repeat,
  Undo2,
} from 'lucide-react';
import { useRef } from 'react';
import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import type { CameraAnimState } from '../camera/useCameraAnim';
import { snapToFrame, timecode } from '../camera/timeline/viewTransform';
import { useT } from '../../../i18n';

/**
 * Ligne du bas des viewers spatiaux : le temps. Reprend `AnimToolbar` (qui flottait avec le
 * panneau d'animation) et lui donne une piste cliquable — clés en losanges, tête de lecture.
 * Le tiroir « Courbes » s'ancre juste en dessous au lieu d'ouvrir une fenêtre déplaçable.
 */
export default function SpatialTransport({
  anim,
  editable,
  fps,
  trackSwitch,
  onAttach,
  drawerOpen,
  onDrawer,
}: {
  anim: CameraAnimState;
  /** Gestionnaire pré-publication : seul à pouvoir écrire des clés. */
  editable: boolean;
  /** Framerate du pipeline — snap du scrub à la frame, timecode `s:ff`. */
  fps: number;
  /** Sélecteur de piste, quand le média porte aussi des clips d'animation. */
  trackSwitch?: ReactNode;
  /** Joindre l'animation au prochain commentaire (mode layout). */
  onAttach?: () => void;
  drawerOpen: boolean;
  onDrawer: () => void;
}) {
  const t = useT();
  // `keyTimes` fusionne déjà les clés de tous les canaux, triées.
  const times = anim.keyTimes;
  const span = Math.max(anim.playDuration, times[times.length - 1] ?? 0, 1);
  const pct = (t: number) => (t / span) * 100;
  const goToKey = (dir: -1 | 1) => {
    const next =
      dir === 1
        ? times.find((t) => t > anim.timeMs + 1)
        : [...times].reverse().find((t) => t < anim.timeMs - 1);
    if (next !== undefined) anim.scrub(next);
  };

  // Scrub au drag sur la piste (capture du pointeur) — snap à la frame, Alt pour libérer.
  const trackDrag = useRef(false);
  const scrubTrack = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const raw = Math.max(0, ((e.clientX - r.left) / r.width) * span);
    anim.scrub(e.altKey ? raw : snapToFrame(raw, fps));
  };

  return (
    <div className="rv-transport">
      {trackSwitch}
      <IconButton
        icon={anim.playing ? Pause : Play}
        label={anim.playing ? t('video.pauseKey') : t('video.playKey')}
        bordered
        active={anim.playing}
        disabled={!times.length}
        onClick={anim.playing ? anim.pause : anim.play}
      />
      <IconButton
        icon={ChevronLeft}
        label={t('review.key.prev')}
        disabled={!times.length}
        onClick={() => goToKey(-1)}
      />
      <IconButton
        icon={ChevronRight}
        label={t('review.key.next')}
        disabled={!times.length}
        onClick={() => goToKey(1)}
      />
      {editable && (
        <IconButton
          icon={Diamond}
          label={t('review.key.set')}
          bordered
          onClick={() => anim.insertKeyAtView()}
        />
      )}

      <div
        className="rv-track"
        style={{ flex: '1 1 200px', minWidth: 160, cursor: 'ew-resize' }}
        onPointerDown={(e) => {
          // Les losanges de clé gardent leur clic exact (scrub à la clé).
          if (e.button !== 0 || (e.target as HTMLElement).closest('.rv-key')) return;
          trackDrag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          scrubTrack(e);
        }}
        onPointerMove={(e) => {
          if (trackDrag.current) scrubTrack(e);
        }}
        onPointerUp={(e) => {
          trackDrag.current = false;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
      >
        <span className="rv-track__rail" />
        <span className="rv-track__fill" style={{ width: `${pct(anim.timeMs)}%` }} />
        {times.map((keyMs) => (
          <button
            key={keyMs}
            type="button"
            title={t('channel.keyAt', { time: (keyMs / 1000).toFixed(2) })}
            aria-label={t('channel.goToKey', { time: (keyMs / 1000).toFixed(2) })}
            className={`rv-key${Math.abs(keyMs - anim.timeMs) < span / 100 ? ' rv-key--active' : ''}`}
            style={{ left: `${pct(keyMs)}%` }}
            onClick={(e) => {
              e.stopPropagation();
              anim.scrub(keyMs);
            }}
          />
        ))}
        <span className="rv-track__head" style={{ left: `${pct(anim.timeMs)}%` }} />
      </div>

      <NumberField
        label={t('review.time')}
        hint={t('review.time.hint')}
        value={Number((anim.timeMs / 1000).toFixed(3))}
        onChange={(s) => anim.scrub(snapToFrame(Math.max(0, s) * 1000, fps))}
        min={0}
        max={600}
        step={1 / (fps > 0 ? fps : 24)}
        unit="s"
      />
      <span className="font-mono text-[0.625rem] text-muted-foreground">
        <span className="text-primary">{timecode(anim.timeMs, fps)}</span> / {timecode(span, fps)}
      </span>

      {editable && (
        <>
          <NumberField
            label={t('viewer.duration')}
            hint={t('review.duration.hint')}
            value={Number((anim.playDuration / 1000).toFixed(2))}
            onChange={(s) => anim.setDuration(s > 0 ? Math.round(s * 1000) : undefined)}
            min={0}
            max={600}
            step={0.5}
            unit="s"
          />
          <IconButton
            icon={KeyRound}
            label={t('review.autoKey')}
            bordered
            active={anim.autoKey}
            className={
              // Enregistrement armé : état fort façon DCC — impossible de l'oublier allumé.
              anim.autoKey
                ? 'animate-pulse bg-destructive/20 text-destructive hover:bg-destructive/30'
                : undefined
            }
            onClick={() => anim.setAutoKey(!anim.autoKey)}
          />
        </>
      )}
      <IconButton
        icon={Repeat}
        label={t('video.loopAll')}
        bordered
        active={anim.loop}
        onClick={() => anim.setLoop(!anim.loop)}
      />
      {editable && (
        <>
          <IconButton icon={Undo2} label={t('common.undo')} onClick={anim.undo} disabled={!anim.canUndo} />
          <IconButton icon={Redo2} label={t('common.redo')} onClick={anim.redo} disabled={!anim.canRedo} />
        </>
      )}
      {onAttach && anim.hasAnimation && (
        <IconButton
          icon={MessageSquarePlus}
          label={t('review.attachAnimation')}
          bordered
          onClick={onAttach}
        />
      )}

      <span className="rv-rule" />
      <Button size="sm" variant="ghost" onClick={onDrawer} title={t('review.curveEditor')}>
        {drawerOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        {t('camera.curves')}
      </Button>
    </div>
  );
}
