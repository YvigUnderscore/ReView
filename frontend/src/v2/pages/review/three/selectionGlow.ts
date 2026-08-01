import type * as THREE from 'three';

/**
 * Halo de sélection du viewer 3D (Phase 46) : une coque additive légèrement dilatée autour
 * des meshes du prim sélectionné.
 *
 * Coque plutôt que teinte des matériaux : les matériaux glTF sont **partagés** entre objets,
 * les modifier colorerait des meshes non sélectionnés et obligerait à un sauvegarde/restaure
 * fragile. Ici on n'ajoute que des objets jetables, retirés à la désélection — la scène
 * d'origine n'est jamais touchée.
 */

/** Épaisseur du halo, en fraction de l'échelle de l'objet. */
const SHELL_SCALE = 1.04;
/** Couleur du halo — accent du thème (cyan), lisible sur fond sombre comme clair. */
export const GLOW_COLOR = 0x22d3ee;

export interface SelectionGlow {
  /** Entoure les objets donnés ; une liste vide efface le halo. */
  show(objects: readonly THREE.Object3D[]): void;
  dispose(): void;
}

/**
 * Crée le gestionnaire de halo. Le groupe vit dans la scène mais hors de la hiérarchie du
 * modèle, pour ne jamais être capturé par l'indexation des prims ni par un raycast.
 */
export function createSelectionGlow(three: typeof import('three'), scene: THREE.Scene): SelectionGlow {
  const group = new three.Group();
  group.name = 'review-selection-glow';
  // Hors raycast et hors capture de miniature : c'est un repère d'interface, pas de la scène.
  group.raycast = () => {};
  scene.add(group);

  const material = new three.MeshBasicMaterial({
    color: GLOW_COLOR,
    transparent: true,
    opacity: 0.35,
    // `BackSide` ne dessine que la face arrière de la coque dilatée : le halo apparaît en
    // contour, sans masquer l'objet.
    side: three.BackSide,
    depthWrite: false,
    blending: three.AdditiveBlending,
  });

  const clear = () => {
    for (const child of [...group.children]) group.remove(child);
  };

  return {
    show(objects) {
      clear();
      for (const object of objects) {
        const mesh = object as THREE.Mesh;
        if (!(mesh as { isMesh?: boolean }).isMesh || !mesh.geometry) continue;
        const shell = new three.Mesh(mesh.geometry, material);
        shell.raycast = () => {};
        mesh.updateWorldMatrix(true, false);
        // La coque est posée en espace monde : elle suit l'objet sans dépendre de sa place
        // dans la hiérarchie (et donc sans être masquée avec un parent invisible).
        shell.matrixAutoUpdate = false;
        shell.matrix.copy(mesh.matrixWorld).scale(new three.Vector3(SHELL_SCALE, SHELL_SCALE, SHELL_SCALE));
        group.add(shell);
      }
    },
    dispose() {
      clear();
      scene.remove(group);
      material.dispose();
    },
  };
}
