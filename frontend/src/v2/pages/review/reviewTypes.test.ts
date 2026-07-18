import { describe, it, expect, vi } from 'vitest';
import { tcFromFrame, formatTime, findCompareMedia, safePlay, cancelPendingPlay } from './reviewTypes';

describe('tcFromFrame', () => {
  it('convertit un numéro de frame en timecode HH:MM:SS:FF', () => {
    expect(tcFromFrame(0, 24)).toBe('00:00:00:00');
    expect(tcFromFrame(23, 24)).toBe('00:00:00:23');
    expect(tcFromFrame(24, 24)).toBe('00:00:01:00');
    expect(tcFromFrame(24 * 60, 24)).toBe('00:01:00:00');
    expect(tcFromFrame(24 * 3600, 24)).toBe('01:00:00:00');
  });

  it('borne les frames négatives à zéro', () => {
    expect(tcFromFrame(-5, 24)).toBe('00:00:00:00');
  });

  it('gère les fps non entiers (arrondi du compteur de frames)', () => {
    expect(tcFromFrame(29, 29.97)).toBe('00:00:00:29');
  });
});

describe('formatTime', () => {
  it('formate des secondes en MM:SS', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65.7)).toBe('01:05');
    expect(formatTime(600)).toBe('10:00');
  });
});

describe('safePlay — pas de son sur image figée', () => {
  /** Stub minimal d'élément vidéo (readyState piloté, listeners capturés). */
  function fakeVideo(readyState: number) {
    const listeners = new Map<string, () => void>();
    const v = {
      readyState,
      paused: true,
      playbackRate: 2,
      currentTime: 10,
      play: vi.fn(async () => undefined),
      addEventListener: vi.fn((ev: string, fn: () => void) => listeners.set(ev, fn)),
      removeEventListener: vi.fn((ev: string) => listeners.delete(ev)),
    };
    return { v: v as unknown as HTMLVideoElement, raw: v, listeners };
  }

  it('image décodable (readyState ≥ 3) : lecture immédiate à vitesse 1', () => {
    const { v, raw } = fakeVideo(4);
    safePlay(v);
    expect(raw.play).toHaveBeenCalledOnce();
    expect(raw.playbackRate).toBe(1);
    expect(raw.currentTime).toBe(10); // pas de micro-seek inutile
  });

  it('données manquantes : micro-seek sur place puis lecture différée à canplay', () => {
    const { v, raw, listeners } = fakeVideo(2);
    safePlay(v);
    expect(raw.play).not.toHaveBeenCalled();
    expect(raw.currentTime).toBeCloseTo(9.999, 5); // micro-seek → hls.js recharge le segment
    listeners.get('canplay')?.();
    expect(raw.play).toHaveBeenCalledOnce();
  });

  it('cancelPendingPlay annule un lancement en attente (pause entre-temps)', () => {
    const { v, raw, listeners } = fakeVideo(1);
    safePlay(v);
    cancelPendingPlay(v);
    expect(raw.removeEventListener).toHaveBeenCalledWith('canplay', expect.any(Function));
    listeners.get('canplay')?.(); // même si l'événement arrive, plus de lecture
    expect(raw.play).not.toHaveBeenCalled();
  });
});

describe('findCompareMedia — comparaison A/B (vidéo & image)', () => {
  const media = [
    { id: 10, kind: 'IMAGE' },
    { id: 11, kind: 'VIDEO' },
    { id: 12, kind: 'VIDEO' },
  ];

  it('renvoie le premier média du type demandé', () => {
    expect(findCompareMedia(media, 99, 'VIDEO')).toBe(11);
    expect(findCompareMedia(media, 99, 'IMAGE')).toBe(10);
  });

  it('exclut le média courant et renvoie null sans autre média du type', () => {
    expect(findCompareMedia([{ id: 11, kind: 'VIDEO' }], 11, 'VIDEO')).toBeNull();
    expect(findCompareMedia([{ id: 10, kind: 'MODEL_3D' }], 99, 'VIDEO')).toBeNull();
    expect(findCompareMedia([], 99, 'IMAGE')).toBeNull();
  });
});
