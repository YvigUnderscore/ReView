// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Aperture, BookmarkPlus, Frame, Home } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import { Switch } from '../../../components/ui/switch';
import { Group, Row } from '../chrome/DockGroup';

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
  return (
    <>
      <Group title="Objectif">
        <Row label="Focale" hint="Focale en millimètres, capteur 36 mm">
          <NumberField label="mm" value={focalMm} onChange={onFocalMm} min={7} max={400} step={1} />
        </Row>
        <Row label="Tilt" hint="Inclinaison autour de l’axe de vue">
          <NumberField label="°" value={tiltDeg} onChange={onTiltDeg} min={-180} max={180} step={1} />
        </Row>
        {dof && (
          <>
            <Row label="Ouverture" hint="Profondeur de champ — 0 = net partout">
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
            <Row label="Mise au point au clic">
              <Switch
                checked={dof.focusPick}
                onCheckedChange={dof.onToggleFocusPick}
                label="Choisir la mise au point au clic"
              />
            </Row>
          </>
        )}
      </Group>

      <Group title="Cadrage">
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
        <Row label="Format" hint="Aspect de livraison hérité des réglages pipeline du shot">
          <span className="font-mono text-xs">{aspectLabel}</span>
        </Row>
        {layout && (
          <Row
            label="Vue de la caméra (PiP)"
            hint="Sortir de la caméra et voir son point de vue dans une fenêtre flottante"
          >
            <Switch
              checked={layout.active}
              onCheckedChange={layout.onToggle}
              label="Mode layout : vue de la caméra en PiP"
            />
          </Row>
        )}
      </Group>

      {bookmarks && (
        <Group
          title="Vues enregistrées"
          action={
            <IconButton
              icon={BookmarkPlus}
              label="Enregistrer la vue courante — partagée avec l’équipe"
              onClick={bookmarks.onSave}
            />
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
            {bookmarks.items.length === 0 && <span className="rv-optbar__hint">Aucune vue enregistrée.</span>}
          </div>
        </Group>
      )}
    </>
  );
}
