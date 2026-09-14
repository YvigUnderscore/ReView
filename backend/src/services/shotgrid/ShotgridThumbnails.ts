// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { storage, StorageService } from '../StorageService';
import * as EntityThumbnailService from '../EntityThumbnailService';
import type { ThumbnailHolder } from '../EntityThumbnailService';
import { asString } from './shotgridMapper';
import type { PullContext } from './ShotgridPullService';

/**
 * Vignettes ShotGrid des séquences, plans et assets.
 *
 * Le champ `image` d'une entité ShotGrid est l'image que la production a choisie et
 * reconnaît : elle illustre le plan dans toutes les listes du site. ReView savait déjà
 * porter une vignette d'entité (`thumbnailKey`, déposée à la main), mais la
 * synchronisation ne demandait jamais le champ — les cartes restaient vides jusqu'à ce
 * qu'un média publié finisse par en fournir une, ou pour toujours sur un plan sans média.
 *
 * **L'image est recopiée, pas pointée.** ShotGrid ne sert pas une adresse stable : le
 * champ rend une URL S3 signée qui expire en quinze minutes et change à chaque lecture.
 * L'afficher directement aurait produit des cartes cassées au bout d'un quart d'heure.
 *
 * **Ce qui sert de témoin de changement** est le chemin de cette URL, signature retirée :
 * `…/<empreinte du site>/<empreinte du contenu>/<nom>_t.jpg`. Il est adressé par contenu,
 * donc stable tant que la vignette ne change pas, et différent dès qu'elle change. Il est
 * conservé sur la correspondance (`sgThumbSrc`), ce qui rend la passe idempotente : une
 * réconciliation nocturne sur un projet inchangé ne télécharge rien du tout.
 */

/** Une vignette pèse quelques kilo-octets ; au-delà, ce n'en est pas une. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Types d'image acceptés, et l'extension sous laquelle ils sont rangés.
 *
 * La liste est fermée à dessein : le type vient de la réponse d'un service distant, et
 * la clé de stockage sert ensuite à signer une URL de lecture servie par l'application.
 * Un `image/svg+xml` ou un `text/html` n'ont rien à y faire.
 */
const EXTENSIONS: Record<string, { ext: string; contentType: string }> = {
  'image/jpeg': { ext: '.jpg', contentType: 'image/jpeg' },
  'image/jpg': { ext: '.jpg', contentType: 'image/jpeg' },
  'image/png': { ext: '.png', contentType: 'image/png' },
  'image/webp': { ext: '.webp', contentType: 'image/webp' },
};

/**
 * Témoin de changement d'une vignette : l'adresse privée de sa signature.
 *
 * `null` veut dire « pas de vignette sur le site » — ce qui est une information, pas une
 * absence d'information : c'est ce qui permet de retirer chez nous celle qu'on y avait
 * posée quand la production l'enlève là-bas.
 */
export function thumbnailIdentity(value: unknown): string | null {
  const url = asString(value);
  if (!url) return null;
  const cut = url.indexOf('?');
  return cut === -1 ? url : url.slice(0, cut);
}

export interface ThumbnailSyncParams {
  holder: ThumbnailHolder;
  localId: number;
  sgType: string;
  sgId: number;
  /** Nom lisible de l'entité — n'apparaît que dans le journal. */
  name: string;
  /** Valeur brute du champ `image` telle que rendue par le site. */
  image: unknown;
  /** Témoin enregistré à la passe précédente, s'il y en a eu une. */
  previous: string | null | undefined;
  /** Vignette actuellement portée par l'entité côté ReView. */
  currentKey: string | null;
}

/**
 * Aligne la vignette d'une entité sur celle du site.
 *
 * Rend le témoin à conserver sur la correspondance. **Toujours une valeur exploitable** :
 * un échec rend le témoin précédent plutôt que `null`, pour que la passe suivante
 * retente au lieu de considérer l'entité comme dépourvue de vignette.
 *
 * Une vignette manquante n'a jamais fait échouer un import : c'est un appauvrissement de
 * l'affichage, pas une perte de production.
 */
export async function syncThumbnail(ctx: PullContext, params: ThumbnailSyncParams): Promise<string | null> {
  const previous = params.previous ?? null;
  if (!ctx.settings.media.thumbnails) return previous;

  const identity = thumbnailIdentity(params.image);

  /**
   * Vignette déposée à la main dans ReView : on n'y touche pas.
   *
   * `thumbnailKey` n'est écrit que par le dépôt manuel (C3) — la miniature de repli d'une
   * carte, elle, se calcule et ne s'enregistre pas. Une clé présente **sans témoin** ne
   * peut donc venir que d'un humain qui a choisi cette image. La recouvrir de celle du
   * site au premier passage aurait effacé sa décision sans conflit ni trace, et sur tout
   * un projet d'un coup. Le site reprend la main dès que quelqu'un retire cette image ici.
   */
  if (params.currentKey && previous === null) return null;

  if (identity === null) {
    /**
     * Vignette retirée du site. On ne retire QUE celle qui venait de là — la garde
     * ci-dessus a déjà écarté les autres.
     */
    if (previous && params.currentKey) {
      await storage.deleteObject(params.currentKey).catch(() => undefined);
      await EntityThumbnailService.set(params.holder, params.localId, null);
      ctx.journal.count('thumbnails', 'updated');
    }
    return null;
  }

  // Témoin identique ET image toujours en place : rien à faire, et surtout rien à
  // télécharger. C'est le cas de la quasi-totalité des entités à chaque passe.
  if (identity === previous && params.currentKey) return previous;

  try {
    const stored = await fetchAndStore(ctx, params, asString(params.image) ?? '');
    if (!stored) {
      ctx.journal.count('thumbnails', 'skipped');
      return previous;
    }
    ctx.journal.count('thumbnails', 'updated');
    return identity;
  } catch (err) {
    ctx.journal.count('thumbnails', 'failed');
    await ctx.journal.log(
      'warn',
      'shotgrid.log.thumbnailFailed',
      { name: params.name, error: err instanceof Error ? err.message : String(err) },
      {
        sgType: params.sgType,
        sgId: params.sgId,
        localType: params.holder,
        localId: params.localId,
      },
    );
    return previous;
  }
}

/** Téléchargement, contrôle du type, dépôt, enregistrement. `false` si rien n'est retenu. */
async function fetchAndStore(ctx: PullContext, params: ThumbnailSyncParams, url: string): Promise<boolean> {
  const { stream, size, type } = await ctx.client.openStream(url);
  if (size !== null && size > MAX_BYTES) {
    stream.destroy();
    return false;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += (chunk as Buffer).length;
    // Le `content-length` peut mentir ou manquer : on recompte en lisant.
    if (total > MAX_BYTES) {
      stream.destroy();
      return false;
    }
    chunks.push(chunk as Buffer);
  }

  const announced = (type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const kind = EXTENSIONS[announced];
  if (!kind || total === 0) return false;

  const key = StorageService.entityThumbnailKey(params.holder, params.localId, kind.ext);
  await storage.putObject(key, Buffer.concat(chunks), kind.contentType);
  /**
   * La clé ne dépend que de l'entité et de l'extension : remplacer un JPEG par un JPEG
   * réécrit le même objet. Un changement d'extension, lui, laisserait l'ancien fichier
   * dans le seau sans que plus rien ne le désigne.
   */
  if (params.currentKey && params.currentKey !== key) {
    await storage.deleteObject(params.currentKey).catch(() => undefined);
  }
  await EntityThumbnailService.set(params.holder, params.localId, key);
  return true;
}
