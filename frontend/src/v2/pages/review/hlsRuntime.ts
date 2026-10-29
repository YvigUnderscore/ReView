// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **On-demand** loading of the adaptive player, and the "HLS or MP4?" decision taken without it (F2).
 *
 * WHY. `hls.js` weighs 510 kB minified. As long as it was statically imported by `useHlsPlayer`, it
 * belonged to the static closure of the review page: opening an IMAGE, 3D or SPLAT review downloaded
 * and parsed it for nothing. It is only instantiated by `VideoPane`, which is not mounted for these
 * media. It therefore goes behind an `import()`.
 *
 * WHY a support test COPIED here. The switch must change nothing on screen, yet the player decides on
 * the FIRST render whether to set `src` (MP4 fallback) or to leave the element empty for MSE to feed.
 * Asking `Hls.isSupported()` for the answer would force waiting for the library, hence displaying an
 * intermediate state, or loading a second source then abandoning it. The test is therefore replayed
 * here, identical to hls.js 1.6.x, synchronously and without a byte of dependency;
 * `hlsRuntime.test.ts` confronts the two implementations so that they do not diverge.
 *
 * A happy side effect: a browser without MSE (iOS Safari, which reads HLS natively) no longer downloads
 * the library at all. It never needed it.
 */

/** The `Hls` class itself (constructor + static members), as a type only. */
export type HlsClass = typeof import('hls.js').default;
/** A player instance. */
export type HlsInstance = import('hls.js').default;

/** Global scope queried by the support test: configurable for tests. */
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

/** Codecs tested by `Hls.isSupported()`: same strings, same order (hls.js 1.6.16). */
const VIDEO_CODECS = ['avc1.42E01E,mp4a.40.2', 'av01.0.01M.08', 'vp09.00.50.08'];
const AUDIO_CODECS = ['mp4a.40.2', 'fLaC'];

/** `getMediaSource()` of hls.js: the "managed" variant (iOS 17) takes precedence. */
function mediaSourceOf(scope: HlsSupportScope): MediaSourceLike | undefined {
  return (scope.ManagedMediaSource ?? scope.MediaSource ?? scope.WebKitMediaSource) as
    MediaSourceLike | undefined;
}

/**
 * Faithful transcription of `isSupported()` (hls.js 1.6.16): MSE present, `SourceBuffer` usable if
 * it is exposed, and at least one commonly used codec accepted.
 */
export function hlsMseSupport(scope: HlsSupportScope): boolean {
  const mediaSource = mediaSourceOf(scope);
  if (!mediaSource) return false;
  // `SourceBuffer` is not exposed globally on old browsers: its absence is not a refusal, only a
  // truncated API is.
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
 * Does the current browser play HLS via MSE? Memoized: the video player re-renders on every displayed
 * frame, and the answer does not change from one render to the next.
 */
export function isMseHlsSupported(): boolean {
  supportCache ??= hlsMseSupport(globalThis);
  return supportCache;
}

/**
 * Is the source an HLS playlist? The MP4 fallback goes through the same parameter on the caller's
 * side. Without this guard, on a day when the URL changed nature, we would download a manifest reader
 * for a file that is not one.
 */
export function isHlsPlaylistUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.split(/[?#]/, 1)[0];
  return /\.m3u8$/i.test(path);
}

/** Must the adaptive player serve this source? Synchronous answer. */
export function canUseHlsJs(url: string | null | undefined): boolean {
  return isHlsPlaylistUrl(url) && isMseHlsSupported();
}

let loading: Promise<HlsClass> | null = null;

/**
 * Loads the library, only once per session (two video panes in an A/B comparison trigger only one
 * download). A network failure resets the lock, otherwise the rejected promise would be served again
 * to all later attempts.
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
