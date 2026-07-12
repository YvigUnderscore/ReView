import { describe, expect, it } from 'vitest';
import type { SplatCameraKeyframe } from '../../reviewTypes';
import { animDuration, applyEasing, orbitPreset, sampleAnim, samplePoseSpline } from './cameraAnim';

const pose = (x: number, fov?: number) => ({
  position: { x, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  ...(fov != null ? { fov } : {}),
});

const KF: SplatCameraKeyframe[] = [
  { t: 0, pose: pose(0, 40), easing: 'linear' },
  { t: 1000, pose: pose(10, 60), easing: 'ease-in-out' },
  { t: 2000, pose: pose(20), easing: 'linear' },
];

describe('sampleAnim', () => {
  it('interpole linéairement dans un segment (position + fov)', () => {
    const p = sampleAnim(KF, 500, false)!;
    expect(p.position.x).toBeCloseTo(5);
    expect(p.fov).toBeCloseTo(50);
  });

  it("applique l'easing du segment (porté par la keyframe de départ)", () => {
    // Segment 1000→2000 : easing ease-in-out (smoothstep) — à u=0,25, s = 0,15625.
    const p = sampleAnim(KF, 1250, false)!;
    expect(p.position.x).toBeCloseTo(10 + 10 * 0.15625);
  });

  it('borne hors boucle et enroule en boucle', () => {
    expect(sampleAnim(KF, 5000, false)!.position.x).toBeCloseTo(20);
    expect(sampleAnim(KF, 2500, true)!.position.x).toBeCloseTo(5); // 2500 % 2000 = 500
    expect(animDuration(KF)).toBe(2000);
  });

  it('null si moins de 2 keyframes', () => {
    expect(sampleAnim([KF[0]], 0, false)).toBeNull();
    expect(sampleAnim([], 0, true)).toBeNull();
  });
});

describe('interpolation par courbes (16.A)', () => {
  // 4 poses non alignées pour distinguer spline et segments linéaires.
  const curve: SplatCameraKeyframe[] = [
    { t: 0, pose: { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }, easing: 'linear' },
    { t: 1000, pose: { position: { x: 10, y: 10, z: 0 }, target: { x: 0, y: 0, z: 0 } }, easing: 'linear' },
    { t: 2000, pose: { position: { x: 20, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }, easing: 'linear' },
    { t: 3000, pose: { position: { x: 30, y: 10, z: 0 }, target: { x: 0, y: 0, z: 0 } }, easing: 'linear' },
  ];

  it('la spline passe exactement par les keyframes (u=0 et u=1)', () => {
    expect(samplePoseSpline(curve, 1, 0).position).toMatchObject({ x: 10, y: 10 });
    expect(samplePoseSpline(curve, 1, 1).position).toMatchObject({ x: 20, y: 0 });
  });

  it('la spline dévie de la droite dans le segment (courbe)', () => {
    // t=1250 → segment [1000,2000], u=0,25. Linéaire : y = 7,5 ; spline ≠ 7,5.
    const lin = sampleAnim(curve, 1250, false, false)!;
    const sp = sampleAnim(curve, 1250, false, true)!;
    expect(lin.position.y).toBeCloseTo(7.5);
    expect(sp.position.y).not.toBeCloseTo(7.5);
  });

  it('smooth=false reste identique au linéaire', () => {
    expect(sampleAnim(curve, 1250, false, false)!.position.y).toBeCloseTo(7.5);
  });
});

describe('applyEasing', () => {
  it('bornes 0/1 conservées pour tous les easings', () => {
    for (const e of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
      expect(applyEasing(0, e)).toBe(0);
      expect(applyEasing(1, e)).toBe(1);
    }
  });
});

describe('orbitPreset', () => {
  it('fait un tour complet à rayon constant et revient à la pose de départ', () => {
    const from = { position: { x: 3, y: 2, z: 4 }, target: { x: 0, y: 0, z: 0 }, fov: 55 };
    const kf = orbitPreset(from, 8000);
    expect(kf).toHaveLength(9);
    expect(kf[0].pose.position.x).toBeCloseTo(from.position.x);
    expect(kf[0].pose.position.z).toBeCloseTo(from.position.z);
    expect(kf[8].pose.position.x).toBeCloseTo(from.position.x);
    expect(kf[8].pose.position.z).toBeCloseTo(from.position.z);
    expect(kf[8].t).toBe(8000);
    const r0 = Math.hypot(3, 4);
    for (const k of kf) {
      expect(Math.hypot(k.pose.position.x, k.pose.position.z)).toBeCloseTo(r0);
      expect(k.pose.position.y).toBe(2); // hauteur conservée
      expect(k.pose.fov).toBe(55);
    }
  });
});
