import {
  CHANNEL_IDS,
  upsertFullKey,
  type CameraAnimV2,
  type ChannelId,
  type CurveKey,
  type KeyRef,
  type TangentMode,
} from './model';

/**
 * Presse-papier de clés du curve editor (Phase 40, 40.E) : copier/coller des clés (valeur, mode et
 * tangentes) entre canaux, dans un même média **ou d'un média à l'autre** via `localStorage`. Les
 * temps sont stockés **relatifs** au plus tôt de la sélection ; le collage les repositionne à partir
 * de la tête de lecture. Logique pure/testable — l'état vit dans `useCameraAnim`.
 */
export interface CurveClipboard {
  /** Clés copiées par canal, temps relatifs (ms) au plus tôt de la sélection. */
  channels: Partial<Record<ChannelId, CurveKey[]>>;
}

const STORE_KEY = 'review.curveClipboard';
const MODES: readonly TangentMode[] = ['auto', 'linear', 'step', 'free'];

/** Extrait les clés sélectionnées, temps rebasés sur le plus tôt. `null` si rien de copiable. */
export function copyKeys(anim: CameraAnimV2, refs: readonly KeyRef[]): CurveClipboard | null {
  const collected: Array<{ channel: ChannelId; key: CurveKey }> = [];
  for (const r of refs) {
    const k = anim.channels[r.channel]?.keys[r.index];
    if (k) collected.push({ channel: r.channel, key: { ...k } });
  }
  if (!collected.length) return null;
  const minT = Math.min(...collected.map((c) => c.key.t));
  const channels: Partial<Record<ChannelId, CurveKey[]>> = {};
  for (const { channel, key } of collected) {
    (channels[channel] ??= []).push({ ...key, t: key.t - minT });
  }
  for (const id of CHANNEL_IDS) channels[id]?.sort((a, b) => a.t - b.t);
  return { channels };
}

/**
 * Colle les clés du presse-papier à partir du temps `atT` (ms) sur leurs canaux d'origine.
 * Renvoie l'animation résultante et la sélection des clés collées (pour enchaîner un déplacement).
 */
export function pasteKeys(
  anim: CameraAnimV2,
  clip: CurveClipboard,
  atT: number,
): { anim: CameraAnimV2; selection: KeyRef[] } {
  const base = Math.max(0, Math.round(atT));
  let next = anim;
  for (const id of CHANNEL_IDS) {
    for (const k of clip.channels[id] ?? []) next = upsertFullKey(next, id, { ...k, t: base + k.t });
  }
  // Sélection = index des clés collées dans l'animation triée résultante.
  const selection: KeyRef[] = [];
  for (const id of CHANNEL_IDS) {
    const keys = clip.channels[id];
    const ch = next.channels[id];
    if (!keys || !ch) continue;
    for (const k of keys) {
      const idx = ch.keys.findIndex((kk) => kk.t === base + k.t);
      if (idx >= 0) selection.push({ channel: id, index: idx });
    }
  }
  return { anim: next, selection };
}

// ── Persistance cross-média (localStorage) ─────────────────────────────────────
function parseKey(input: unknown): CurveKey | null {
  if (!input || typeof input !== 'object') return null;
  const k = input as Record<string, unknown>;
  if (typeof k.t !== 'number' || typeof k.v !== 'number') return null;
  const mode = MODES.includes(k.mode as TangentMode) ? (k.mode as TangentMode) : 'auto';
  const key: CurveKey = { t: k.t, v: k.v, mode };
  if (typeof k.tin === 'number') key.tin = k.tin;
  if (typeof k.tout === 'number') key.tout = k.tout;
  return key;
}

/** Valide une forme inconnue (JSON réseau/stockage) en `CurveClipboard`, sinon `null`. */
export function parseClipboard(input: unknown): CurveClipboard | null {
  if (!input || typeof input !== 'object') return null;
  const src = (input as { channels?: unknown }).channels;
  if (!src || typeof src !== 'object') return null;
  const channels: Partial<Record<ChannelId, CurveKey[]>> = {};
  for (const id of CHANNEL_IDS) {
    const raw = (src as Record<string, unknown>)[id];
    if (!Array.isArray(raw)) continue;
    const keys = raw.map(parseKey).filter((k): k is CurveKey => k != null);
    if (keys.length) channels[id] = keys;
  }
  return Object.keys(channels).length ? { channels } : null;
}

export function persistClipboard(clip: CurveClipboard): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(clip));
  } catch {
    /* stockage indisponible : le presse-papier reste en mémoire */
  }
}

export function loadClipboard(): CurveClipboard | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? parseClipboard(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
