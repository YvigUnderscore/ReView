import { describe, it, expect, beforeEach } from 'vitest';
import { inferMediaKind, uploadMedia } from './uploadClient';

const f = (name: string, type = '') => new File(['x'], name, { type });

beforeEach(() => localStorage.clear());

describe('inferMediaKind', () => {
  it('reconnaît les modèles 3D par extension (prioritaire sur le MIME)', () => {
    expect(inferMediaKind(f('scene.glb'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('Scene.GLTF'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('rig.fbx', 'application/octet-stream'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('archive.zip', 'application/zip'))).toBe('MODEL_3D');
  });

  it('reconnaît toutes les déclinaisons USD (45.F)', () => {
    // `.usd` n'était pas listé : il n'arrivait en MODEL_3D que par le repli final.
    expect(inferMediaKind(f('scene.usd'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('asset.usda'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('asset.usdc'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('PACK.USDZ'))).toBe('MODEL_3D');
  });

  it('reconnaît les Gaussian Splats par extension (viewer Spark)', () => {
    expect(inferMediaKind(f('scan.ply'))).toBe('SPLAT');
    expect(inferMediaKind(f('scene.spz'))).toBe('SPLAT');
    expect(inferMediaKind(f('cloud.splat'))).toBe('SPLAT');
    expect(inferMediaKind(f('big.ksplat'))).toBe('SPLAT');
    expect(inferMediaKind(f('compressed.SOG'))).toBe('SPLAT');
  });

  it('reconnaît vidéo et image par type MIME', () => {
    expect(inferMediaKind(f('plan.mp4', 'video/mp4'))).toBe('VIDEO');
    expect(inferMediaKind(f('ref.png', 'image/png'))).toBe('IMAGE');
  });

  it('repli MODEL_3D pour les types inconnus', () => {
    expect(inferMediaKind(f('donnees.bin', 'application/octet-stream'))).toBe('MODEL_3D');
  });
});

describe('uploadMedia', () => {
  it('refuse de démarrer sans token (aucun appel réseau)', async () => {
    await expect(uploadMedia(f('a.png', 'image/png'), 1)).rejects.toThrow('Non authentifié');
  });
});
