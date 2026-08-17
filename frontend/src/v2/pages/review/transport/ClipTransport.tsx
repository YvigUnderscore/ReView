// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Gauge, Pause, Play, Repeat } from 'lucide-react';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import { Select } from '../../../components/ui/select';
import type { Model3DThreeState } from '../three/useModel3DThree';
import { useT } from '../../../i18n';

const fmt = (ms: number) => (ms / 1000).toFixed(2);

/**
 * Transport des clips d'animation portés par le fichier glTF — remplace
 * `Model3DAnimationsBar`, qui flottait sous la scène. Même piste que l'animation caméra :
 * clic pour se placer, tête de lecture, temps, vitesse, boucle.
 */
export default function ClipTransport({ m, trackSwitch }: { m: Model3DThreeState; trackSwitch?: ReactNode }) {
  const t = useT();
  const duration = Math.max(m.durationMs, 1);
  const time = Math.min(m.timeMs, m.durationMs);

  return (
    <div className="rv-transport">
      {trackSwitch}
      {m.animations.length === 0 ? (
        <span className="rv-optbar__hint">{t('review.clip.none')}</span>
      ) : (
        <>
          <IconButton
            icon={m.playing ? Pause : Play}
            label={m.playing ? t('video.pauseKey') : t('video.playKey')}
            bordered
            active={m.playing}
            onClick={m.playing ? m.pause : m.play}
          />
          <div
            className="rv-track"
            style={{ flex: '1 1 200px', minWidth: 160 }}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              m.scrub(Math.max(0, ((e.clientX - r.left) / r.width) * duration));
            }}
            onKeyDown={(e) => {
              // Équivalent clavier du clic : les flèches déplacent la tête de lecture de 5 %.
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const delta = (e.key === 'ArrowRight' ? 1 : -1) * duration * 0.05;
              m.scrub(Math.min(duration, Math.max(0, time + delta)));
            }}
          >
            <span className="rv-track__rail" />
            <span className="rv-track__fill" style={{ width: `${(time / duration) * 100}%` }} />
            <span className="rv-track__head" style={{ left: `${(time / duration) * 100}%` }} />
          </div>
          <span className="font-mono text-[0.625rem]">
            <span className="text-primary">{fmt(time)}</span> / {fmt(m.durationMs)} s
          </span>
          <NumberField
            label={<Gauge size={13} />}
            hint={t('review.clip.speed')}
            value={m.speed}
            onChange={m.setSpeed}
            min={0.1}
            max={4}
            step={0.1}
            pixelsPerStep={6}
            unit="×"
          />
          <IconButton
            icon={Repeat}
            label={t('video.loopAll')}
            bordered
            active={m.loop}
            onClick={() => m.setLoop(!m.loop)}
          />
          {m.animations.length > 1 && (
            <Select
              value={m.currentAnim ?? ''}
              onChange={(e) => m.selectAnim(e.target.value)}
              title={t('review.clip.playing')}
              className="px-1.5 py-1 text-xs"
            >
              {m.animations.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          )}
        </>
      )}
    </div>
  );
}
