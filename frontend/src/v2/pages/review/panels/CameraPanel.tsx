// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Aperture, BookmarkPlus, Frame, Home, Orbit, Trash2, X } from 'lucide-react';
import { Button } from '@/v2/components/ui/button';
import { IconButton } from '@/v2/components/ui/icon-button';
import { NumberField } from '@/v2/components/ui/number-field';
import { Switch } from '@/v2/components/ui/switch';
import { Group, Row } from '../chrome/DockGroup';
import { useT } from '@/v2/i18n';

/** Saved view: a named camera pose, shared with the team (3D). */
export interface CameraBookmark {
  id: string;
  label: string;
}

/**
 * Camera panel of the spatial dock: the lens and framing, inherited from `CameraBar` and
 * `BookmarksBar`, which floated above the scene. Settings are local to the viewer, except the saved
 * views (shared) and what the manager persists in staging.
 */
export default function CameraPanel({
  focalMm,
  onFocalMm,
  tiltDeg,
  onTiltDeg,
  dof,
  layout,
  aspect,
  onFrame,
  onHome,
  bookmarks,
}: {
  focalMm: number;
  onFocalMm: (mm: number) => void;
  tiltDeg: number;
  onTiltDeg: (deg: number) => void;
  /** Depth of field: splat only. */
  dof?: {
    aperture: number;
    onAperture: (v: number) => void;
    focusPick: boolean;
    onToggleFocusPick: () => void;
  };
  /**
   * Camera workshop ("Staging"): one steps out of the shot's camera to adjust it from outside, its
   * view remaining in the PiP window. The switch **drives the chrome's mode** in both viewers: it is
   * the only entry to the mode, and hence the only source of truth for "in / out of camera" (model:
   * `viewer/useLayoutMode`).
   */
  layout?: {
    active: boolean;
    onToggle: () => void;
    /** Label and tooltip: the name of the armed mode, not that of the window it opens. */
    label: string;
    hint: string;
    /** Orbit preset: one full turn around the current target (manager). */
    onOrbit?: () => void;
    /** Clears the persisted presentation (confirmation upstream: manager). */
    onClear?: () => void;
  };
  /**
   * Review frame, read-only: the written ratio and its origin. `frozen` = it comes from a saved
   * presentation, and the pipeline settings no longer apply to it. The tooltip must say so: it
   * promised an inheritance that did not take place.
   */
  aspect: { label: string; frozen: boolean };
  onFrame: () => void;
  onHome: () => void;
  bookmarks?: {
    items: CameraBookmark[];
    activeId: string | null;
    onGo: (id: string) => void;
    /** Records the current view: absent outside the manager. */
    onSave?: () => void;
    /** Removes a saved view: absent outside the manager. */
    onRemove?: (id: string) => void;
    /** Writing of the current presentation: adding waits. */
    busy?: boolean;
    /** At most this many: a free slot again as long as no view is removed. */
    full?: boolean;
  };
}) {
  const t = useT();
  return (
    <>
      <Group title={t('viewer.lens.title')}>
        <Row label={t('viewer.focal')} hint={t('viewer.focal.hint')}>
          <NumberField label="mm" value={focalMm} onChange={onFocalMm} min={7} max={400} step={1} />
        </Row>
        <Row label={t('viewer.tilt')} hint={t('viewer.tilt.hint')}>
          <NumberField label="°" value={tiltDeg} onChange={onTiltDeg} min={-180} max={180} step={1} />
        </Row>
        {dof && (
          <>
            <Row label={t('viewer.aperture')} hint={t('viewer.aperture.hint')}>
              <NumberField
                label={<Aperture size={13} />}
                value={dof.aperture}
                onChange={dof.onAperture}
                min={0}
                max={0.1}
                step={0.002}
                pixelsPerStep={6}
              />
            </Row>
            <Row label={t('viewer.focusClick')}>
              <Switch
                checked={dof.focusPick}
                onCheckedChange={dof.onToggleFocusPick}
                label={t('viewer.focusClick.hint')}
              />
            </Row>
          </>
        )}
      </Group>

      <Group title={t('viewer.framing.title')}>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="flex-1" onClick={onFrame}>
            <Frame size={13} />
            {t('camera.frameSelection')}
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={onHome}>
            <Home size={13} />
            {t('camera.home')}
          </Button>
        </div>
        <Row
          label={t('viewer.format')}
          hint={aspect.frozen ? t('viewer.format.hint.frozen') : t('viewer.format.hint')}
        >
          <span className="font-mono text-xs">{aspect.label}</span>
        </Row>
        {layout && (
          <Row label={layout.label} hint={layout.hint}>
            <Switch checked={layout.active} onCheckedChange={layout.onToggle} label={t('viewer.pip.hint')} />
          </Row>
        )}
        {(layout?.onOrbit || layout?.onClear) && (
          <div className="flex gap-1.5">
            {layout.onOrbit && (
              <Button size="sm" variant="outline" className="flex-1" onClick={layout.onOrbit}>
                <Orbit size={13} />
                {t('camera.orbitPreset')}
              </Button>
            )}
            {layout.onClear && (
              <Button size="sm" variant="outline" className="flex-1" onClick={layout.onClear}>
                <Trash2 size={13} />
                {t('camera.clearPresentation')}
              </Button>
            )}
          </div>
        )}
      </Group>

      {bookmarks && (
        <Group
          title={t('viewer.bookmarks.title')}
          action={
            bookmarks.onSave && (
              <IconButton
                icon={BookmarkPlus}
                label={bookmarks.full ? t('viewer.bookmarks.full') : t('viewer.bookmarks.save')}
                disabled={bookmarks.busy || bookmarks.full}
                onClick={bookmarks.onSave}
              />
            )
          }
        >
          <div className="flex flex-wrap gap-1">
            {bookmarks.items.map((v, i) => {
              const onRemove = bookmarks.onRemove;
              return (
                // Two distinct gestures on the same chip: one button each. The recall cannot
                // contain the deletion (button inside button).
                <span
                  key={v.id}
                  className={`flex min-h-[26px] items-center rounded border text-[0.625rem] transition-colors ${
                    bookmarks.activeId === v.id
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <button
                    type="button"
                    title={t('camera.bookmarkKey', { label: v.label, key: `Alt+${i + 1}` })}
                    onClick={() => bookmarks.onGo(v.id)}
                    className="flex items-center gap-1 px-1.5 py-1"
                  >
                    {i < 9 && <span className="rv-kbd px-[3px]">Alt+{i + 1}</span>}
                    {v.label}
                  </button>
                  {onRemove && (
                    <button
                      type="button"
                      title={t('viewer.bookmarks.remove')}
                      aria-label={t('viewer.bookmarks.remove')}
                      disabled={bookmarks.busy}
                      onClick={() => onRemove(v.id)}
                      className="px-1 py-1 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                    >
                      <X size={11} />
                    </button>
                  )}
                </span>
              );
            })}
            {bookmarks.items.length === 0 && (
              <span className="rv-optbar__hint">{t('viewer.bookmarks.empty')}</span>
            )}
          </div>
        </Group>
      )}
    </>
  );
}
