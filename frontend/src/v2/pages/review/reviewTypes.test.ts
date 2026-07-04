import { describe, it, expect } from 'vitest';
import { tcFromFrame, formatTime } from './reviewTypes';

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
