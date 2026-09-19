// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteKeys, setKeyMode, type CameraAnimV2, type KeyRef, type TangentMode } from './channels/model';
import {
  copyKeys,
  loadClipboard,
  pasteKeys,
  persistClipboard,
  type CurveClipboard,
} from './channels/clipboard';

/** Réf lue dans les handlers seulement (jamais pendant le rendu) — possédée par `useCameraAnim`. */
interface Readable<T> {
  readonly current: T;
}

/**
 * Sélection de clés du curve editor et presse-papier (Phase 27, Phase 40.E) : multi-sélection — la
 * dernière clé est « primaire » (poignées de tangente, caméra-objet) —, mode de tangente appliqué en
 * lot, suppression en lot, copier/coller en mémoire **et** dans `localStorage` (d'un média à l'autre).
 *
 * Le hook ne possède que la sélection : l'animation et son historique restent à l'appelant, qui
 * fournit `animRef`, `timeRef` (tête de lecture = point de collage) et `commit` (mutation avec
 * snapshot d'undo). C'est le point d'accroche des sélections à venir (par canal, par boîte de
 * transformation) : elles passent toutes par `setSelection`.
 */
export function useCurveSelection(opts: {
  animRef: Readable<CameraAnimV2>;
  timeRef: Readable<number>;
  commit: (next: CameraAnimV2) => void;
}) {
  const { animRef, timeRef, commit } = opts;
  const [selection, setSelectionState] = useState<KeyRef[]>([]);
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const setSelection = useCallback((sels: KeyRef[]) => setSelectionState(sels), []);
  /** Vide la sélection — après un remplacement d'animation, les index ne désignent plus rien. */
  const clearSelection = useCallback(() => setSelectionState([]), []);

  /** Applique un mode de tangente à toutes les clés sélectionnées (segmented du graph editor). */
  const setSelectionMode = useCallback(
    (mode: TangentMode) => {
      const sels = selectionRef.current;
      if (!sels.length) return;
      let next = animRef.current;
      for (const s of sels) next = setKeyMode(next, s.channel, s.index, mode);
      commit(next);
    },
    [animRef, commit],
  );

  /** Supprime les clés sélectionnées (Suppr). */
  const removeSelection = useCallback(() => {
    const sels = selectionRef.current;
    if (!sels.length) return;
    commit(deleteKeys(animRef.current, sels));
    setSelectionState([]);
  }, [animRef, commit]);

  // ── Copier/coller de clés (40.E) : presse-papier mémoire + `localStorage` (cross-média). ──
  const clipboardRef = useRef<CurveClipboard | null>(loadClipboard());
  const [canPaste, setCanPaste] = useState(() => loadClipboard() != null);

  /** Copie les clés sélectionnées (valeur, mode, tangentes) dans le presse-papier (Ctrl+C). */
  const copySelection = useCallback(() => {
    const clip = copyKeys(animRef.current, selectionRef.current);
    if (!clip) return;
    clipboardRef.current = clip;
    persistClipboard(clip);
    setCanPaste(true);
  }, [animRef]);

  /** Colle le presse-papier à la tête de lecture et sélectionne les clés collées (Ctrl+V). */
  const paste = useCallback(() => {
    const clip = clipboardRef.current ?? loadClipboard();
    if (!clip) return;
    const { anim: next, selection: pasted } = pasteKeys(animRef.current, clip, timeRef.current);
    commit(next);
    setSelectionState(pasted);
  }, [animRef, timeRef, commit]);

  return {
    selection,
    setSelection,
    clearSelection,
    setSelectionMode,
    removeSelection,
    copySelection,
    paste,
    canPaste,
  };
}
