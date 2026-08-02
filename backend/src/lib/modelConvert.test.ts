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
  it('reconnaît usd/usdc/usda (insensible à la casse)', () => {
    expect(isUsdModel('.usd')).toBe(true);
    expect(isUsdModel('.usdc')).toBe(true);
    expect(isUsdModel('.USDA')).toBe(true);
  });
  it('exclut usdz (archive) et les autres formats', () => {
    expect(isUsdModel('.usdz')).toBe(false);
    expect(isUsdModel('.glb')).toBe(false);
    expect(isUsdModel('.fbx')).toBe(false);
  });
});

describe('pickModelFile', () => {
  it('choisit le format de plus haute priorité (gltf > glb > fbx > usd)', () => {
    const files = ['/tmp/tex.png', '/tmp/scene.usdc', '/tmp/model.fbx', '/tmp/scene.gltf'];
    expect(pickModelFile(files)).toBe('/tmp/scene.gltf');
  });
  it('retombe sur le meilleur disponible et ignore les annexes', () => {
    expect(pickModelFile(['/a/color.jpg', '/a/mesh.obj', '/a/notes.txt'])).toBe('/a/mesh.obj');
    expect(pickModelFile(['/a/scene.usda', '/a/scene.usdc'])).toBe('/a/scene.usdc');
  });
  it('renvoie null sans fichier 3D reconnu', () => {
    expect(pickModelFile(['/a/readme.md', '/a/photo.png'])).toBeNull();
  });
  it('MODEL_PRIORITY couvre les formats attendus dans l’ordre', () => {
    expect(MODEL_PRIORITY.indexOf('.gltf')).toBeLessThan(MODEL_PRIORITY.indexOf('.fbx'));
    expect(MODEL_PRIORITY.indexOf('.fbx')).toBeLessThan(MODEL_PRIORITY.indexOf('.usd'));
  });
});

describe('chooseConverter', () => {
  it('glb → copie, gltf → packer JS', () => {
    expect(chooseConverter('.glb', { usdConverter: false })).toBe('copy');
    expect(chooseConverter('.gltf', { usdConverter: true })).toBe('gltf');
  });
  it('USD → convertisseur natif si dispo, sinon assimp', () => {
    expect(chooseConverter('.usdc', { usdConverter: true })).toBe('usd');
    expect(chooseConverter('.usd', { usdConverter: false })).toBe('assimp');
  });
  it('USD → Blender prioritaire sur guc et assimp (Phase 45)', () => {
    expect(chooseConverter('.usd', { usdConverter: false, blender: true })).toBe('blender');
    expect(chooseConverter('.usdc', { usdConverter: true, blender: true })).toBe('blender');
    expect(chooseConverter('.usda', { usdConverter: true, blender: false })).toBe('usd');
  });
  it('fbx/obj/dae → assimp quel que soit le convertisseur USD', () => {
    expect(chooseConverter('.fbx', { usdConverter: true })).toBe('assimp');
    expect(chooseConverter('.obj', { usdConverter: false })).toBe('assimp');
    expect(chooseConverter('.fbx', { usdConverter: true, blender: true })).toBe('assimp');
  });
});

describe('sourceFormatLabel', () => {
  it('mappe les formats connus', () => {
    expect(sourceFormatLabel('.usd')).toBe('USD');
    expect(sourceFormatLabel('.usdc')).toBe('USD (binaire)');
    expect(sourceFormatLabel('.fbx')).toBe('FBX');
    expect(sourceFormatLabel('.usdz')).toBe('USDZ');
  });
  it('replie sur l’extension en majuscules si inconnu', () => {
    expect(sourceFormatLabel('.xyz')).toBe('XYZ');
  });
});
