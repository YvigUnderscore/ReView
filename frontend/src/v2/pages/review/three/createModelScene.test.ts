// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as REAL from 'three';
import { createModelScene, disposeSceneTree, type ModelSceneModules } from './createModelScene';

/**
 * Libération des ressources GPU du modèle (F9). La grandeur mesurée est le **nombre d'objets
 * WebGL libérés** : Three signale chaque libération par un événement `dispose` (c'est cet
 * événement que `WebGLRenderer` écoute pour effacer buffers et textures), on le compte donc
 * directement. `WebGLRenderer` est remplacé par un double : aucun contexte WebGL n'est requis,
 * mais la scène, les matériaux et les textures sont les vrais objets Three.
 */

class FakeRenderer {
  domElement = document.createElement('canvas');
  outputColorSpace = '';
  toneMapping = 0;
  toneMappingExposure = 0;
  disposed = 0;
  contextLost = 0;
  setPixelRatio() {}
  setSize() {}
  render() {}
  dispose() {
    this.disposed += 1;
  }
  forceContextLoss() {
    this.contextLost += 1;
  }
}

class FakeControls {
  enableDamping = false;
  dampingFactor = 0;
  target = new REAL.Vector3();
  disposed = 0;
  dispose() {
    this.disposed += 1;
  }
  update() {}
  addEventListener() {}
  removeEventListener() {}
}

function makeScene() {
  const modules = {
    THREE: { ...REAL, WebGLRenderer: FakeRenderer },
    OrbitControls: FakeControls,
  } as unknown as ModelSceneModules;
  const container = document.createElement('div');
  const scene = createModelScene(modules, container);
  return { scene, container, renderer: scene.renderer as unknown as FakeRenderer };
}

/**
 * Compte les libérations d'une liste d'objets Three (géométrie, matériau ou texture).
 *
 * Les trois classes émettent bien un événement `dispose`, mais chacune type `addEventListener`
 * avec SA propre union littérale de noms d'événements : aucune signature structurelle commune
 * ne les accepte toutes. On les prend donc par leur type réel et on pose l'écouteur derrière un
 * seul point de conversion, plutôt que d'élargir le type de chaque appelant.
 */
type Disposable = REAL.BufferGeometry | REAL.Material | REAL.Texture;

function countDisposals(objects: Disposable[]) {
  const seen = new Map<number, number>();
  objects.forEach((o, i) =>
    (o as { addEventListener: (t: 'dispose', cb: () => void) => void }).addEventListener('dispose', () =>
      seen.set(i, (seen.get(i) ?? 0) + 1),
    ),
  );
  return {
    total: () => [...seen.values()].reduce((a, b) => a + b, 0),
    of: (i: number) => seen.get(i) ?? 0,
  };
}

describe('disposeSceneTree — libération des ressources GPU du modèle (F9)', () => {
  it('libère géométries, matériaux et textures de tout le sous-arbre', () => {
    const geoA = new REAL.BufferGeometry();
    const geoB = new REAL.BufferGeometry();
    const tex = new REAL.Texture();
    const normal = new REAL.Texture();
    const mat = new REAL.MeshStandardMaterial({ map: tex, normalMap: normal });
    const root = new REAL.Group();
    root.add(new REAL.Mesh(geoA, mat), new REAL.Mesh(geoB, mat));

    const counts = disposeSceneTree(root);
    // Le matériau et ses deux textures sont partagés par les deux maillages : une seule fois.
    expect(counts).toEqual({ geometries: 2, materials: 1, textures: 2 });
  });

  it('ne libère jamais deux fois une ressource partagée', () => {
    const tex = new REAL.Texture();
    const matA = new REAL.MeshBasicMaterial({ map: tex });
    const matB = new REAL.MeshBasicMaterial({ map: tex });
    const suivi = countDisposals([tex, matA, matB]);
    const root = new REAL.Group();
    root.add(new REAL.Mesh(new REAL.BufferGeometry(), matA));
    root.add(new REAL.Mesh(new REAL.BufferGeometry(), matB));

    disposeSceneTree(root);
    expect(suivi.of(0)).toBe(1); // la texture partagée : une libération, pas deux
    expect(suivi.total()).toBe(3);
  });

  it('épargne les ressources déposées dans `seen` (encore utilisées ailleurs)', () => {
    const partagee = new REAL.Texture();
    const suivi = countDisposals([partagee]);
    const mat = new REAL.MeshBasicMaterial({ map: partagee });
    const root = new REAL.Group();
    root.add(new REAL.Mesh(new REAL.BufferGeometry(), mat));

    const counts = disposeSceneTree(root, new Set<object>([partagee]));
    expect(suivi.of(0)).toBe(0);
    expect(counts.textures).toBe(0);
    expect(counts.materials).toBe(1);
  });

  it('libère les tableaux de matériaux et les textures d’un ShaderMaterial', () => {
    const a = new REAL.MeshBasicMaterial({ map: new REAL.Texture() });
    const b = new REAL.ShaderMaterial({ uniforms: { uMap: { value: new REAL.Texture() } } });
    const root = new REAL.Group();
    root.add(new REAL.Mesh(new REAL.BufferGeometry(), [a, b]));

    expect(disposeSceneTree(root)).toEqual({ geometries: 1, materials: 2, textures: 2 });
  });
});

describe('createModelScene.dispose — nettoyage complet du viewer (F9)', () => {
  it('parcourt la scène : le modèle chargé rend ses géométries, matériaux et textures', () => {
    const { scene, renderer } = makeScene();
    const geo = new REAL.BufferGeometry();
    const tex = new REAL.Texture();
    const mat = new REAL.MeshStandardMaterial({ map: tex });
    const suivi = countDisposals([geo, mat, tex]);
    scene.root.add(new REAL.Mesh(geo, mat));

    scene.dispose();

    // Sans le parcours, `renderer.dispose()` ne libère que des caches JS : ces trois
    // compteurs restaient à zéro et la mémoire GPU ne redescendait jamais.
    expect(suivi.total()).toBe(3);
    expect(renderer.disposed).toBe(1);
    // Le contexte WebGL lui-même est rendu : Chrome plafonne le nombre de contextes.
    expect(renderer.contextLost).toBe(1);
    expect(scene.renderer.domElement.isConnected).toBe(false);
  });

  it("n'emporte pas l'environnement HDRI, qui appartient au hook d'éclairage", () => {
    const { scene } = makeScene();
    const env = new REAL.Texture();
    const suivi = countDisposals([env]);
    scene.scene.environment = env;
    scene.scene.background = env;

    scene.dispose();
    expect(suivi.of(0)).toBe(0);
  });

  it('est idempotent : un second appel ne relibère rien', () => {
    const { scene, renderer } = makeScene();
    const geo = new REAL.BufferGeometry();
    const suivi = countDisposals([geo]);
    scene.root.add(new REAL.Mesh(geo, new REAL.MeshBasicMaterial()));

    scene.dispose();
    scene.dispose();
    expect(suivi.of(0)).toBe(1);
    expect(renderer.disposed).toBe(1);
    expect(renderer.contextLost).toBe(1);
  });
});
