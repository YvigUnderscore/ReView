// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../../lib/query';
import { t } from '../../i18n';
import { BoardConflictError, boardBase, loadBoard, persistBoard, type BoardScope } from './boardApi';
import { sceneSignature } from './boardSignature';
import type { BoardFiles } from './boardFiles';

/**
 * État d'édition d'un board : chargement, dépôt des images, autosave débouncée et
 * détection de l'édition concurrente.
 *
 * Deux invariants portent tout le reste :
 *  - `baseRef` est l'`updatedAt` sur lequel la scène affichée a été chargée. Chaque
 *    sauvegarde le présente au serveur, qui refuse en 409 si quelqu'un a écrit depuis —
 *    à la place de l'écrasement silencieux d'avant.
 *  - le board **ne se recharge jamais tout seul** (`refetchOnWindowFocus` désactivé) :
 *    Excalidraw ne lit `initialData` qu'au montage, un rechargement invisible remplacerait
 *    la référence sans remplacer la scène et rouvrirait précisément l'écrasement.
 */

/** `sig` : empreinte de la scène (cf. `boardSignature`) — la seule base de comparaison fiable. */
type Snapshot = { elements: readonly unknown[]; files: BoardFiles; sig: string };

export type BoardEditor = {
  /** Scène à passer à Excalidraw, `null` tant que le board n'est pas chargé. */
  initial: { elements: unknown[]; files: BoardFiles } | null;
  /** Change à chaque rechargement demandé : sert de `key` pour remonter l'éditeur. */
  mountKey: number;
  loadError: string | null;
  saveError: string | null;
  saved: boolean;
  /** Non nul quand le serveur a refusé la sauvegarde : l'utilisateur doit trancher. */
  conflict: boolean;
  onChange: (elements: readonly unknown[], appState: unknown, files: BoardFiles) => void;
  /** Reprend la version du serveur — les modifications locales non enregistrées sont perdues. */
  reload: () => void;
  /** Réenregistre la version locale par-dessus celle du serveur. */
  overwrite: () => void;
};

const SAVE_DEBOUNCE_MS = 1200;

export function useBoardDocument(scope: BoardScope, targetId: number): BoardEditor {
  const base = boardBase(scope, targetId);
  const baseRef = useRef<string | null>(null);
  /** Empreinte de la scène telle qu'elle est actuellement enregistrée côté serveur. */
  const savedSigRef = useRef<string | null>(null);
  const storedRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Snapshot | null>(null);
  const runningRef = useRef(false);
  const conflictRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mountKey, setMountKey] = useState(0);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const boardQ = useQuery({
    queryKey: qk.board(scope, targetId),
    queryFn: async () => {
      const loaded = await loadBoard(base);
      // Référence d'édition et inventaire des images déjà stockées : ils accompagnent
      // exactement la scène que l'éditeur va monter.
      baseRef.current = loaded.updatedAt;
      storedRef.current = loaded.storedIds;
      // Point de départ de la comparaison : sans lui, le tout premier `onChange` — celui
      // qu'Excalidraw émet au montage, sans aucune action de l'utilisateur — passerait pour
      // une modification et déclencherait une sauvegarde à l'ouverture de chaque board.
      savedSigRef.current = sceneSignature(loaded.elements, loaded.files);
      return loaded;
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const schedule = (delay: number): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void run(), delay);
  };

  const run = async (): Promise<void> => {
    if (conflictRef.current) return;
    // Une sauvegarde est en vol : on repasse après, avec l'état le plus récent.
    if (runningRef.current) {
      schedule(SAVE_DEBOUNCE_MS);
      return;
    }
    const snapshot = pendingRef.current;
    if (!snapshot) return;
    runningRef.current = true;
    try {
      baseRef.current = await persistBoard(base, snapshot, storedRef.current, baseRef.current);
      savedSigRef.current = snapshot.sig;
      // Comparaison par EMPREINTE, jamais par identité d'objet : `onChange` reconstruit un
      // objet neuf à chaque appel, si bien que `pendingRef.current === snapshot` était
      // toujours faux — l'instantané n'était jamais purgé et la sauvegarde se relançait
      // sans fin sur un document inchangé.
      if (pendingRef.current?.sig === snapshot.sig) {
        pendingRef.current = null;
        setSaved(true);
      }
      setSaveError(null);
    } catch (err) {
      if (err instanceof BoardConflictError) {
        conflictRef.current = true;
        baseRef.current = err.serverUpdatedAt;
        setConflict(true);
      } else {
        setSaveError(err instanceof Error ? err.message : t('common.error.generic'));
      }
    } finally {
      runningRef.current = false;
    }
  };

  const onChange = (elements: readonly unknown[], _appState: unknown, files: BoardFiles): void => {
    const sig = sceneSignature(elements, files);
    // Excalidraw rappelle `onChange` pour un déplacement de curseur, un défilement, une
    // sélection, ou simplement parce que ce composant s'est re-rendu. Sans ce filtre, chacun
    // de ces rappels réarmait une sauvegarde : un board ouvert et **intouché** réécrivait sa
    // ligne en base toutes les ~1,2 s, pour chaque onglet ouvert du studio.
    if (sig === savedSigRef.current) {
      if (pendingRef.current) {
        pendingRef.current = null;
        setSaved(true);
      }
      return;
    }
    pendingRef.current = { elements, files, sig };
    setSaved(false);
    if (conflictRef.current) return; // l'utilisateur doit d'abord trancher
    schedule(SAVE_DEBOUNCE_MS);
  };

  const reload = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    conflictRef.current = false;
    setConflict(false);
    setSaveError(null);
    setSaved(true);
    void boardQ.refetch().then(() => setMountKey((k) => k + 1));
  };

  const overwrite = (): void => {
    conflictRef.current = false;
    setConflict(false);
    // `baseRef` porte déjà l'horodatage renvoyé par le 409 : la réécriture est acceptée.
    schedule(0);
  };

  const data = boardQ.data;
  return {
    initial: data
      ? { elements: data.elements, files: data.files }
      : boardQ.isError
        ? { elements: [], files: {} }
        : null,
    mountKey,
    loadError: boardQ.error?.message ?? null,
    saveError,
    saved,
    conflict,
    onChange,
    reload,
    overwrite,
  };
}
