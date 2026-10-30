// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as THREE from 'three';
import TexturesGroup from './TexturesGroup';
import { DOCK_GROUP_COLLAPSE_THRESHOLD } from '../chrome/dockGroupSize';
import type { TextureInfo } from '../three/modelStats';
import { t } from '@/v2/i18n';

/**
 * Texture inspector: the 48 px thumbnail was not clickable, so one could not judge a texture, only
 * notice that there was one. It now opens the repository's lightbox, as a carousel, at the file's
 * resolution.
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
  it('opens the texture full size on clicking its thumbnail', () => {
    render(<TexturesGroup textures={[info('map', 'blob:review/albedo')]} />);
    const open = screen.getByRole('button', { name: t('model3d.texture.open') });
    fireEvent.click(open);
    // The lightbox is a full-screen dialog: the image is served there at its native resolution.
    const image = screen.getByRole('dialog').querySelector('img');
    expect(image).toHaveAttribute('src', 'blob:review/albedo');
  });

  it('offers the carousel when several textures can be opened', () => {
    render(<TexturesGroup textures={[info('map', 'blob:review/a'), info('normalMap', 'blob:review/b')]} />);
    fireEvent.click(screen.getAllByRole('button', { name: t('model3d.texture.open') })[0]);
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('lightbox.zoomIn') }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not offer to open a texture the browser cannot export', () => {
    // No usable image outside WebGL: the thumbnail stays, and the button is inert rather than
    // opening a black frame.
    render(<TexturesGroup textures={[info('roughnessMap', null)]} />);
    const button = screen.getByRole('button', { name: t('model3d.texture.notOpenable') });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('arrives collapsed when the list exceeds the dock threshold, and expands on click', () => {
    const many = Array.from({ length: DOCK_GROUP_COLLAPSE_THRESHOLD + 1 }, (_, i) =>
      info(`slot${i}`, `blob:review/${i}`),
    );
    render(<TexturesGroup textures={many} />);
    expect(screen.queryByRole('button', { name: t('model3d.texture.open') })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('model3d.textures')) }));
    expect(screen.getAllByRole('button', { name: t('model3d.texture.open') })).toHaveLength(many.length);
  });

  it('stays expanded as long as the list fits in the panel', () => {
    const few = Array.from({ length: DOCK_GROUP_COLLAPSE_THRESHOLD }, (_, i) =>
      info(`slot${i}`, `blob:review/${i}`),
    );
    render(<TexturesGroup textures={few} />);
    expect(screen.getAllByRole('button', { name: t('model3d.texture.open') })).toHaveLength(few.length);
  });
});
