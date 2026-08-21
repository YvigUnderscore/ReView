// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Aperture, BookmarkPlus, Frame, Home, Orbit, Trash2, X } from 'lucide-react';
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
  /** Mode layout : vue de la caméra dans une fenêtre PiP, preset d'animation, remise à zéro. */
  layout?: {
    active: boolean;
    onToggle: () => void;
    /** Preset orbite : un tour complet autour de la cible courante (gestionnaire). */
    onOrbit?: () => void;
    /** Efface la présentation persistée (confirmation en amont — gestionnaire). */
    onClear?: () => void;
  };
  /** Aspect du cadre de review — hérité des réglages pipeline, en lecture seule. */
  aspectLabel: string;
  onFrame: () => void;
  onHome: () => void;
  bookmarks?: {
    items: CameraBookmark[];
    activeId: string | null;
    onGo: (id: string) => void;
    /** Enregistre la vue courante — absent hors gestionnaire. */
    onSave?: () => void;
    /** Retire une vue enregistrée — absent hors gestionnaire. */
    onRemove?: (id: string) => void;
    /** Écriture de la présentation en cours : l'ajout attend. */
    busy?: boolean;
    /** Liste au maximum : plus un slot libre tant qu'une vue n'est pas retirée. */
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
        <Row label={t('viewer.format')} hint={t('viewer.format.hint')}>
          <span className="font-mono text-xs">{aspectLabel}</span>
        </Row>
        {layout && (
          <Row label={t('viewer.pip')} hint={t('review.camera.exitToPip')}>
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
                // Deux gestes distincts sur la même pastille : un bouton chacun — le rappel ne
                // peut pas contenir la suppression (bouton dans bouton).
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
