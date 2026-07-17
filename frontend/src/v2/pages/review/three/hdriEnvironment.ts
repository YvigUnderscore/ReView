import type * as THREE from 'three';
import type { LightingConfig } from '../reviewTypes';

/** Environnement HDRI prêt à l'emploi (texture PMREM) + libération. */
export interface HdriEnvironment {
  texture: THREE.Texture;
  dispose: () => void;
}

/**
 * Charge un HDRI équirectangulaire (.hdr via RGBELoader, .exr via EXRLoader) et le pré-filtre en
 * carte d'environnement (`PMREMGenerator`) exploitable par les matériaux PBR (Phase 29). Import
 * dynamique des loaders (hors bundle initial). Impur (GPU). La configuration (exposition/rotation/
 * fond) est appliquée à part par `applyLighting`.
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
 * Applique un éclairage au scene/renderer (Phase 29) : exposition (tone mapping), environnement
 * (image-based lighting), rotation Y de l'environnement et du fond, fond HDRI optionnel. Quand un
 * HDRI est actif, les lumières par défaut de la scène sont **atténuées** (évite le sur-éclairage) —
 * leur intensité d'origine est mémorisée dans `userData.baseIntensity` pour restauration.
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

  // Atténue les lumières « studio » par défaut quand l'HDRI éclaire déjà la scène.
  scene.traverse((o) => {
    const light = o as THREE.Light;
    if (!light.isLight) return;
    if (light.userData.baseIntensity == null) light.userData.baseIntensity = light.intensity;
    light.intensity = env
      ? (light.userData.baseIntensity as number) * 0.12
      : (light.userData.baseIntensity as number);
  });
}
