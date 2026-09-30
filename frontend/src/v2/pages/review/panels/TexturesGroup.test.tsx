// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as THREE from 'three';
import TexturesGroup from './TexturesGroup';
import { DOCK_GROUP_COLLAPSE_THRESHOLD } from '../chrome/dockGroupSize';
import type { TextureInfo } from '../three/modelStats';
import { t } from '../../../i18n';

/**
 * Inspecteur de textures : la vignette de 48 px n'était pas cliquable, donc on ne pouvait pas
 * juger une texture — seulement constater qu'il y en avait une. Elle ouvre désormais la
 * lightbox du dépôt, en carrousel, à la résolution du fichier.
 */

function texture(src: string | null, width = 1024, height = 512): THREE.Texture {
  const tex = new THREE.Texture();
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    Object.defineProperty(img, 'naturalWidth', { value: width });
    Object.defineProperty(img, 'naturalHeight', { value: height });
    tex.image = img;
  }
  return tex;
}

const info = (slot: string, src: string | null): TextureInfo =>
  ({
    slot,
    material: `M_${slot}`,
    name: slot,
    width: 1024,
    height: 512,
    texture: texture(src),
  }) as TextureInfo;

describe('TexturesGroup', () => {
  it('ouvre la texture en grand au clic sur sa vignette', () => {
    render(<TexturesGroup textures={[info('map', 'blob:review/albedo')]} />);
    const open = screen.getByRole('button', { name: t('model3d.texture.open') });
    fireEvent.click(open);
    // La lightbox est un dialogue plein écran : l'image y est servie à sa résolution native.
    const image = screen.getByRole('dialog').querySelector('img');
    expect(image).toHaveAttribute('src', 'blob:review/albedo');
  });

  it('offre le carrousel quand plusieurs textures sont ouvrables', () => {
    render(<TexturesGroup textures={[info('map', 'blob:review/a'), info('normalMap', 'blob:review/b')]} />);
    fireEvent.click(screen.getAllByRole('button', { name: t('model3d.texture.open') })[0]);
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('lightbox.zoomIn') }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('n’offre pas l’ouverture d’une texture que le navigateur ne sait pas exporter', () => {
    // Pas d'image exploitable hors WebGL : la vignette reste, le bouton est inerte plutôt
    // que d'ouvrir un cadre noir.
    render(<TexturesGroup textures={[info('roughnessMap', null)]} />);
    const button = screen.getByRole('button', { name: t('model3d.texture.notOpenable') });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('arrive replié quand la liste dépasse le seuil du dock, et se déplie au clic', () => {
    const many = Array.from({ length: DOCK_GROUP_COLLAPSE_THRESHOLD + 1 }, (_, i) =>
      info(`slot${i}`, `blob:review/${i}`),
    );
    render(<TexturesGroup textures={many} />);
    expect(screen.queryByRole('button', { name: t('model3d.texture.open') })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('model3d.textures')) }));
    expect(screen.getAllByRole('button', { name: t('model3d.texture.open') })).toHaveLength(many.length);
  });

  it('reste déplié tant que la liste tient dans le panneau', () => {
    const few = Array.from({ length: DOCK_GROUP_COLLAPSE_THRESHOLD }, (_, i) =>
      info(`slot${i}`, `blob:review/${i}`),
    );
    render(<TexturesGroup textures={few} />);
    expect(screen.getAllByRole('button', { name: t('model3d.texture.open') })).toHaveLength(few.length);
  });
});
