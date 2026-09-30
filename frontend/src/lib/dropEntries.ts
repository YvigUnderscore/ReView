// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lecture d'un dépôt (drag & drop) **dossiers compris**.
 *
 * `DataTransfer.files` ignore les répertoires : déposer un dossier de plans ne produisait
 * rien, sans message. L'API d'entrées (`webkitGetAsEntry`, supportée par tous les
 * navigateurs cibles) donne accès à l'arborescence ; on la parcourt et on rend une liste
 * plate de `File`, ce que la file d'upload sait déjà consommer.
 *
 * Contrainte de l'API : `dataTransfer.items` n'est valide que **pendant** l'événement
 * `drop`. Les entrées sont donc récupérées de façon synchrone, et seule leur lecture est
 * asynchrone.
 */

/** Profondeur maximale explorée — une arborescence de plans est plate, pas un dépôt git. */
const MAX_DEPTH = 8;
/**
 * Garde-fou de volume.
 *
 * Le plafond était de 500 fichiers, et il coupait en silence : déposer un plan de 1 200
 * frames EXR — la livraison la plus banale du métier — en aurait perdu 700 sans un mot.
 * Il est aligné sur ce que le serveur accepte pour une séquence
 * (`MAX_SEQUENCE_FRAMES`, backend/src/lib/imageSequence.ts) : au-delà, c'est un dépôt
 * d'arborescence entière, pas une livraison.
 */
const MAX_FILES = 10_000;

/** Ignore les fichiers de service des systèmes de fichiers (.DS_Store, .gitkeep…). */
const isHidden = (name: string): boolean => name.startsWith('.');

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** `readEntries` ne rend qu'un lot à la fois (100 sous Chrome) : on relit jusqu'au vide. */
function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const all: FileSystemEntry[] = [];
    const step = (): void =>
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) return resolve(all);
          all.push(...batch);
          step();
        },
        () => resolve(all),
      );
    step();
  });
}

async function collect(entry: FileSystemEntry, out: File[], depth: number): Promise<void> {
  if (out.length >= MAX_FILES || isHidden(entry.name)) return;
  if (entry.isFile) {
    const file = await fileOf(entry as FileSystemFileEntry).catch(() => null);
    if (file) out.push(file);
    return;
  }
  if (!entry.isDirectory || depth >= MAX_DEPTH) return;
  for (const child of await readAll((entry as FileSystemDirectoryEntry).createReader())) {
    await collect(child, out, depth + 1);
  }
}

/**
 * Fichiers d'un dépôt, dossiers dépliés. Repli sur `dataTransfer.files` quand l'API
 * d'entrées est absente (dépôt depuis une autre application, navigateur ancien).
 */
export async function filesFromDataTransfer(dt: DataTransfer | null | undefined): Promise<File[]> {
  if (!dt) return [];
  const plain = Array.from(dt.files ?? []);
  const entries = Array.from(dt.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null));
  if (entries.every((entry) => entry === null)) return plain;

  const out: File[] = [];
  for (const entry of entries) {
    if (entry) await collect(entry, out, 0);
  }
  // Une arborescence illisible ne doit pas être pire que l'ancien comportement.
  return out.length > 0 ? out.slice(0, MAX_FILES) : plain;
}
