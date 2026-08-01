import { Save, Trash2 } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { DOCK_SELECT, Group, Row } from '../chrome/DockGroup';
import type { Model3DLightingState } from '../three/useModel3DLighting';

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
  const { cfg, setCfg, hdris, busy, save, clear } = lighting;
  return (
    <>
      <Group title="Environnement">
        <Select
          value={cfg.hdriId ?? ''}
          onChange={(e) => setCfg({ ...cfg, hdriId: e.target.value || undefined })}
          title="Environnement HDRI (éclairage image)"
          className={DOCK_SELECT}
        >
          <option value="">Aucun</option>
          {hdris.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
        <Row label="Exposition">
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
        <Row label="Rotation Y">
          <NumberField
            label="°"
            value={Math.round(cfg.rotationDeg)}
            onChange={(rotationDeg) => setCfg({ ...cfg, rotationDeg })}
            min={0}
            max={360}
            step={1}
          />
        </Row>
        <Row label="HDRI en fond">
          <Switch
            checked={cfg.showBackground}
            onCheckedChange={(showBackground) => setCfg({ ...cfg, showBackground })}
            label="Afficher l’HDRI en fond"
          />
        </Row>
        <Row label="Sol d’ombres">
          <Switch
            checked={cfg.groundShadow}
            onCheckedChange={(groundShadow) => setCfg({ ...cfg, groundShadow })}
            label="Sol récepteur d’ombres portées"
          />
        </Row>
      </Group>

      {(colorDisplay || colorView) && (
        <Group title="Gestion de couleur">
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
          <span className="rv-optbar__hint whitespace-normal">Hérité des réglages du projet (OCIO).</span>
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
            title="Enregistrer l’éclairage par défaut — rejoué pour tous à l’ouverture"
          >
            <Save size={13} />
            Éclairage par défaut du projet
          </Button>
          {clear && (
            <IconButton
              icon={Trash2}
              label="Effacer l’éclairage par défaut"
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
