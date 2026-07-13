import type { SplatCamera, SplatCameraKeyframe } from '../../reviewTypes';

/**
 * Modèle d'animation caméra « par canaux » (Phase 17, v2) — façon logiciel 3D. Chaque grandeur
 * animable est un canal (F-curve) : une liste de clés `{ t, v, tangentes, mode }`, éditables
 * individuellement (déplacer dans le temps/valeur, tangentes). Remplace le format v1
 * (`keyframes[{ t, pose, easing }]`). Purement données — l'échantillonnage vit dans `hermite.ts`,
 * l'état/édition dans `useCameraAnim`, le rendu dans `timeline/`.
 */

/** Canaux animables : position (x/y/z), cible (x/y/z), focale, tilt. */
export type ChannelId = 'px' | 'py' | 'pz' | 'tx' | 'ty' | 'tz' | 'fov' | 'roll';
export const CHANNEL_IDS: readonly ChannelId[] = ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'fov', 'roll'];

/** Mode de tangente d'une clé (comme un DCC) : lissée auto, linéaire, palier, ou libre (poignées). */
export type TangentMode = 'auto' | 'linear' | 'step' | 'free';

/** Clé d'un canal : temps (ms), valeur, tangentes entrante/sortante (pente, unités/ms) si `free`. */
export interface CurveKey {
  t: number;
  v: number;
  tin?: number;
  tout?: number;
  mode: TangentMode;
}

export interface Channel {
  keys: CurveKey[];
}

/** Animation caméra v2 : canaux indépendants + boucle. La durée = plus grand temps de clé. */
export interface CameraAnimV2 {
  version: 2;
  loop: boolean;
  channels: Partial<Record<ChannelId, Channel>>;
}

export const emptyAnim = (loop = true): CameraAnimV2 => ({ version: 2, loop, channels: {} });

/** Décompose une pose caméra en valeurs par canal (les canaux absents retombent sur la pose de base). */
export function poseToChannelValues(pose: SplatCamera): Record<ChannelId, number | undefined> {
  return {
    px: pose.position.x,
    py: pose.position.y,
    pz: pose.position.z,
    tx: pose.target.x,
    ty: pose.target.y,
    tz: pose.target.z,
    fov: pose.fov,
    roll: pose.roll,
  };
}

/** Temps (ms) triés et dédupliqués de toutes les clés, tous canaux confondus (colonnes dopesheet). */
export function animKeyTimes(anim: CameraAnimV2): number[] {
  const set = new Set<number>();
  for (const id of CHANNEL_IDS) anim.channels[id]?.keys.forEach((k) => set.add(k.t));
  return [...set].sort((a, b) => a - b);
}

/** Durée totale (ms) = plus grand temps de clé (0 si aucune). */
export function animDuration(anim: CameraAnimV2): number {
  let max = 0;
  for (const id of CHANNEL_IDS) for (const k of anim.channels[id]?.keys ?? []) if (k.t > max) max = k.t;
  return max;
}

/** Une animation est jouable dès qu'au moins un canal a 2 clés à des temps distincts. */
export function hasAnimation(anim: CameraAnimV2): boolean {
  return animKeyTimes(anim).length >= 2;
}

const sortKeys = (keys: CurveKey[]): CurveKey[] => [...keys].sort((a, b) => a.t - b.t);

/** Copie profonde légère d'un canal (immutabilité des opérations). */
const cloneChannel = (ch: Channel | undefined): Channel => ({
  keys: ch ? ch.keys.map((k) => ({ ...k })) : [],
});

function withChannel(anim: CameraAnimV2, id: ChannelId, mut: (ch: Channel) => void): CameraAnimV2 {
  const ch = cloneChannel(anim.channels[id]);
  mut(ch);
  ch.keys = sortKeys(ch.keys);
  const channels = { ...anim.channels };
  if (ch.keys.length) channels[id] = ch;
  else delete channels[id];
  return { ...anim, channels };
}

/** Insère/écrase une clé dans un canal au temps `t` (mode par défaut `auto`). */
export function upsertKey(
  anim: CameraAnimV2,
  id: ChannelId,
  t: number,
  v: number,
  mode: TangentMode = 'auto',
): CameraAnimV2 {
  return withChannel(anim, id, (ch) => {
    const existing = ch.keys.find((k) => k.t === t);
    if (existing) {
      existing.v = v;
    } else {
      ch.keys.push({ t, v, mode });
    }
  });
}

/** Pose complète → une clé par canal renseigné, au temps `t` (bouton « poser une clé »). */
export function upsertPoseAt(
  anim: CameraAnimV2,
  t: number,
  pose: SplatCamera,
  mode: TangentMode = 'auto',
): CameraAnimV2 {
  let next = anim;
  const values = poseToChannelValues(pose);
  for (const id of CHANNEL_IDS) {
    const v = values[id];
    if (v != null) next = upsertKey(next, id, t, v, mode);
  }
  return next;
}

/** Déplace une clé (temps et/ou valeur) — le tri est maintenu. */
export function moveKey(
  anim: CameraAnimV2,
  id: ChannelId,
  index: number,
  patch: { t?: number; v?: number },
): CameraAnimV2 {
  return withChannel(anim, id, (ch) => {
    const k = ch.keys[index];
    if (!k) return;
    if (patch.t != null) k.t = Math.max(0, patch.t);
    if (patch.v != null) k.v = patch.v;
  });
}

export function deleteKey(anim: CameraAnimV2, id: ChannelId, index: number): CameraAnimV2 {
  return withChannel(anim, id, (ch) => ch.keys.splice(index, 1));
}

export function setKeyMode(
  anim: CameraAnimV2,
  id: ChannelId,
  index: number,
  mode: TangentMode,
): CameraAnimV2 {
  return withChannel(anim, id, (ch) => {
    if (ch.keys[index]) ch.keys[index].mode = mode;
  });
}

/** Règle les tangentes libres d'une clé (mode passe à `free`). Pente en unités/ms. */
export function setKeyTangent(
  anim: CameraAnimV2,
  id: ChannelId,
  index: number,
  patch: { tin?: number; tout?: number },
): CameraAnimV2 {
  return withChannel(anim, id, (ch) => {
    const k = ch.keys[index];
    if (!k) return;
    k.mode = 'free';
    if (patch.tin != null) k.tin = patch.tin;
    if (patch.tout != null) k.tout = patch.tout;
  });
}

/** Supprime toutes les clés au temps `t` (± tolérance) sur tous les canaux (colonne dopesheet). */
export function deleteColumn(anim: CameraAnimV2, t: number, tol = 1): CameraAnimV2 {
  let next = anim;
  for (const id of CHANNEL_IDS) {
    const ch = next.channels[id];
    if (!ch) continue;
    const idx = ch.keys.findIndex((k) => Math.abs(k.t - t) <= tol);
    if (idx >= 0) next = deleteKey(next, id, idx);
  }
  return next;
}

/** Décale toutes les clés d'un temps `t` de `deltaMs` (retiming d'une colonne dopesheet). */
export function moveColumn(anim: CameraAnimV2, t: number, deltaMs: number, tol = 1): CameraAnimV2 {
  let next = anim;
  for (const id of CHANNEL_IDS) {
    const ch = next.channels[id];
    if (!ch) continue;
    const idx = ch.keys.findIndex((k) => Math.abs(k.t - t) <= tol);
    if (idx >= 0) next = moveKey(next, id, idx, { t: ch.keys[idx].t + deltaMs });
  }
  return next;
}

// ── Conversion depuis le format v1 (keyframes { t, pose, easing }) ──────────────
const easingToMode = (easing: string): TangentMode => (easing === 'linear' ? 'linear' : 'auto');

/** Convertit une animation v1 (poses + easing par segment) en v2 par canaux. */
export function fromV1(keyframes: SplatCameraKeyframe[], loop: boolean): CameraAnimV2 {
  let anim = emptyAnim(loop);
  for (const kf of keyframes) anim = upsertPoseAt(anim, kf.t, kf.pose, easingToMode(kf.easing));
  return anim;
}

/**
 * Normalise une animation persistée/jointe possiblement au format v1 vers v2 (aucune contrainte de
 * continuité de données : on migre à la lecture). Accepte une forme inconnue (données réseau
 * anciennes ou nouvelles). Renvoie `null` si vide/non exploitable.
 */
export function normalizeAnim(input: unknown): CameraAnimV2 | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as { version?: number; keyframes?: SplatCameraKeyframe[]; loop?: boolean };
  if (a.version === 2) return hasAnimation(input as CameraAnimV2) ? (input as CameraAnimV2) : null;
  if (Array.isArray(a.keyframes) && a.keyframes.length >= 2) return fromV1(a.keyframes, !!a.loop);
  return null;
}
