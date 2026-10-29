// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { LightingConfig } from '../reviewTypes';

/** Ready-to-use HDRI environment (PMREM texture) and its release. */
export interface HdriEnvironment {
  texture: THREE.Texture;
  dispose: () => void;
}

/**
 * Loads an equirectangular HDRI (.hdr via RGBELoader, .exr via EXRLoader) and pre-filters it into an
 * environment map (`PMREMGenerator`) usable by the PBR materials (Phase 29). Dynamic import of the
 * loaders (out of the initial bundle). Impure (GPU). The configuration (exposure, rotation, background)
 * is applied separately by `applyLighting`.
 */
export async function loadHdriEnvironment(
  THREE: typeof import('three'),
  renderer: THREE.WebGLRenderer,
  url: string,
  format: 'hdr' | 'exr',
): Promise<HdriEnvironment> {
  let data: THREE.DataTexture;
  if (format === 'exr') {
    const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
    data = await new EXRLoader().loadAsync(url);
  } else {
    const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
    data = await new RGBELoader().loadAsync(url);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(data);
  data.dispose();
  pmrem.dispose();
  return { texture: rt.texture, dispose: () => rt.dispose() };
}

/**
 * Applies lighting to the scene and renderer (Phase 29): exposure (tone mapping), environment
 * (image-based lighting), Y rotation of the environment and of the background, optional HDRI background.
 * When an HDRI is active, the scene's default lights are **attenuated** (avoids over-lighting);
 * their original intensity is stored in `userData.baseIntensity` for restoration.
 */
export function applyLighting(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  env: THREE.Texture | null,
  cfg: LightingConfig,
): void {
  renderer.toneMappingExposure = cfg.exposure;
  const rot = (cfg.rotationDeg * Math.PI) / 180;
  scene.environment = env;
  scene.environmentRotation.set(0, rot, 0);
  scene.background = env && cfg.showBackground ? env : null;
  scene.backgroundRotation.set(0, rot, 0);

  // Attenuates the default 'studio' lights when the HDRI already lights the scene.
  scene.traverse((o) => {
    const light = o as THREE.Light;
    if (!light.isLight) return;
    if (light.userData.baseIntensity == null) light.userData.baseIntensity = light.intensity;
    light.intensity = env
      ? (light.userData.baseIntensity as number) * 0.12
      : (light.userData.baseIntensity as number);
  });
}
