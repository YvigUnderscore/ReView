// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, badRequest } from '../lib/errors';
import { storage } from './StorageService';

/**
 * Boards mood/reference (9.B) — persistance de la scène Excalidraw.
 *
 * Deux défauts d'échelle réparés ici :
 *
 *  1. **Les images ne vivent plus dans le JSON.** Excalidraw range les images collées
 *     dans `files` sous forme de dataURL base64. Deux captures suffisaient à faire passer
 *     le document au-dessus de `express.json({ limit: '2mb' })` : chaque autosave repartait
 *     en 413 et le travail était perdu. Les fichiers volumineux sont désormais déposés dans
 *     MinIO comme n'importe quel média ; le document ne garde que `{ id, mimeType }` et la
 *     clé de stockage est **reconstruite ici** (jamais reçue du client), sans quoi un board
 *     pourrait pointer vers un objet quelconque du bucket. Les petits fichiers (SVG, icônes)
 *     restent inline sous un plafond strict — c'est le seul moyen de continuer à afficher
 *     les formats que MinIO ne peut pas servir en rendu direct.
 *  2. **Plus d'écrasement silencieux.** L'écriture porte l'`updatedAt` sur lequel l'éditeur
 *     a chargé le board et l'update est conditionnel : si quelqu'un a sauvegardé entre-temps,
 *     la réponse est un 409 `BOARD_CONFLICT` portant l'`updatedAt` courant.
 *
 * Compatibilité : un board déjà enregistré avec ses images en base64 se relit tel quel
 * (la lecture ne valide rien) et se migre à la première sauvegarde de l'éditeur.
 */

export type BoardScope = { projectId: number } | { assetId: number };

/** Nombre d'éléments Excalidraw acceptés dans un document. */
export const MAX_ELEMENTS = 10_000;
/** Nombre d'entrées `files` acceptées dans un document. */
export const MAX_FILES = 500;
/** Longueur maximale d'une dataURL laissée inline (≈ 46 Ko d'image). */
export const MAX_INLINE_DATAURL = 64_000;
/** Taille sérialisée maximale du document, sous la limite de corps d'Express. */
export const MAX_DOCUMENT_BYTES = 1_500_000;

/**
 * Identifiant de fichier Excalidraw. Il devient un segment de clé MinIO : la liste blanche
 * de caractères est ce qui interdit `../` et les clés fabriquées. Elle reste tolérante
 * (point accepté en position interne) parce qu'un board importé depuis un `.excalidraw`
 * apporte des identifiants que nous n'avons pas produits — mais jamais de séparateur, donc
 * jamais de traversée.
 */
const FILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const fileIdSchema = z.string().regex(FILE_ID_RE, 'Invalid board file id');

/**
 * Types déposables dans MinIO.
 *
 * Cette liste ne porte aucune garantie de sûreté : ce qui protège, c'est
 * `lib/uploadContentType`, qui ramène tout type actif (SVG, HTML) à `application/octet-stream`
 * aussi bien au dépôt qu'à la lecture. Elle sert à refuser les documents manifestement
 * fabriqués. Le SVG est accepté parce que l'éditeur reconstruit la dataURL à partir du type
 * déclaré et l'affiche dans un `<img>`, où un SVG n'exécute rien.
 */
const UPLOADABLE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'application/octet-stream',
]);

export const isUploadableType = (mimeType: string): boolean => UPLOADABLE_TYPES.has(mimeType);

const boardFileSchema = z
  .object({
    id: fileIdSchema,
    mimeType: z.string().min(1).max(80),
    // Absente = le fichier est dans MinIO sous la clé dérivée de son id.
    dataURL: z.string().max(MAX_INLINE_DATAURL).optional(),
    created: z.number().int().nonnegative().optional(),
    lastRetrieved: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Élément Excalidraw : forme minimale imposée, le reste des attributs passe tel quel. */
const boardElementSchema = z
  .object({ id: z.string().min(1).max(128), type: z.string().min(1).max(40) })
  .passthrough();

/** Schéma borné du document — remplace le `z.any()` d'origine. */
export const boardDocumentSchema = z
  .object({
    elements: z.array(boardElementSchema).max(MAX_ELEMENTS).default([]),
    files: z.record(fileIdSchema, boardFileSchema).default({}),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const ids = Object.keys(doc.files);
    if (ids.length > MAX_FILES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['files'],
        message: `Too many board files (${ids.length} > ${MAX_FILES})`,
      });
    }
    for (const id of ids) {
      const file = doc.files[id]!;
      // L'id porté par l'entrée sert à fabriquer la clé de stockage : il doit être celui
      // sous lequel l'entrée est rangée, sinon le fichier lu n'est pas celui écrit.
      if (file.id !== id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['files', id, 'id'],
          message: 'Board file id does not match its key',
        });
      }
      if (file.dataURL === undefined && !isUploadableType(file.mimeType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['files', id, 'mimeType'],
          message: `Unsupported stored board image type: ${file.mimeType}`,
        });
      }
    }
    const bytes = Buffer.byteLength(JSON.stringify(doc));
    if (bytes > MAX_DOCUMENT_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['elements'],
        message: `Board document too large (${bytes} > ${MAX_DOCUMENT_BYTES} bytes) — paste fewer or smaller images`,
      });
    }
  });

export type BoardDocument = z.infer<typeof boardDocumentSchema>;

// ── Clés de stockage ─────────────────────────────────────────────────────────
/**
 * Préfixe MinIO d'un board.
 *
 * Il est **rangé sous son projet** : `lib/trash.purgeProject` balaie déjà
 * `projects/{id}/`, les images d'un board partent donc avec le projet purgé sans qu'il y
 * ait un second endroit à tenir à jour. Un seul board par projet et un par asset — l'id
 * n'apparaît que pour les seconds.
 */
export const boardPrefix = (projectId: number, scope: BoardScope): string =>
  'projectId' in scope
    ? `projects/${projectId}/boards/project/`
    : `projects/${projectId}/boards/asset/${scope.assetId}/`;

/** Clé d'un fichier de board — dérivée du scope et de l'id, jamais reçue du client. */
export const boardFileKey = (projectId: number, scope: BoardScope, fileId: string): string => {
  if (!FILE_ID_RE.test(fileId)) throw badRequest('Invalid board file id', 'BAD_FILE_ID');
  return `${boardPrefix(projectId, scope)}${fileId}`;
};

// ── Lecture ──────────────────────────────────────────────────────────────────

type StoredFile = { mimeType?: string; dataURL?: string };
type StoredDocument = { files?: Record<string, StoredFile | null> };

/** Board tel qu'il part vers le client — la forme d'origine, `fileUrls` en plus. */
export type BoardPayload = {
  id?: number;
  projectId?: number | null;
  assetId?: number | null;
  document: unknown;
  updatedAt: Date | null;
};

export type BoardRead = {
  board: BoardPayload;
  /** URL présignée de lecture par fichier externalisé — vide pour un board legacy. */
  fileUrls: Record<string, string>;
};

/**
 * Lit le board et signe l'accès à ses fichiers externalisés. Le `Content-Type` de la
 * réponse est imposé dans la signature : le type déposé par le navigateur n'est pas fiable.
 */
export async function readBoard(projectId: number, scope: BoardScope): Promise<BoardRead> {
  const board = await prisma.board.findUnique({ where: scope });
  const document = (board?.document ?? {}) as StoredDocument;
  const external = Object.entries(document.files ?? {}).filter(
    ([id, file]) => file && typeof file === 'object' && !file.dataURL && FILE_ID_RE.test(id),
  );
  const signed = await Promise.all(
    external.map(async ([id, file]) => {
      const key = boardFileKey(projectId, scope, id);
      return [id, await storage.getPresignedGetUrl(key, 3600, file!.mimeType)] as const;
    }),
  );
  return {
    board: board ?? { ...scope, document: {}, updatedAt: null },
    fileUrls: Object.fromEntries(signed),
  };
}

// ── Écriture ─────────────────────────────────────────────────────────────────

const boardConflict = (updatedAt: Date | null | undefined): AppError =>
  new AppError('Board changed since it was loaded', 409, 'BOARD_CONFLICT', {
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  });

/**
 * Écrit le document si personne n'a sauvegardé depuis `baseUpdatedAt` (ISO, ou `null` pour
 * « le board n'existait pas »). L'`updatedAt` attendu est porté par le `where` de l'update :
 * la condition est évaluée par Postgres, deux sauvegardes simultanées ne peuvent pas la
 * satisfaire toutes les deux.
 */
export async function writeBoard(
  scope: BoardScope,
  document: BoardDocument,
  baseUpdatedAt: string | null,
): Promise<{ id: number; document: unknown; updatedAt: Date }> {
  const data = { document: document as unknown as Prisma.InputJsonValue };

  if (baseUpdatedAt === null) {
    try {
      return await prisma.board.create({ data: { ...scope, ...data } });
    } catch (err) {
      // P2002 = unicité sur projectId/assetId : le board existe déjà, quelqu'un l'a créé
      // pendant l'édition. Toute autre erreur reste une erreur.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      const current = await prisma.board.findUnique({ where: scope, select: { updatedAt: true } });
      throw boardConflict(current?.updatedAt);
    }
  }

  const expected = new Date(baseUpdatedAt);
  const res = await prisma.board.updateMany({ where: { ...scope, updatedAt: expected }, data });
  if (res.count === 0) {
    const current = await prisma.board.findUnique({ where: scope, select: { updatedAt: true } });
    throw boardConflict(current?.updatedAt);
  }
  return (await prisma.board.findUnique({ where: scope }))!;
}

// ── Dépôt des images ─────────────────────────────────────────────────────────

/**
 * URL présignées de dépôt pour les fichiers trop gros pour rester dans le document.
 * Le navigateur écrit directement dans MinIO, comme pour un média.
 */
export async function presignBoardFiles(
  projectId: number,
  scope: BoardScope,
  files: { id: string; mimeType: string }[],
): Promise<{ id: string; url: string }[]> {
  return Promise.all(
    files.map(async ({ id, mimeType }) => {
      if (!isUploadableType(mimeType)) {
        throw badRequest(`Unsupported board image type: ${mimeType}`, 'BAD_CONTENT_TYPE');
      }
      const key = boardFileKey(projectId, scope, id);
      // Le contenu va changer sous cette clé : l'URL de lecture mémorisée doit être oubliée,
      // sinon le navigateur resservirait l'ancienne image depuis son cache.
      storage.forgetPresignedUrl(key);
      return { id, url: await storage.getPresignedPutUrl(key, mimeType, 900) };
    }),
  );
}
