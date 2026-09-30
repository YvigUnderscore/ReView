// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Images d'un board : passage de la dataURL base64 au stockage objet.
 *
 * Excalidraw range chaque image collée dans `files` sous forme de dataURL base64. Le
 * document partait donc en entier à chaque autosave : deux captures suffisaient à dépasser
 * la limite de corps du serveur, et l'utilisateur perdait son travail sur un 413.
 *
 * Les fichiers volumineux sont désormais déposés dans MinIO ; le document ne garde que
 * `{ id, mimeType }`. Au chargement, l'éditeur les rapatrie et reconstruit la dataURL —
 * Excalidraw reçoit donc exactement ce qu'il recevait avant, seul le transport a changé.
 * Les petits fichiers restent inline : c'est moins d'allers-retours, et cela couvre les
 * formats que MinIO ne renvoie qu'en `octet-stream`.
 *
 * Ces bornes doivent rester alignées sur `backend/src/services/BoardService.ts`.
 */

/** Longueur de dataURL en deçà de laquelle un fichier reste dans le document (≈ 46 Ko). */
export const MAX_INLINE_DATAURL = 64_000;

/** Types que le serveur accepte de stocker (cf. `UPLOADABLE_TYPES` côté backend). */
const UPLOADABLE = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'application/octet-stream',
]);

export type BoardFile = {
  id: string;
  mimeType: string;
  dataURL?: string;
  created?: number;
  lastRetrieved?: number;
};

export type BoardFiles = Record<string, BoardFile>;
export type BoardDocument = { elements: unknown[]; files: BoardFiles };

/** Type de repli pour un fichier dont Excalidraw n'a pas su nommer le format. */
const fallbackType = (mimeType: string | undefined): string =>
  mimeType && UPLOADABLE.has(mimeType) ? mimeType : 'application/octet-stream';

/** Image à déposer dans MinIO — sa dataURL est garantie présente. */
export type BoardUpload = { id: string; mimeType: string; dataURL: string };

/**
 * Fichiers à déposer dans MinIO avant la prochaine sauvegarde : ceux qui portent encore
 * une dataURL trop longue pour rester dans le document et qui n'y sont pas déjà.
 */
export function filesToUpload(files: BoardFiles, stored: ReadonlySet<string>): BoardUpload[] {
  const out: BoardUpload[] = [];
  for (const [id, file] of Object.entries(files)) {
    if (!file || stored.has(id)) continue;
    const { dataURL } = file;
    if (typeof dataURL !== 'string' || dataURL.length <= MAX_INLINE_DATAURL) continue;
    out.push({ id, mimeType: fallbackType(file.mimeType), dataURL });
  }
  return out;
}

/**
 * Document tel qu'il part au serveur : la dataURL des fichiers déjà stockés est retirée,
 * les petits fichiers restent inline. `lastRetrieved` est une métadonnée de session
 * d'Excalidraw, elle n'a rien à faire en base.
 */
export function toSavedDocument(
  elements: readonly unknown[],
  files: BoardFiles,
  stored: ReadonlySet<string>,
): BoardDocument {
  const out: BoardFiles = {};
  for (const [id, file] of Object.entries(files)) {
    if (!file) continue;
    const base: BoardFile = { id, mimeType: fallbackType(file.mimeType) };
    if (file.created !== undefined) base.created = file.created;
    if (!stored.has(id)) base.dataURL = file.dataURL;
    out[id] = base;
  }
  return { elements: [...elements], files: out };
}

/** Identifiants déjà stockés dans MinIO d'après un document relu : ceux sans dataURL. */
export function storedIdsOf(files: BoardFiles): Set<string> {
  return new Set(
    Object.entries(files)
      .filter(([, f]) => f && f.dataURL === undefined)
      .map(([id]) => id),
  );
}

/** dataURL → binaire, pour le dépôt direct dans MinIO. */
export function dataURLToBlob(dataURL: string): Blob {
  const comma = dataURL.indexOf(',');
  const head = dataURL.slice(0, comma < 0 ? dataURL.length : comma);
  const body = comma < 0 ? '' : dataURL.slice(comma + 1);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  if (!head.includes(';base64')) return new Blob([decodeURIComponent(body)], { type });
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Binaire → dataURL, pour rendre à Excalidraw la forme qu'il attend. */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Rapatrie les fichiers stockés et reconstruit leur dataURL. Le type est repris du
 * document et non de la réponse : MinIO sert les formats non matriciels en `octet-stream`.
 * Un fichier introuvable est retiré du lot — Excalidraw affiche alors son propre repli,
 * plutôt que de recevoir une entrée sans image.
 */
export async function rehydrateFiles(
  files: BoardFiles,
  fileUrls: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<BoardFiles> {
  const out: BoardFiles = { ...files };
  await Promise.all(
    Object.entries(fileUrls).map(async ([id, url]) => {
      const file = files[id];
      if (!file) return;
      try {
        const res = await fetcher(url);
        if (!res.ok) throw new Error(String(res.status));
        const buffer = await res.arrayBuffer();
        out[id] = { ...file, dataURL: await blobToDataURL(new Blob([buffer], { type: file.mimeType })) };
      } catch {
        delete out[id];
      }
    }),
  );
  return out;
}
