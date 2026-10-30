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
import { Button } from '@/v2/components/ui/button';
import { IconButton } from '@/v2/components/ui/icon-button';
import { NumberField } from '@/v2/components/ui/number-field';
import type { CameraAnimState } from '../camera/useCameraAnim';
import { snapToFrame, timecode, trackPct } from '../camera/timeline/viewTransform';
import { useT } from '@/v2/i18n';

/**
 * Ceiling of the time and duration fields, in seconds — **the same as the server's** (`3 600 000 ms`).
 * Both fields were capped at 600 s: a longer animation, yet recordable, could neither be adjusted nor
 * rejoined from the keyboard.
 */
const MAX_SECONDS = 3600;

/**
 * Bottom line of the spatial viewers: the time. Takes over `AnimToolbar` (which floated with the
 * animation panel) and gives it a clickable track — keys as diamonds, playhead.
 * The "Curves" drawer anchors right underneath instead of opening a movable window.
 */
export default function SpatialTransport({
  anim,
  editable,
  fps,
  trackSwitch,
  attach,
  drawerOpen,
  onDrawer,
}: {
  anim: CameraAnimState;
  /** Pre-publication manager: the only one allowed to write keys. */
  editable: boolean;
  /** Pipeline framerate — scrub snaps to the frame, `s:ff` timecode. */
  fps: number;
  /** Track selector, when the media also carries animation clips. */
  trackSwitch?: ReactNode;
  /**
   * Attach — or detach — the animation to the next comment (layout mode).
   *
   * The state travels WITH the action, not beside it: attaching used to leave only a toast, so that
   * while writing the remark, nothing on screen said whether the animation would be sent — and one
   * sent believing it had been attached. The button therefore stays lit as long as it is attached,
   * and a second press detaches it.
   */
  attach?: { toggle: () => void; attached: boolean };
  drawerOpen: boolean;
  onDrawer: () => void;
}) {
  const t = useT();
  // `keyTimes` already merges the keys of all channels, sorted.
  const times = anim.keyTimes;
  // 1 ms floor: an animation with a single column of keys does not divide by zero.
  const span = Math.max(anim.playDuration, times[times.length - 1] ?? 0, 1);
  // `trackPct` clamps the position to the track — beyond it, the playhead overflowed and the
  // transport gained a horizontal scrollbar.
  const pct = (t: number) => trackPct(t, span);
  const goToKey = (dir: -1 | 1) => {
    const next =
      dir === 1
        ? times.find((t) => t > anim.timeMs + 1)
        : [...times].reverse().find((t) => t < anim.timeMs - 1);
    if (next !== undefined) anim.scrub(next);
  };

  // Drag-scrub on the track (pointer capture) — snaps to the frame, Alt to release.
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
          // Key diamonds keep their exact click (scrub to the key).
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
        max={MAX_SECONDS}
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
            max={MAX_SECONDS}
            step={0.5}
            unit="s"
          />
          <IconButton
            icon={KeyRound}
            label={t('review.autoKey')}
            bordered
            active={anim.autoKey}
            className={
              // Recording armed: a strong DCC-style state — impossible to forget it being on.
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
      {attach && (anim.hasAnimation || attach.attached) && (
        <IconButton
          icon={MessageSquarePlus}
          label={attach.attached ? t('review.camera.detachAnimation') : t('review.attachAnimation')}
          bordered
          active={attach.attached}
          onClick={attach.toggle}
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
