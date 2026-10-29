// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { auditActionLabel, parseSizeToBytes, bytesToUnit, fmtDateTime } from './adminShared';

describe('adminShared — fmtDateTime', () => {
  it('formats an ISO date in fr-FR with year and time', () => {
    const out = fmtDateTime('2026-08-02T10:30:00Z');
    expect(out).toContain('2026');
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
});

describe('adminShared — MB/GB sizes (Phase 21)', () => {
  it('parseSizeToBytes convertit GB et MB en base 1024, comme formatBytes', () => {
    expect(parseSizeToBytes('5', 'GB')).toBe(5 * 1024 ** 3);
    expect(parseSizeToBytes('500', 'MB')).toBe(500 * 1024 ** 2);
  });

  it('parseSizeToBytes accepts the decimal comma', () => {
    expect(parseSizeToBytes('5,5', 'GB')).toBe(Math.round(5.5 * 1024 ** 3));
    expect(parseSizeToBytes('1.25', 'GB')).toBe(Math.round(1.25 * 1024 ** 3));
  });

  it('parseSizeToBytes rejects invalid values', () => {
    expect(parseSizeToBytes('abc', 'GB')).toBeNull();
    expect(parseSizeToBytes('-1', 'GB')).toBeNull();
    expect(parseSizeToBytes('', 'MB')).toBeNull();
  });

  it('bytesToUnit picks GB from 1 GiB, otherwise MB', () => {
    expect(bytesToUnit(5 * 1024 ** 3)).toEqual({ value: '5', unit: 'GB' });
    expect(bytesToUnit(500 * 1024 ** 2)).toEqual({ value: '500', unit: 'MB' });
    expect(bytesToUnit(1024 ** 3 - 1)).toMatchObject({ unit: 'MB' });
  });

  it('exact round-trip for a round value', () => {
    const { value, unit } = bytesToUnit(5 * 1024 ** 3);
    expect(parseSizeToBytes(value, unit)).toBe(5 * 1024 ** 3);
  });

  // The unit selector and the display must count in the same base: entering "1 GB"
  // then reading the value back must not show 0.93.
  it('parseSizeToBytes and bytesToUnit share the base of formatBytes', () => {
    const bytes = parseSizeToBytes('2', 'GB');
    expect(bytes).toBe(2 * 1024 ** 3);
    expect(bytesToUnit(bytes!)).toEqual({ value: '2', unit: 'GB' });
  });
});

describe('auditActionLabel', () => {
  // Trial `t`: returns the key, which is enough to verify WHO is called and how many times.
  const t = ((key: string) => key) as unknown as Parameters<typeof auditActionLabel>[1];

  it('decodes the SUBJECT_VERB convention', () => {
    expect(auditActionLabel('VERSION_PUBLISH', t)).toBe('Version audit.publish');
    expect(auditActionLabel('PROJECT_CREATE', t)).toBe('Project audit.create');
    expect(auditActionLabel('SHOT_BULK_MOVE', t)).toBe('Shot bulk audit.move');
  });

  it('translates verbs that fell back to raw English', () => {
    // "Hdri add", "Share revoke", "Share view" were displayed as-is in all 14 languages.
    expect(auditActionLabel('HDRI_ADD', t)).toBe('Hdri audit.add');
    expect(auditActionLabel('SHARE_REVOKE', t)).toBe('Share audit.revoke');
    expect(auditActionLabel('SHARE_VIEW', t)).toBe('Share audit.view');
    expect(auditActionLabel('EPISODES_ENABLE', t)).toBe('Episodes audit.enable');
  });

  it('spells out review decisions in full', () => {
    expect(auditActionLabel('VERSION_DECISION', t)).toBe('audit.versionDecision');
    expect(auditActionLabel('VERSION_DECISION_BULK', t)).toBe('audit.versionDecisionBulk');
  });

  it('stays readable on rows already written in dotted notation', () => {
    // The decoder printed the key TWICE: "version.decision version.decision".
    expect(auditActionLabel('version.decision', t)).toBe('audit.versionDecision');
    expect(auditActionLabel('version.decision.bulk', t)).toBe('audit.versionDecisionBulk');
  });

  it('never prints an action twice, even an unknown one', () => {
    expect(auditActionLabel('inconnu', t)).toBe('inconnu');
    expect(auditActionLabel('autre.chose', t)).toBe('autre.chose');
  });
});
