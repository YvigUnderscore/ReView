// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { AssetType, TaskStatus, TaskType } from '@prisma/client';
import {
  asDate,
  asEntityRef,
  disambiguatedName,
  plainName,
  asEntityRefs,
  attachmentId,
  attachmentName,
  attachmentUrl,
  cutDuration,
  minutesToWorkdays,
  pickVersionMediaField,
  rgbToHex,
  sgAssetType,
  sgDisplayName,
  sgStatusIsApproval,
  sgStatusIsRetake,
  sgStatusToEnum,
  sgStepToTaskType,
  toSgDate,
  workdaysToMinutes,
} from './shotgridMapper';

describe('shotgridMapper: status colours', () => {
  it('converts ShotGrid decimal RGB to hexadecimal', () => {
    expect(rgbToHex('202,225,202')).toBe('#CAE1CA');
    expect(rgbToHex('45,140,240')).toBe('#2D8CF0');
    expect(rgbToHex('0,0,0')).toBe('#000000');
    expect(rgbToHex('255,255,255')).toBe('#FFFFFF');
  });

  it('tolerates spaces and accepts an already formed hexadecimal', () => {
    expect(rgbToHex(' 60 , 190 , 90 ')).toBe('#3CBE5A');
    expect(rgbToHex('#aabbcc')).toBe('#AABBCC');
  });

  it('falls back to neutral grey rather than failing', () => {
    expect(rgbToHex(null)).toBe('#6B7280');
    expect(rgbToHex('bleu')).toBe('#6B7280');
    expect(rgbToHex('300,0,0')).toBe('#6B7280');
    expect(rgbToHex('1,2')).toBe('#6B7280');
  });
});

describe('shotgridMapper: statuses', () => {
  it('matches standard ShotGrid codes to the ReView enum', () => {
    expect(sgStatusToEnum('ip')).toBe(TaskStatus.IN_PROGRESS);
    expect(sgStatusToEnum('rev')).toBe(TaskStatus.PENDING_REVIEW);
    expect(sgStatusToEnum('apr')).toBe(TaskStatus.APPROVED);
    expect(sgStatusToEnum('fin')).toBe(TaskStatus.APPROVED);
    expect(sgStatusToEnum('cbb')).toBe(TaskStatus.RETAKE);
    // "rtk" is the most widespread retake code on real sites, although it appears in no standard list: forgetting it filed these tasks under "to do".
    expect(sgStatusToEnum('rtk')).toBe(TaskStatus.RETAKE);
    expect(sgStatusToEnum('pass')).toBe(TaskStatus.APPROVED);
    expect(sgStatusToEnum('suprev')).toBe(TaskStatus.PENDING_REVIEW);
    expect(sgStatusToEnum('omt')).toBe(TaskStatus.REJECTED);
    expect(sgStatusToEnum('WTG')).toBe(TaskStatus.TODO);
  });

  it('files an unknown code under TODO without throwing', () => {
    expect(sgStatusToEnum('zzz_custom')).toBe(TaskStatus.TODO);
    expect(sgStatusToEnum(null)).toBe(TaskStatus.TODO);
    expect(sgStatusToEnum(undefined)).toBe(TaskStatus.TODO);
  });

  it('tells approval and retake request apart', () => {
    expect(sgStatusIsApproval('apr')).toBe(true);
    expect(sgStatusIsApproval('fin')).toBe(true);
    expect(sgStatusIsApproval('ip')).toBe(false);
    expect(sgStatusIsRetake('cbb')).toBe(true);
    expect(sgStatusIsRetake('rrq')).toBe(true);
    expect(sgStatusIsRetake('apr')).toBe(false);
  });
});

describe('shotgridMapper: durations', () => {
  it('converts ShotGrid working minutes to days', () => {
    // 2400 minutes = 5 days of 8 h, the example from the official cookbook.
    expect(minutesToWorkdays(2400)).toBe(5);
    expect(minutesToWorkdays(480)).toBe(1);
    expect(minutesToWorkdays(240)).toBe(0.5);
  });

  it('ignores absent or absurd durations', () => {
    expect(minutesToWorkdays(0)).toBeNull();
    expect(minutesToWorkdays(-10)).toBeNull();
    expect(minutesToWorkdays(null)).toBeNull();
    expect(minutesToWorkdays(Number.NaN)).toBeNull();
  });

  it('round-trips days -> minutes', () => {
    expect(workdaysToMinutes(5)).toBe(2400);
    expect(workdaysToMinutes(1)).toBe(480);
    expect(workdaysToMinutes(null)).toBeNull();
  });

  it('counts the duration of a shot with both bounds included', () => {
    expect(cutDuration(1001, 1096)).toBe(96);
    expect(cutDuration(1001, 1001)).toBe(1);
    expect(cutDuration(1096, 1001)).toBeNull();
    expect(cutDuration(null, 1096)).toBeNull();
  });
});

describe('shotgridMapper: dates', () => {
  it('reads simple dates and full timestamps', () => {
    expect(asDate('2026-08-20')?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(asDate('2026-08-20T14:30:00Z')?.toISOString()).toBe('2026-08-20T14:30:00.000Z');
  });

  it('rejects what is not a date', () => {
    expect(asDate('')).toBeNull();
    expect(asDate('demain')).toBeNull();
    expect(asDate(null)).toBeNull();
    expect(asDate(42)).toBeNull();
  });

  it('rewrites a date in the format expected by ShotGrid', () => {
    expect(toSgDate(new Date('2026-08-20T14:30:00Z'))).toBe('2026-08-20');
    expect(toSgDate(null)).toBeNull();
  });
});

describe('shotgridMapper: entity references', () => {
  it('recognizes a complete reference', () => {
    expect(asEntityRef({ type: 'Shot', id: 12, name: 'SH010' })).toEqual({
      type: 'Shot',
      id: 12,
      name: 'SH010',
    });
  });

  it('refuses what is not a reference', () => {
    expect(asEntityRef(null)).toBeNull();
    expect(asEntityRef({ id: 'douze', type: 'Shot' })).toBeNull();
    expect(asEntityRef({ id: 12 })).toBeNull();
    expect(asEntityRef('Shot')).toBeNull();
  });

  it('filters the reference lists', () => {
    expect(
      asEntityRefs([{ type: 'HumanUser', id: 1 }, null, { id: 2 }, { type: 'HumanUser', id: 3 }]),
    ).toHaveLength(2);
    expect(asEntityRefs(undefined)).toEqual([]);
  });
});

describe('shotgridMapper: types', () => {
  it('guesses the asset type from the site vocabulary', () => {
    expect(sgAssetType('Character')).toBe(AssetType.CHARACTER);
    expect(sgAssetType('Hero Character')).toBe(AssetType.CHARACTER);
    expect(sgAssetType('Vehicle')).toBe(AssetType.VEHICLE);
    expect(sgAssetType('Environment')).toBe(AssetType.ENVIRONMENT);
    expect(sgAssetType('Set Piece')).toBe(AssetType.ENVIRONMENT);
    expect(sgAssetType('FX Rig')).toBe(AssetType.FX);
    expect(sgAssetType('Matte Painting')).toBe(AssetType.OTHER);
    expect(sgAssetType(null)).toBe(AssetType.OTHER);
  });

  it('guesses the task type from the pipeline step', () => {
    expect(sgStepToTaskType('Animation')).toBe(TaskType.ANIMATION);
    expect(sgStepToTaskType('Character Modeling')).toBe(TaskType.MODELING);
    expect(sgStepToTaskType('Lookdev')).toBe(TaskType.LOOKDEV);
    expect(sgStepToTaskType('Shading')).toBe(TaskType.LOOKDEV);
    expect(sgStepToTaskType('Compositing')).toBe(TaskType.COMPOSITING);
    expect(sgStepToTaskType('Blocking')).toBe(TaskType.LAYOUT);
    expect(sgStepToTaskType('Setdress')).toBe(TaskType.OTHER);
  });
});

describe('shotgridMapper: media and labels', () => {
  const version = {
    id: 1,
    type: 'Version',
    code: 'SH010_v001',
    sg_uploaded_movie: { name: 'master.mov' },
    sg_uploaded_movie_mp4: { name: 'proxy.mp4' },
  };

  it('prefers the transcoded or the original according to the setting', () => {
    expect(pickVersionMediaField(version, 'transcoded')?.field).toBe('sg_uploaded_movie_mp4');
    expect(pickVersionMediaField(version, 'original')?.field).toBe('sg_uploaded_movie');
  });

  it('falls back on what exists when the preferred field is empty', () => {
    const onlyOriginal = { id: 1, type: 'Version', sg_uploaded_movie: { name: 'master.mov' } };
    expect(pickVersionMediaField(onlyOriginal, 'transcoded')?.field).toBe('sg_uploaded_movie');
    expect(pickVersionMediaField({ id: 1, type: 'Version' }, 'transcoded')).toBeNull();
  });

  it('names an entity by its most telling field', () => {
    expect(sgDisplayName({ id: 1, type: 'Shot', code: 'SH010' })).toBe('SH010');
    expect(sgDisplayName({ id: 2, type: 'Task', content: 'Animation' })).toBe('Animation');
    expect(sgDisplayName({ id: 3, type: 'Project', name: 'Demo' })).toBe('Demo');
    expect(sgDisplayName({ id: 4, type: 'Shot' })).toBe('Shot 4');
  });

  it('finds the file name of an attachment', () => {
    expect(attachmentName({ name: 'plan.mov' }, 'defaut')).toBe('plan.mov');
    expect(attachmentName(null, 'defaut')).toBe('defaut');
  });
});

describe('attachmentUrl', () => {
  it('reads the address carried by the file field', () => {
    // Fallback when the dedicated download endpoint does not answer.
    expect(attachmentUrl({ name: 'v001.mov', url: 'https://s3/signed' })).toBe('https://s3/signed');
  });

  it('descends into a nested attachment', () => {
    expect(attachmentUrl({ attachment: { url: 'https://s3/nested' } })).toBe('https://s3/nested');
  });

  it('returns null when there is nothing to download', () => {
    expect(attachmentUrl({ name: 'v001.mov' })).toBeNull();
    expect(attachmentUrl(null)).toBeNull();
    expect(attachmentUrl('https://direct')).toBeNull();
  });
});

describe('attachmentId', () => {
  it('reads the identifier of the Attachment carrying the file', () => {
    expect(attachmentId({ id: 412, type: 'Attachment', name: 'v001.mov' })).toBe(412);
  });

  it('descends into a nested attachment', () => {
    expect(attachmentId({ attachment: { id: 77, type: 'Attachment' } })).toBe(77);
  });

  it('refuses anything that is not an Attachment', () => {
    // The corrected defect: the media field of a Version was recorded as "Attachment no. <Version id>". The type and the identifier must designate
    // the same entity — a Version reference does not make a file.
    expect(attachmentId({ id: 412, type: 'Version' })).toBeNull();
    expect(attachmentId({ attachment: { id: 77, type: 'Version' } })).toBeNull();
  });

  it('does not invent an identifier when the site gives none', () => {
    // Some fields deliver only a signed URL: no link, rather than a false one.
    expect(attachmentId({ name: 'v001.mov', url: 'https://s3/signed' })).toBeNull();
    expect(attachmentId(null)).toBeNull();
    expect(attachmentId('https://direct')).toBeNull();
  });
});

describe('disambiguatedName / plainName', () => {
  it('separates two site entities carrying the same code', () => {
    // A site accepts four sequences "DO_NOT_USE_"; the local database, one only.
    expect(disambiguatedName('DO_NOT_USE_', 4686)).toBe('DO_NOT_USE_ (4686)');
  });

  it('finds the site name to compare without a false gap', () => {
    expect(plainName('DO_NOT_USE_ (4686)', 4686)).toBe('DO_NOT_USE_');
    expect(plainName('sq010', 4685)).toBe('sq010');
  });

  it('removes only the suffix of the compared entity', () => {
    // A name ending with the parentheses of ANOTHER identifier stays intact.
    expect(plainName('DO_NOT_USE_ (4686)', 4687)).toBe('DO_NOT_USE_ (4686)');
    expect(plainName(null, 1)).toBeNull();
  });

  it('is stable: re-synchronizing does not pile up suffixes', () => {
    const once = disambiguatedName('Alba', 19472);
    expect(plainName(once, 19472)).toBe('Alba');
  });
});
