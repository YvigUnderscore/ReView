// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Aperture, BookmarkPlus, Frame, Home } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import { Switch } from '../../../components/ui/switch';
import { Group, Row } from '../chrome/DockGroup';
import { useT } from '../../../i18n';

/** Vue enregistrée : pose de caméra nommée, partagée avec l'équipe (3D). */
export interface CameraBookmark {
  id: string;
  label: string;
}

/**
 * Panneau Caméra du dock spatial — l'objectif et le cadrage, hérités de `CameraBar` et de
 * `BookmarksBar` qui flottaient au-dessus de la scène. Réglages locaux au spectateur, sauf
 * les vues enregistrées (partagées) et ce que le gestionnaire persiste en mise en scène.
 */
export default function CameraPanel({
  focalMm,
  onFocalMm,
  tiltDeg,
  onTiltDeg,
  dof,
  layout,
  aspectLabel,
  onFrame,
  onHome,
  bookmarks,
}: {
  focalMm: number;
  onFocalMm: (mm: number) => void;
  tiltDeg: number;
  onTiltDeg: (deg: number) => void;
  /** Profondeur de champ — splat uniquement. */
  dof?: {
    aperture: number;
    onAperture: (v: number) => void;
    focusPick: boolean;
    onToggleFocusPick: () => void;
  };
  /** Mode layout : vue de la caméra dans une fenêtre PiP. */
  layout?: { active: boolean; onToggle: () => void };
  /** Aspect du cadre de review — hérité des réglages pipeline, en lecture seule. */
  aspectLabel: string;
  onFrame: () => void;
  onHome: () => void;
  bookmarks?: {
    items: CameraBookmark[];
    activeId: string | null;
    onGo: (id: string) => void;
    onSave: () => void;
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
            Cadrer
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={onHome}>
            <Home size={13} />
            Origine
          </Button>
        </div>
        <Row label={t('viewer.format')} hint={t('viewer.format.hint')}>
          <span className="font-mono text-xs">{aspectLabel}</span>
        </Row>
        {layout && (
          <Row label={t('viewer.pip')} hint={t('review.camera.exitToPip')}>
            <Switch checked={layout.active} onCheckedChange={layout.onToggle} label={t('viewer.pip.hint')} />
          </Row>
        )}
      </Group>

      {bookmarks && (
        <Group
          title={t('viewer.bookmarks.title')}
          action={
            <IconButton icon={BookmarkPlus} label={t('viewer.bookmarks.save')} onClick={bookmarks.onSave} />
          }
        >
          <div className="flex flex-wrap gap-1">
            {bookmarks.items.map((v, i) => (
              <button
                key={v.id}
                type="button"
                title={`${v.label} — touche ${i + 1}`}
                onClick={() => bookmarks.onGo(v.id)}
                className={`flex min-h-[26px] items-center gap-1 rounded border px-1.5 text-[0.625rem] transition-colors ${
                  bookmarks.activeId === v.id
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {i < 9 && <span className="rv-kbd px-[3px]">{i + 1}</span>}
                {v.label}
              </button>
            ))}
            {bookmarks.items.length === 0 && (
              <span className="rv-optbar__hint">{t('viewer.bookmarks.empty')}</span>
            )}
          </div>
        </Group>
      )}
    </>
  );
}
