import { describe, it, expect } from 'vitest';
import { MediaKind } from '@prisma/client';
import { detectVideo, detectImage, detect3D, validateMediaHeader, getExtension } from './fileSignatures';

const buf = (...bytes: number[]) => Buffer.from(bytes);

describe('detectImage', () => {
  it('reconnaît un JPG', () => {
    expect(detectImage(buf(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('.jpg');
  });
  it('reconnaît un PNG', () => {
    expect(detectImage(buf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))).toBe('.png');
  });
  it('reconnaît un WEBP', () => {
    expect(detectImage(buf(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('.webp');
  });
  it('rejette un buffer inconnu', () => {
    expect(detectImage(buf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11))).toBeNull();
  });
});

describe('detectVideo', () => {
  it('reconnaît un MP4 (ftyp)', () => {
    expect(detectVideo(buf(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d))).toBe('.mp4');
  });
  it('reconnaît un MOV (qt brand)', () => {
    expect(detectVideo(buf(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20))).toBe('.mov');
  });
  it('reconnaît un WEBM', () => {
    expect(detectVideo(buf(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('.webm');
  });
});

describe('detect3D', () => {
  it('reconnaît un GLB', () => {
    expect(detect3D(buf(0x67, 0x6c, 0x54, 0x46), null, 100)).toBe('.glb');
  });
  it('reconnaît une archive ZIP 3D (PK + hint .zip)', () => {
    expect(detect3D(buf(0x50, 0x4b, 0x03, 0x04), '.zip', 500)).toBe('.zip');
    expect(detect3D(buf(0, 0, 0, 0), '.zip', 500)).toBeNull();
  });
  it('reconnaît un glTF JSON (hint + premier caractère {)', () => {
    expect(detect3D(buf(0x7b, 0x22, 0x61, 0x22), '.gltf', 100)).toBe('.gltf');
  });
  it('reconnaît un OBJ par hint + taille (converti en GLB ensuite)', () => {
    expect(detect3D(buf(0x76, 0x20, 0x30, 0x20), '.obj', 200)).toBe('.obj');
    expect(detect3D(buf(0x76, 0x20, 0x30, 0x20), '.obj', 0)).toBeNull();
  });
});

describe('validateMediaHeader', () => {
  it('valide selon le kind attendu', () => {
    expect(validateMediaHeader(MediaKind.IMAGE, buf(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0), '.jpg', 100)).toBe('.jpg');
    expect(validateMediaHeader(MediaKind.VIDEO, buf(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0), '.jpg', 100)).toBeNull();
  });
});

describe('getExtension', () => {
  it('extrait l\'extension en minuscules', () => {
    expect(getExtension('Scene.GLB')).toBe('.glb');
    expect(getExtension('noext')).toBe('');
  });
});
