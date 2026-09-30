// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Chargement **à la demande** du lecteur adaptatif, et décision « HLS ou MP4 ? » prise
 * sans lui (F2).
 *
 * POURQUOI. `hls.js` pèse 510 ko minifiés. Tant qu'il était importé statiquement par
 * `useHlsPlayer`, il appartenait à la fermeture statique de la page de review : ouvrir une
 * review d'IMAGE, de 3D ou de SPLAT le téléchargeait et le parsait pour rien — il n'est
 * instancié que par `VideoPane`, qui n'est pas monté pour ces médias. Il part donc
 * derrière un `import()`.
 *
 * POURQUOI un test de support RECOPIÉ ici. La bascule ne doit rien changer à l'écran, or
 * le lecteur décide dès le PREMIER rendu s'il pose `src` (repli MP4) ou s'il laisse
 * l'élément vide pour que MSE l'alimente. Demander la réponse à `Hls.isSupported()`
 * obligerait à attendre la bibliothèque — donc à afficher un état intermédiaire, ou à
 * charger une seconde source puis à l'abandonner. Le test est donc rejoué ici, à
 * l'identique de hls.js 1.6.x, de façon synchrone et sans un octet de dépendance ;
 * `hlsRuntime.test.ts` confronte les deux implémentations pour qu'elles ne divergent pas.
 *
 * Effet de bord heureux : un navigateur sans MSE (Safari iOS, qui lit le HLS nativement)
 * ne télécharge plus la bibliothèque du tout — elle ne lui a jamais servi.
 */

/** La classe `Hls` elle-même (constructeur + membres statiques), en type seul. */
export type HlsClass = typeof import('hls.js').default;
/** Une instance de lecteur. */
export type HlsInstance = import('hls.js').default;

/** Portée globale interrogée par le test de support — paramétrable pour les tests. */
export interface HlsSupportScope {
  MediaSource?: unknown;
  ManagedMediaSource?: unknown;
  WebKitMediaSource?: unknown;
  SourceBuffer?: unknown;
  WebKitSourceBuffer?: unknown;
}

interface MediaSourceLike {
  isTypeSupported?: (type: string) => boolean;
}
interface SourceBufferLike {
  prototype?: { appendBuffer?: unknown; remove?: unknown };
}

/** Codecs testés par `Hls.isSupported()` — mêmes chaînes, même ordre (hls.js 1.6.16). */
const VIDEO_CODECS = ['avc1.42E01E,mp4a.40.2', 'av01.0.01M.08', 'vp09.00.50.08'];
const AUDIO_CODECS = ['mp4a.40.2', 'fLaC'];

/** `getMediaSource()` de hls.js : la variante « managée » (iOS 17) prime. */
function mediaSourceOf(scope: HlsSupportScope): MediaSourceLike | undefined {
  return (scope.ManagedMediaSource ?? scope.MediaSource ?? scope.WebKitMediaSource) as
    MediaSourceLike | undefined;
}

/**
 * Transcription fidèle de `isSupported()` (hls.js 1.6.16) : MSE présent, `SourceBuffer`
 * utilisable s'il est exposé, et au moins un codec d'usage courant accepté.
 */
export function hlsMseSupport(scope: HlsSupportScope): boolean {
  const mediaSource = mediaSourceOf(scope);
  if (!mediaSource) return false;
  // `SourceBuffer` n'est pas exposé globalement sur les navigateurs anciens : son absence
  // n'est pas un refus, seule une API tronquée l'est.
  const sourceBuffer = (scope.SourceBuffer ?? scope.WebKitSourceBuffer) as SourceBufferLike | undefined;
  const bufferOk =
    !sourceBuffer ||
    (!!sourceBuffer.prototype &&
      typeof sourceBuffer.prototype.appendBuffer === 'function' &&
      typeof sourceBuffer.prototype.remove === 'function');
  if (!bufferOk) return false;
  const isTypeSupported = mediaSource.isTypeSupported;
  if (typeof isTypeSupported !== 'function') return false;
  const supports = (mime: string) => isTypeSupported.call(mediaSource, mime);
  return (
    VIDEO_CODECS.some((c) => supports(`video/mp4;codecs=${c}`)) ||
    AUDIO_CODECS.some((c) => supports(`audio/mp4;codecs=${c}`))
  );
}

let supportCache: boolean | undefined;

/**
 * Le navigateur courant sait-il lire du HLS via MSE ? Mémoïsé : le lecteur vidéo se
 * redessine à chaque frame affichée, et la réponse ne change pas d'un rendu à l'autre.
 */
export function isMseHlsSupported(): boolean {
  supportCache ??= hlsMseSupport(globalThis);
  return supportCache;
}

/**
 * La source est-elle une playlist HLS ? Le repli MP4 passe par le même paramètre côté
 * appelant ; sans ce garde-fou, un jour où l'URL changerait de nature, on téléchargerait
 * un lecteur de manifestes pour un fichier qui n'en est pas un.
 */
export function isHlsPlaylistUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.split(/[?#]/, 1)[0];
  return /\.m3u8$/i.test(path);
}

/** Le lecteur adaptatif doit-il servir pour cette source ? Réponse synchrone. */
export function canUseHlsJs(url: string | null | undefined): boolean {
  return isHlsPlaylistUrl(url) && isMseHlsSupported();
}

let loading: Promise<HlsClass> | null = null;

/**
 * Charge la bibliothèque, une seule fois par session (deux panes vidéo en comparaison A/B
 * ne provoquent qu'un téléchargement). Un échec réseau remet le verrou à zéro, sinon la
 * promesse rejetée serait resservie à toutes les tentatives suivantes.
 */
export function loadHls(): Promise<HlsClass> {
  loading ??= import('hls.js').then(
    (mod) => mod.default,
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}
