import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { keyframesFromSamples, samplesFromTracks } from './importCameraGltf';

describe('importCameraGltf — glTF → keyframes de review', () => {
  it('dérive cible (direction de vue) et roll depuis position/quaternion', () => {
    // Quaternion identité → regarde vers -Z, up +Y (roll 0).
    const kf = keyframesFromSamples(
      THREE,
      [
        { t: 0, pos: [0, 0, 5], quat: [0, 0, 0, 1] },
        { t: 2, pos: [3, 0, 0], quat: [0, 0, 0, 1] },
      ],
      50,
      2,
    );
    expect(kf).toHaveLength(2);
    expect(kf[0].t).toBe(0);
    expect(kf[1].t).toBe(2000); // secondes → ms
    expect(kf[0].pose.fov).toBe(50);
    // cible = position + (0,0,-1)*2
    expect(kf[0].pose.target.z).toBeCloseTo(3);
    expect(kf[0].pose.roll ?? 0).toBeCloseTo(0);
  });

  it('récupère le roll d’un quaternion incliné', () => {
    // Rotation de π/2 autour de -Z (axe de vue) → roll.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), Math.PI / 2);
    const kf = keyframesFromSamples(THREE, [{ t: 0, pos: [0, 0, 0], quat: [q.x, q.y, q.z, q.w] }]);
    expect(Math.abs(kf[0].pose.roll ?? 0)).toBeCloseTo(Math.PI / 2);
  });

  it('samplesFromTracks zippe position et quaternion par index', () => {
    const s = samplesFromTracks([
      { name: 'node.position', times: [0, 1], values: [0, 0, 0, 1, 2, 3] },
      { name: 'node.quaternion', times: [0, 1], values: [0, 0, 0, 1, 0, 0, 0, 1] },
    ]);
    expect(s).toHaveLength(2);
    expect(s[1].pos).toEqual([1, 2, 3]);
    expect(s[1].quat).toEqual([0, 0, 0, 1]);
  });

  it('sans piste position : aucun échantillon', () => {
    expect(samplesFromTracks([{ name: 'node.scale', times: [0], values: [1, 1, 1] }])).toHaveLength(0);
  });
});
