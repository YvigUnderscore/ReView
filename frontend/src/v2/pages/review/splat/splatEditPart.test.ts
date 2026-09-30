// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  buildSplatEditPart,
  hasSplatEditProposal,
  readSplatEditPart,
  resolveSplatEditProposal,
} from './splatEditPart';
import { IDENTITY_SPLAT_TRANSFORM, splitAnnotationParts, type SplatEdits } from '../reviewTypes';

/**
 * La proposition d'édition de nuage jointe à un commentaire (Phase 50, lot 14) : ce qu'elle
 * porte — le geste ENTIER, suppressions comprises —, la façon dont les deux binaires voyagent
 * (par référence, comme les images d'un point d'intérêt), et le fait qu'elle se relise telle
 * qu'elle est partie.
 */
const trs = {
  position: [1, 0, -2] as [number, number, number],
  quaternion: [0, 0.7071, 0, 0.7071] as [number, number, number, number],
  scale: [1.5, 1.5, 1.5] as [number, number, number],
};
const volume = { shape: 'box', mode: 'delete', ...trs } as const;
const edits: SplatEdits = { transform: trs, volumes: [volume], baseFlip: false };
const MASK = 'comments/attachments/7/splat-mask.bin';
const SUBSET = 'comments/attachments/7/splat-subset.bin';
const refs = { mask: { key: MASK, count: 3 }, subset: { key: SUBSET, count: 1 } };

describe('buildSplatEditPart — ce qui part avec le commentaire', () => {
  it('emporte la transformation, les volumes et le flip', () => {
    expect(buildSplatEditPart(edits)).toEqual({ type: 'splat-edit', ...edits });
  });

  it('emporte les références des deux binaires, jamais le binaire lui-même', () => {
    const part = buildSplatEditPart(edits, refs)!;
    expect(part.mask).toEqual(refs.mask);
    expect(part.subset).toEqual(refs.subset);
    expect(Object.keys(part).sort()).toEqual(['baseFlip', 'mask', 'subset', 'transform', 'type', 'volumes']);
  });

  /**
   * Le cas qui manquait à la vague 1, et qui est le geste le plus courant du viewer splat :
   * supprimer des splats sans rien déplacer. La proposition doit exister — sinon nettoyer un
   * nuage pour les autres n'a aucune adresse dans un studio qui publie d'office.
   */
  it('part pour un nettoyage seul : masque sans transformation ni volume', () => {
    const part = buildSplatEditPart(
      { transform: IDENTITY_SPLAT_TRANSFORM, volumes: [] },
      {
        mask: refs.mask,
      },
    )!;
    expect(part).toEqual({ type: 'splat-edit', transform: null, volumes: [], mask: refs.mask });
  });

  it('ne part pas quand rien n’est proposé (édition vide ou transformation d’identité)', () => {
    expect(buildSplatEditPart(null)).toBeNull();
    expect(buildSplatEditPart({ transform: null, volumes: [] })).toBeNull();
    expect(
      buildSplatEditPart({ transform: IDENTITY_SPLAT_TRANSFORM, volumes: [], baseFlip: true }),
    ).toBeNull();
    // Références vides : rien n'a été déposé, donc rien n'est annoncé.
    expect(buildSplatEditPart(null, { mask: null, subset: null })).toBeNull();
  });

  it('ne recopie jamais un champ interne de l’éditeur', () => {
    const part = buildSplatEditPart({ ...edits, splatMaskKey: 'k', deleted: [1, 2] } as SplatEdits)!;
    expect(Object.keys(part).sort()).toEqual(['baseFlip', 'transform', 'type', 'volumes']);
  });
});

describe('hasSplatEditProposal — y a-t-il quelque chose à joindre ?', () => {
  const draft = (over: Record<string, unknown>) =>
    ({
      edits: { transform: IDENTITY_SPLAT_TRANSFORM, volumes: [] },
      mask: null,
      subset: null,
      ...over,
    }) as never;

  it('oui dès qu’un binaire, un volume, un flip ou un déplacement existe', () => {
    expect(hasSplatEditProposal(draft({ mask: { bytes: new Uint8Array(2), count: 3 } }))).toBe(true);
    expect(hasSplatEditProposal(draft({ subset: { bytes: new Uint8Array(8), count: 1 } }))).toBe(true);
    expect(hasSplatEditProposal(draft({ edits: { transform: null, volumes: [volume] } }))).toBe(true);
    expect(hasSplatEditProposal(draft({ edits: { transform: trs, volumes: [] } }))).toBe(true);
    expect(hasSplatEditProposal(draft({ edits: { transform: null, volumes: [], baseFlip: false } }))).toBe(
      true,
    );
  });

  it('non pour une édition vierge, ou pas d’édition du tout', () => {
    expect(hasSplatEditProposal(null)).toBe(false);
    expect(hasSplatEditProposal(draft({}))).toBe(false);
  });
});

describe('readSplatEditPart — ce qui se rejoue à la lecture', () => {
  it('relit exactement ce qui est parti (aller-retour), binaires compris', () => {
    const part = buildSplatEditPart(edits, refs)!;
    expect(readSplatEditPart([part])).toEqual({ ...edits, ...refs });
  });

  it('rend null quand aucune part ne propose d’édition', () => {
    expect(readSplatEditPart([])).toBeNull();
    expect(readSplatEditPart([{ type: 'rect' }])).toBeNull();
    expect(readSplatEditPart([{ type: 'splat-edit' }])).toBeNull();
  });

  it('tolère une part abîmée plutôt que de faire tomber la lecture du commentaire', () => {
    const broken = { type: 'splat-edit', transform: { position: [0, 0] }, volumes: [{ shape: 'blob' }] };
    expect(readSplatEditPart([broken as never])).toBeNull();
    const half = { type: 'splat-edit', transform: 'nope', volumes: [volume] };
    expect(readSplatEditPart([half as never])).toEqual({
      transform: null,
      volumes: [volume],
      mask: null,
      subset: null,
    });
    // Référence sans clé exploitable : le reste de la proposition se rejoue quand même.
    const noKey = { type: 'splat-edit', transform: trs, volumes: [], mask: { count: 3 } };
    expect(readSplatEditPart([noKey as never])?.mask).toBeNull();
  });
});

describe('resolveSplatEditProposal — les binaires ne se lisent que dans le commentaire porteur', () => {
  const part = readSplatEditPart([buildSplatEditPart(edits, refs)!])!;

  it('résout les URL présignées des pièces jointes du commentaire', () => {
    const resolved = resolveSplatEditProposal(part, [
      { key: MASK, url: 'https://minio/mask' },
      { key: SUBSET, url: 'https://minio/subset' },
    ]);
    expect(resolved).toEqual({
      ...edits,
      maskUrl: 'https://minio/mask',
      subsetUrl: 'https://minio/subset',
      maskCount: 3,
      subsetCount: 1,
    });
  });

  /**
   * La garantie de sécurité : la clé ne sert d'INDEX que dans les pièces du commentaire, déjà
   * filtrées par préfixe côté serveur. Une clé étrangère ne donne donc rien à charger — aucune
   * URL n'est signée pour elle ici.
   */
  it('ne donne aucune URL à une clé absente des pièces jointes', () => {
    const resolved = resolveSplatEditProposal(part, [
      { key: 'comments/attachments/9/splat-mask.bin', url: 'https://minio/autrui' },
    ]);
    expect(resolved?.maskUrl).toBeNull();
    expect(resolved?.subsetUrl).toBeNull();
    expect(resolveSplatEditProposal(part, undefined)?.maskUrl).toBeNull();
  });

  it('pas de proposition ⇒ rien à résoudre', () => {
    expect(resolveSplatEditProposal(null, [])).toBeNull();
  });
});

describe('splitAnnotationParts — la part ne se confond pas avec un dessin', () => {
  it('extrait la proposition et l’exclut des formes 2D', () => {
    const out = splitAnnotationParts([buildSplatEditPart(edits, refs)!, { type: 'rect', x: 0, y: 0 }]);
    expect(out.splatEdit).toEqual({ ...edits, ...refs });
    expect(out.shapes).toHaveLength(1);
    expect((out.shapes[0] as { type: string }).type).toBe('rect');
  });

  it('annotation absente ou sans proposition → null', () => {
    expect(splitAnnotationParts(null).splatEdit).toBeNull();
    expect(splitAnnotationParts([{ type: 'rect' }]).splatEdit).toBeNull();
  });
});
