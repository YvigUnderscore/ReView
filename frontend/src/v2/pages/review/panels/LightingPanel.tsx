// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Save, Trash2 } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { DOCK_SELECT, Group, Row } from '../chrome/DockGroup';
import type { Model3DLightingState } from '../three/useModel3DLighting';
import { useT } from '../../../i18n';

/**
 * Panneau Éclairage du dock — modèle 3D seulement : un splat porte sa lumière cuite. Reprend
 * `LightingBar`. Le gestionnaire enregistre l'éclairage par défaut du projet (rejoué pour
 * tous à l'ouverture) ; un spectateur ne fait que régler sa session.
 */
export default function LightingPanel({
  lighting,
  colorDisplay,
  colorView,
}: {
  lighting: Model3DLightingState;
  /** Intention couleur OCIO du projet — lecture seule, héritée du projet. */
  colorDisplay?: string;
  colorView?: string;
}) {
  const t = useT();
  const { cfg, setCfg, hdris, busy, save, clear } = lighting;
  return (
    <>
      <Group title={t('viewer.env.title')}>
        <Select
          value={cfg.hdriId ?? ''}
          onChange={(e) => setCfg({ ...cfg, hdriId: e.target.value || undefined })}
          title={t('viewer.hdri.title')}
          className={DOCK_SELECT}
        >
          <option value="">{t('common.none')}</option>
          {hdris.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
        <Row label={t('viewer.exposure')}>
          <NumberField
            label="EV"
            value={Number(cfg.exposure.toFixed(2))}
            onChange={(exposure) => setCfg({ ...cfg, exposure })}
            min={-5}
            max={5}
            step={0.1}
            pixelsPerStep={6}
          />
        </Row>
        <Row label={t('viewer.hdri.rotation')}>
          <NumberField
            label="°"
            value={Math.round(cfg.rotationDeg)}
            onChange={(rotationDeg) => setCfg({ ...cfg, rotationDeg })}
            min={0}
            max={360}
            step={1}
          />
        </Row>
        <Row label={t('viewer.hdri.background')}>
          <Switch
            checked={cfg.showBackground}
            onCheckedChange={(showBackground) => setCfg({ ...cfg, showBackground })}
            label={t('viewer.hdri.background.hint')}
          />
        </Row>
        <Row label={t('viewer.shadowGround')}>
          <Switch
            checked={cfg.groundShadow}
            onCheckedChange={(groundShadow) => setCfg({ ...cfg, groundShadow })}
            label={t('viewer.shadowGround.hint')}
          />
        </Row>
      </Group>

      {(colorDisplay || colorView) && (
        <Group title={t('viewer.color.title')}>
          {colorDisplay && (
            <Row label="Display">
              <Badge variant="secondary">{colorDisplay}</Badge>
            </Row>
          )}
          {colorView && (
            <Row label="View">
              <Badge variant="secondary">{colorView}</Badge>
            </Row>
          )}
          <span className="rv-optbar__hint whitespace-normal">{t('viewer.color.inherited')}</span>
        </Group>
      )}

      {save && (
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => void save()}
            title={t('review.lighting.saveDefault')}
          >
            <Save size={13} />
            {t('review.projectLighting')}
          </Button>
          {clear && (
            <IconButton
              icon={Trash2}
              label={t('viewer.clearLighting')}
              bordered
              disabled={busy}
              onClick={() => void clear()}
            />
          )}
        </div>
      )}
    </>
  );
}
