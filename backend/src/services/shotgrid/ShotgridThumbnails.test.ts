// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { putObject, deleteObject, setThumbnail } = vi.hoisted(() => ({
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  setThumbnail: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../StorageService', () => ({
  storage: {
    putObject: (...a: unknown[]) => putObject(...a),
    deleteObject: (...a: unknown[]) => deleteObject(...a),
  },
  StorageService: {
    entityThumbnailKey: (holder: string, id: number, ext: string) => `entity-thumbs/${holder}/${id}${ext}`,
  },
}));
vi.mock('../EntityThumbnailService', () => ({
  set: (...a: unknown[]) => setThumbnail(...a),
}));

import { syncThumbnail, thumbnailIdentity } from './ShotgridThumbnails';
import type { PullContext } from './ShotgridPullService';

/** URL telle que le site la rend : chemin adressé par contenu, signature volatile. */
const URL_V1 =
  'https://sg-media-usor-01.s3-accelerate.amazonaws.com/a700/4352/sh010_t.jpg?X-Amz-Expires=900&X-Amz-Signature=aaa';
const URL_V1_RESIGNED =
  'https://sg-media-usor-01.s3-accelerate.amazonaws.com/a700/4352/sh010_t.jpg?X-Amz-Expires=900&X-Amz-Signature=zzz';
const URL_V2 =
  'https://sg-media-usor-01.s3-accelerate.amazonaws.com/a700/9999/sh010_t.jpg?X-Amz-Expires=900&X-Amz-Signature=bbb';

const openStream = vi.fn();

function context(thumbnails = true): PullContext {
  return {
    connection: { id: 1, projectId: 7 },
    client: { openStream },
    settings: { media: { thumbnails } },
    journal: { count: vi.fn(), log: vi.fn() },
  } as unknown as PullContext;
}

const params = (over: Partial<Parameters<typeof syncThumbnail>[1]> = {}) => ({
  holder: 'shot' as const,
  localId: 12,
  sgType: 'Shot',
  sgId: 25564,
  name: 'sh010',
  image: URL_V1,
  previous: null as string | null,
  currentKey: null as string | null,
  ...over,
});

const respond = (bytes: Buffer, type: string | null = 'image/jpeg', size: number | null = bytes.length) =>
  openStream.mockResolvedValue({ stream: Readable.from([bytes]), size, type });

beforeEach(() => {
  vi.clearAllMocks();
  openStream.mockReset();
  // Ces trois-là sont attendus par `await` : une doublure qui rend `undefined` ferait
  // échouer le code pour une raison qui n'a rien à voir avec ce qu'on vérifie.
  putObject.mockResolvedValue(undefined);
  deleteObject.mockResolvedValue(undefined);
  setThumbnail.mockResolvedValue(undefined);
});

/**
 * Le champ `image` rend une URL signée qui change à chaque lecture : s'en servir telle
 * quelle comme témoin de changement ferait retélécharger toutes les vignettes du projet
 * à chaque passe. Seul le chemin, adressé par contenu, dit si l'image a bougé.
 */
describe('thumbnailIdentity', () => {
  it('retire la signature et garde le chemin', () => {
    expect(thumbnailIdentity(URL_V1)).toBe(
      'https://sg-media-usor-01.s3-accelerate.amazonaws.com/a700/4352/sh010_t.jpg',
    );
  });

  it('rend le même témoin pour deux signatures de la même image', () => {
    expect(thumbnailIdentity(URL_V1)).toBe(thumbnailIdentity(URL_V1_RESIGNED));
  });

  it('distingue deux images différentes', () => {
    expect(thumbnailIdentity(URL_V1)).not.toBe(thumbnailIdentity(URL_V2));
  });

  it('lit « pas de vignette » là où le site ne rend rien', () => {
    expect(thumbnailIdentity(null)).toBeNull();
    expect(thumbnailIdentity(undefined)).toBeNull();
    expect(thumbnailIdentity('')).toBeNull();
    expect(thumbnailIdentity({ url: 'https://exemple' })).toBeNull();
  });
});

describe('syncThumbnail', () => {
  it('rapatrie la vignette et la pose sur l’entité', async () => {
    respond(Buffer.from('jpeg'));
    const identity = await syncThumbnail(context(), params());

    expect(openStream).toHaveBeenCalledWith(URL_V1);
    expect(putObject).toHaveBeenCalledWith('entity-thumbs/shot/12.jpg', expect.any(Buffer), 'image/jpeg');
    expect(setThumbnail).toHaveBeenCalledWith('shot', 12, 'entity-thumbs/shot/12.jpg');
    expect(identity).toBe(thumbnailIdentity(URL_V1));
  });

  /**
   * Le cas de très loin le plus fréquent : une réconciliation nocturne relit tout le
   * projet alors que rien n'a changé. Retélécharger douze mille images pour rien ferait
   * de la passe de rattrapage la passe la plus coûteuse de l'intégration.
   */
  it('ne retélécharge rien quand la signature seule a changé', async () => {
    const identity = await syncThumbnail(
      context(),
      params({
        image: URL_V1_RESIGNED,
        previous: thumbnailIdentity(URL_V1),
        currentKey: 'entity-thumbs/shot/12.jpg',
      }),
    );

    expect(openStream).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
    expect(identity).toBe(thumbnailIdentity(URL_V1));
  });

  it('rapatrie à nouveau quand l’image a réellement changé', async () => {
    respond(Buffer.from('jpeg2'));
    const identity = await syncThumbnail(
      context(),
      params({
        image: URL_V2,
        previous: thumbnailIdentity(URL_V1),
        currentKey: 'entity-thumbs/shot/12.jpg',
      }),
    );

    expect(openStream).toHaveBeenCalledWith(URL_V2);
    expect(identity).toBe(thumbnailIdentity(URL_V2));
  });

  /** Le témoin est là mais l'objet a disparu du stockage : on repart le chercher. */
  it('rapatrie quand l’entité a perdu sa vignette malgré un témoin identique', async () => {
    respond(Buffer.from('jpeg'));
    await syncThumbnail(context(), params({ previous: thumbnailIdentity(URL_V1), currentKey: null }));

    expect(openStream).toHaveBeenCalled();
  });

  it('retire la vignette quand la production l’enlève du site', async () => {
    const identity = await syncThumbnail(
      context(),
      params({
        image: null,
        previous: thumbnailIdentity(URL_V1),
        currentKey: 'entity-thumbs/shot/12.jpg',
      }),
    );

    expect(deleteObject).toHaveBeenCalledWith('entity-thumbs/shot/12.jpg');
    expect(setThumbnail).toHaveBeenCalledWith('shot', 12, null);
    expect(identity).toBeNull();
  });

  /**
   * Une vignette déposée à la main dans ReView n'a jamais eu de témoin : elle ne vient pas
   * du site. Ni l'effacer quand ShotGrid n'illustre pas le shot, ni la recouvrir quand il
   * l'illustre — c'est une décision humaine, et la recouvrir au premier passage l'aurait
   * effacée sur tout un projet d'un coup.
   */
  it('n’efface pas une vignette posée à la main quand le site n’en a pas', async () => {
    await syncThumbnail(
      context(),
      params({ image: null, previous: null, currentKey: 'entity-thumbs/shot/12.jpg' }),
    );

    expect(deleteObject).not.toHaveBeenCalled();
    expect(setThumbnail).not.toHaveBeenCalled();
  });

  it('ne recouvre pas une vignette posée à la main quand le site en a une', async () => {
    respond(Buffer.from('jpeg'));
    const identity = await syncThumbnail(
      context(),
      params({ image: URL_V1, previous: null, currentKey: 'entity-thumbs/shot/12.jpg' }),
    );

    expect(openStream).not.toHaveBeenCalled();
    expect(setThumbnail).not.toHaveBeenCalled();
    // Pas de témoin non plus : l'entité reste hors du champ de la synchronisation tant
    // que personne n'a retiré l'image choisie ici.
    expect(identity).toBeNull();
  });

  it('ne rapatrie rien quand le studio a coupé le réglage', async () => {
    const identity = await syncThumbnail(context(false), params({ previous: 'témoin-précédent' }));

    expect(openStream).not.toHaveBeenCalled();
    expect(identity).toBe('témoin-précédent');
  });

  /**
   * Le type vient de la réponse d'un service distant, et la clé sert ensuite à signer une
   * URL servie depuis l'origine de l'application : rien d'actif n'y entre.
   */
  it('refuse un type que le stockage ne doit pas servir', async () => {
    respond(Buffer.from('<svg/>'), 'image/svg+xml');
    const identity = await syncThumbnail(context(), params());

    expect(putObject).not.toHaveBeenCalled();
    expect(identity).toBeNull();
  });

  it('refuse une image annoncée au-delà du plafond', async () => {
    respond(Buffer.from('jpeg'), 'image/jpeg', 11 * 1024 * 1024);
    await syncThumbnail(context(), params());

    expect(putObject).not.toHaveBeenCalled();
  });

  /**
   * Une vignette manquante appauvrit l'affichage ; elle ne fait pas échouer l'import de
   * l'entité. Le témoin précédent est conservé pour que la passe suivante retente.
   */
  it('garde le témoin précédent quand le téléchargement échoue', async () => {
    openStream.mockRejectedValue(new Error('502'));
    const ctx = context();
    const identity = await syncThumbnail(
      ctx,
      params({
        image: URL_V2,
        previous: thumbnailIdentity(URL_V1),
        currentKey: 'entity-thumbs/shot/12.jpg',
      }),
    );

    expect(identity).toBe(thumbnailIdentity(URL_V1));
    expect(ctx.journal.log).toHaveBeenCalledWith(
      'warn',
      'shotgrid.log.thumbnailFailed',
      expect.objectContaining({ name: 'sh010' }),
      expect.anything(),
    );
  });

  /** Un JPEG remplacé par un PNG change de clé : l'ancien objet n'a plus rien qui le désigne. */
  it('supprime l’ancien objet quand l’extension change', async () => {
    respond(Buffer.from('png'), 'image/png');
    const identity = await syncThumbnail(
      context(),
      params({
        image: URL_V2,
        previous: thumbnailIdentity(URL_V1),
        currentKey: 'entity-thumbs/shot/12.jpg',
      }),
    );

    expect(putObject).toHaveBeenCalledWith('entity-thumbs/shot/12.png', expect.any(Buffer), 'image/png');
    expect(deleteObject).toHaveBeenCalledWith('entity-thumbs/shot/12.jpg');
    // Le témoin n'avance que si toute la chaîne est allée au bout.
    expect(identity).toBe(thumbnailIdentity(URL_V2));
  });
});
