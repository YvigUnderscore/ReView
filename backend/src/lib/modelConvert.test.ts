// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  isUsdModel,
  pickModelFile,
  chooseConverter,
  sourceFormatLabel,
  MODEL_PRIORITY,
} from './modelConvert';

describe('isUsdModel', () => {
  it('recognises usd/usdc/usda (case-insensitive)', () => {
    expect(isUsdModel('.usd')).toBe(true);
    expect(isUsdModel('.usdc')).toBe(true);
    expect(isUsdModel('.USDA')).toBe(true);
  });
  it('excludes usdz (archive) and the other formats', () => {
    expect(isUsdModel('.usdz')).toBe(false);
    expect(isUsdModel('.glb')).toBe(false);
    expect(isUsdModel('.fbx')).toBe(false);
  });
});

describe('pickModelFile', () => {
  it('picks the highest-priority format (gltf > glb > fbx > usd)', () => {
    const files = ['/tmp/tex.png', '/tmp/scene.usdc', '/tmp/model.fbx', '/tmp/scene.gltf'];
    expect(pickModelFile(files)).toBe('/tmp/scene.gltf');
  });
  it('falls back to the best available and ignores the attachments', () => {
    expect(pickModelFile(['/a/color.jpg', '/a/mesh.obj', '/a/notes.txt'])).toBe('/a/mesh.obj');
    expect(pickModelFile(['/a/scene.usda', '/a/scene.usdc'])).toBe('/a/scene.usdc');
  });
  it('returns null without a recognised 3D file', () => {
    expect(pickModelFile(['/a/readme.md', '/a/photo.png'])).toBeNull();
  });
  it('MODEL_PRIORITY covers the expected formats in order', () => {
    expect(MODEL_PRIORITY.indexOf('.gltf')).toBeLessThan(MODEL_PRIORITY.indexOf('.fbx'));
    expect(MODEL_PRIORITY.indexOf('.fbx')).toBeLessThan(MODEL_PRIORITY.indexOf('.usd'));
  });
});

describe('chooseConverter', () => {
  it('glb → copy, gltf → JS packer', () => {
    expect(chooseConverter('.glb', { usdConverter: false })).toBe('copy');
    expect(chooseConverter('.gltf', { usdConverter: true })).toBe('gltf');
  });
  it('USD → native converter if available, otherwise assimp', () => {
    expect(chooseConverter('.usdc', { usdConverter: true })).toBe('usd');
    expect(chooseConverter('.usd', { usdConverter: false })).toBe('assimp');
  });
  it('USD → Blender takes precedence over guc and assimp (Phase 45)', () => {
    expect(chooseConverter('.usd', { usdConverter: false, blender: true })).toBe('blender');
    expect(chooseConverter('.usdc', { usdConverter: true, blender: true })).toBe('blender');
    expect(chooseConverter('.usda', { usdConverter: true, blender: false })).toBe('usd');
  });
  it('fbx/obj/dae → assimp whatever the USD converter', () => {
    expect(chooseConverter('.fbx', { usdConverter: true })).toBe('assimp');
    expect(chooseConverter('.obj', { usdConverter: false })).toBe('assimp');
    expect(chooseConverter('.fbx', { usdConverter: true, blender: true })).toBe('assimp');
  });
});

describe('sourceFormatLabel', () => {
  it('maps the known formats', () => {
    expect(sourceFormatLabel('.usd')).toBe('USD');
    expect(sourceFormatLabel('.usdc')).toBe('USD (binaire)');
    expect(sourceFormatLabel('.fbx')).toBe('FBX');
    expect(sourceFormatLabel('.usdz')).toBe('USDZ');
  });
  it('falls back on the extension in uppercase if unknown', () => {
    expect(sourceFormatLabel('.xyz')).toBe('XYZ');
  });
});
