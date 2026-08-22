// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from 'react';

/**
 * Curseurs partagés de la salle de review live (reliquat noté par le studio).
 *
 * La session diffusait le playhead, la caméra et le wipe, mais aucun pointeur : « là, ce
 * truc » n'avait aucun support visuel. Le canal existant (`live:sync`) transporte
 * désormais une trame de curseur ; elle est **découplée** de la diffusion périodique,
 * réglée à 2 Hz par défaut — un curseur à deux images par seconde ne désigne rien.
 *
 * Un bus de module plutôt qu'un contexte : le lecteur (qui capte le geste et affiche les
 * curseurs) et la session live (qui parle au socket) sont à deux extrémités de l'arbre,
 * et rien d'autre n'a besoin de savoir. Même parti pris que `liveSync.ts` pour les
 * départs différés.
 */

/** Position normalisée dans le cadre du média : 0..1 quel que soit l'écran du spectateur. */
export interface PointerFrame {
  userId: number;
  x: number;
  y: number;
  /** Le pointeur a quitté le cadre : à retirer sans attendre l'expiration. */
  gone?: true;
}

/** Curseur affiché — position, propriétaire, et instant de la dernière nouvelle. */
export interface LivePointer extends PointerFrame {
  label: string;
  at: number;
}

/** Un curseur immobile disparaît : sans cela, l'écran se couvre de reliquats. */
export const POINTER_TTL_MS = 2500;
/** Cadence d'émission maximale (~20 Hz) : assez fluide, sans inonder le relais. */
export const POINTER_INTERVAL_MS = 50;
const SWEEP_MS = 400;

type Emitter = (frame: { x: number; y: number } | null) => void;

let pointers: LivePointer[] = [];
const listeners = new Set<() => void>();
let emitter: Emitter | null = null;
let lastEmit = 0;
let pending: { x: number; y: number } | null = null;
let sendTimer: number | null = null;
let sweepTimer: number | null = null;

const commit = (next: LivePointer[]): void => {
  pointers = next;
  for (const l of listeners) l();
};

const sweep = (): void => {
  if (sweepTimer !== null || pointers.length === 0) return;
  sweepTimer = window.setInterval(() => {
    const now = Date.now();
    const alive = pointers.filter((p) => now - p.at < POINTER_TTL_MS);
    if (alive.length !== pointers.length) commit(alive);
    if (pointers.length === 0 && sweepTimer !== null) {
      window.clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, SWEEP_MS);
};

/** Trame de curseur d'un payload `live:sync` — validée, le relais ne garantit rien. */
export function readPointerFrame(payload: unknown): PointerFrame | null {
  const p = (payload as { pointer?: unknown } | null)?.pointer as Partial<PointerFrame> | undefined;
  if (!p || typeof p.userId !== 'number') return null;
  if (p.gone === true) return { userId: p.userId, x: 0, y: 0, gone: true };
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { userId: p.userId, x: p.x, y: p.y };
}

/** Applique une trame reçue : le curseur de cet utilisateur remplace le précédent. */
export function receivePointer(frame: PointerFrame, label: string): void {
  const others = pointers.filter((p) => p.userId !== frame.userId);
  if (frame.gone) {
    if (others.length !== pointers.length) commit(others);
    return;
  }
  commit([...others, { ...frame, label, at: Date.now() }]);
  sweep();
}

/**
 * Applique la trame de curseur d'un payload `live:sync`, en lui collant le nom de son
 * auteur : le bus ne connaît que des identifiants, la liste des participants vit dans la
 * session. Payload sans curseur (diffusion périodique ordinaire) : sans effet.
 */
export function applyPointer(payload: unknown, participants: { id: number; displayName: string }[]): void {
  const frame = readPointerFrame(payload);
  if (!frame) return;
  receivePointer(frame, participants.find((p) => p.id === frame.userId)?.displayName ?? '');
}

/** Vide l'écran — fin de session, changement de driver, départ du média. */
export function clearPointers(): void {
  if (pointers.length > 0) commit([]);
  if (sweepTimer !== null) {
    window.clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * Branche (ou débranche) la sortie socket — posée par la session live du driver.
 * Brancher rouvre la fenêtre d'émission : la première position d'une prise de main part
 * tout de suite, sans hériter de la cadence d'une session précédente.
 */
export function setPointerEmitter(fn: Emitter | null): void {
  emitter = fn;
  lastEmit = 0;
  pending = null;
  if (sendTimer !== null) {
    window.clearTimeout(sendTimer);
    sendTimer = null;
  }
}

/** Y a-t-il quelqu'un pour diffuser ? (le lecteur évite de calculer pour rien). */
export const canSendPointer = (): boolean => emitter !== null;

/**
 * Émet la position locale, au plus une fois par `POINTER_INTERVAL_MS`. La dernière
 * position d'un geste est toujours transmise (émission de queue) : sans elle, le curseur
 * des spectateurs s'arrêterait quelques pixels avant ce que le driver désigne.
 */
export function sendPointer(frame: { x: number; y: number } | null): void {
  if (!emitter) return;
  if (frame === null) {
    if (sendTimer !== null) {
      window.clearTimeout(sendTimer);
      sendTimer = null;
    }
    pending = null;
    emitter(null);
    return;
  }
  const now = Date.now();
  const wait = POINTER_INTERVAL_MS - (now - lastEmit);
  if (wait <= 0) {
    lastEmit = now;
    emitter(frame);
    return;
  }
  pending = frame;
  if (sendTimer !== null) return;
  sendTimer = window.setTimeout(() => {
    sendTimer = null;
    if (!pending || !emitter) return;
    lastEmit = Date.now();
    emitter(pending);
    pending = null;
  }, wait);
}

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Curseurs vivants — instantané stable tant que rien n'arrive (`useSyncExternalStore`). */
export const getPointers = (): LivePointer[] => pointers;

/** Curseurs à afficher, réévalués à chaque trame reçue et à chaque expiration. */
export const useLivePointers = (): LivePointer[] => useSyncExternalStore(subscribe, getPointers, getPointers);
